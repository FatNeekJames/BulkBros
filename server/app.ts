import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { networkInterfaces } from "node:os";
import { z } from "zod";
import type { DB } from "./db";
import {
  profileSchema,
  foodSchema,
  logSchema,
  workoutSchema,
  dateSchema,
  macroCalories,
  workoutEnergy,
  type Profile,
  type Snapshot,
} from "../shared/domain";
import { searchFoods, barcodeFood } from "./nutrition";
import { recognizeMeal, coach } from "./ai";
import { classifyAiError } from "./ai-errors";
const scrypt = promisify(scryptCallback),
  hash = (s: string) => createHash("sha256").update(s).digest("hex");
const credentials = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(12).max(128),
});
function allowedOrigin(origin: string): boolean {
  if (origin === (process.env.APP_ORIGIN || "http://localhost:5188")) return true;
  if (process.env.NODE_ENV === "production") return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" || url.port !== "5191" || url.pathname !== "/") return false;
    const addresses = Object.values(networkInterfaces()).flatMap((items) => items || []);
    return addresses.some((address) => address.family === "IPv4" && !address.internal && address.address === url.hostname);
  } catch { return false; }
}
async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex"),
    key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
async function passwordValid(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(key, "hex"));
}
export function createApp(db: DB) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          workerSrc: ["'self'"],
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "8mb" }));
  app.use(cookieParser());
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers["x-bulkbro-client"] !== "1")
        return res.status(403).json({ error: "Missing request protection" });
      const origin = req.headers.origin;
      if (origin && !allowedOrigin(origin))
        return res.status(403).json({ error: "Origin not allowed" });
    }
    next();
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 25,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const issueSession = (res: express.Response, id: string) => {
    const token = randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(token),
      id,
      Date.now() + 7 * 86400000,
    );
    res.cookie("bulkbro_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 86400000,
      path: "/",
    });
  };
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.post("/api/auth/register", authLimit, async (req, res) => {
    const { email, password } = credentials.parse(req.body),
      id = randomUUID();
    const encoded = await passwordHash(password);
    try {
      db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
        id,
        email,
        encoded,
        new Date().toISOString(),
      );
    } catch {
      return res
        .status(409)
        .json({ error: "An account with that email already exists" });
    }
    issueSession(res, id);
    res.status(201).json({ id, email });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const row = db.prepare("SELECT * FROM users WHERE email=?").get(email) as
      { id: string; password: string } | undefined;
    const fallback = "00000000000000000000000000000000:" + "00".repeat(64);
    const valid = await passwordValid(password, row?.password ?? fallback);
    if (!row || !valid)
      return res.status(401).json({ error: "Email or password is incorrect" });
    issueSession(res, row.id);
    res.json({ id: row.id, email });
  });
  app.use("/api", (req, res, next) => {
    const token = req.cookies.bulkbro_session;
    const session =
      typeof token === "string"
        ? (db
            .prepare("SELECT user_id FROM sessions WHERE hash=? AND expires>?")
            .get(hash(token), Date.now()) as { user_id: string } | undefined)
        : undefined;
    if (!session) return res.status(401).json({ error: "Please sign in" });
    res.locals.userId = session.user_id;
    res.set("Cache-Control", "no-store");
    next();
  });
  function snapshot(id: string): Snapshot {
    const payloads = (table: string) =>
      db
        .prepare(`SELECT payload FROM ${table} WHERE user_id=? ORDER BY rowid`)
        .all(id)
        .map((r) => JSON.parse(r.payload as string));
    const user = db
      .prepare("SELECT id,email FROM users WHERE id=?")
      .get(id) as Snapshot["user"];
    return {
      user,
      profile: payloads("profiles")[0] ?? null,
      foods: payloads("foods"),
      logs: payloads("food_logs"),
      weights: db
        .prepare(
          "SELECT id,date,weight FROM weights WHERE user_id=? ORDER BY date",
        )
        .all(id) as Snapshot["weights"],
      workouts: payloads("workouts"),
      activity: db
        .prepare(
          "SELECT date,steps,water,activeCalories FROM activity WHERE user_id=? ORDER BY date",
        )
        .all(id) as Snapshot["activity"],
      savedMeals: payloads("saved_meals"),
      favourites: db
        .prepare("SELECT food_id FROM favourites WHERE user_id=?")
        .all(id)
        .map((r) => r.food_id as string),
    };
  }
  app.get("/api/snapshot", (_req, res) =>
    res.json(snapshot(res.locals.userId)),
  );
  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE hash=?").run(
      hash(req.cookies.bulkbro_session),
    );
    res.clearCookie("bulkbro_session", { path: "/" }).json({ ok: true });
  });
  app.put("/api/profile", (req, res) => {
    const p = profileSchema.parse(req.body);
    if (
      p.targets &&
      (p.targets.calories < 1200 ||
        Math.abs(macroCalories(p.targets) - p.targets.calories) > 2)
    )
      return res.status(400).json({
        error:
          "Targets must be at least 1,200 kcal and match macro energy (4/4/9).",
      });
    try {
      db.prepare(
        "INSERT INTO profiles VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,payload=excluded.payload",
      ).run(res.locals.userId, p.username.toLowerCase(), JSON.stringify(p));
    } catch {
      return res.status(409).json({ error: "That username is already in use" });
    }
    res.json(p);
  });
  app.get("/api/foods/search", async (req, res) => {
    const q = z.string().min(2).max(100).parse(req.query.q);
    const own = snapshot(res.locals.userId).foods.filter((f) =>
      (f.name + " " + f.brand).toLowerCase().includes(q.toLowerCase()),
    );
    try {
      res.json({ foods: [...own, ...(await searchFoods(q))], warning: null });
    } catch {
      res.json({
        foods: own,
        warning:
          "Food database unavailable. Your saved foods are still available; use manual entry for anything else.",
      });
    }
  });
  app.get("/api/foods/barcode/:code", async (req, res) => {
    const code = z
      .string()
      .regex(/^\d{8,14}$/)
      .parse(req.params.code);
    const f = await barcodeFood(code);
    if (!f)
      return res.status(404).json({
        error:
          "Product not found or nutrition is incomplete. Please enter the label manually.",
      });
    res.json(f);
  });
  app.post("/api/foods", (req, res) => {
    const f = foodSchema.parse(req.body),
      id = randomUUID();
    db.prepare("INSERT INTO foods VALUES(?,?,?)").run(
      id,
      res.locals.userId,
      JSON.stringify({ ...f, id }),
    );
    res.status(201).json({ ...f, id });
  });
  app.put("/api/favourites/:id", (req, res) => {
    const id = z.string().max(100).parse(req.params.id);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    if (active)
      db.prepare("INSERT OR IGNORE INTO favourites VALUES(?,?)").run(
        res.locals.userId,
        id,
      );
    else
      db.prepare("DELETE FROM favourites WHERE user_id=? AND food_id=?").run(
        res.locals.userId,
        id,
      );
    res.json({ ok: true });
  });
  app.post("/api/logs", (req, res) => {
    const logs = z.array(logSchema).min(1).max(50).parse(req.body);
    for (const l of logs) {
      if (
        l.analysisId &&
        !db
          .prepare("SELECT id FROM analyses WHERE id=? AND user_id=?")
          .get(l.analysisId, res.locals.userId)
      )
        return res.status(403).json({ error: "Analysis unavailable" });
    }
    db.exec("BEGIN");
    try {
      for (const l of logs) {
        const existing = db
          .prepare("SELECT user_id FROM food_logs WHERE id=?")
          .get(l.id);
        if (existing && existing.user_id !== res.locals.userId)
          throw Error("Conflicting entry identifier");
        db.prepare("INSERT OR IGNORE INTO food_logs VALUES(?,?,?,?,?,?)").run(
          l.id,
          res.locals.userId,
          l.date,
          l.meal,
          l.analysisId ?? null,
          JSON.stringify(l),
        );
        if (l.analysisId)
          db.prepare(
            "UPDATE analyses SET corrected=? WHERE id=? AND user_id=?",
          ).run(
            JSON.stringify(logs.filter((x) => x.analysisId === l.analysisId)),
            l.analysisId,
            res.locals.userId,
          );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.status(201).json({ ok: true });
  });
  app.delete("/api/logs/:id", (req, res) => {
    db.prepare("DELETE FROM food_logs WHERE id=? AND user_id=?").run(
      String(req.params.id),
      res.locals.userId,
    );
    res.json({ ok: true });
  });
  app.post("/api/weights", (req, res) => {
    const w = z
      .object({
        id: z.string().uuid(),
        date: dateSchema,
        weight: z.number().finite().min(30).max(350),
      })
      .parse(req.body);
    db.prepare(
      "INSERT INTO weights VALUES(?,?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET weight=excluded.weight",
    ).run(w.id, res.locals.userId, w.date, w.weight);
    res.status(201).json({ ok: true });
  });
  app.put("/api/activity", (req, res) => {
    const a = z
      .object({
        date: dateSchema,
        steps: z.number().int().min(0).max(100000),
        water: z.number().min(0).max(20),
        activeCalories: z.number().min(0).max(10000),
      })
      .parse(req.body);
    db.prepare(
      "INSERT INTO activity VALUES(?,?,?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET steps=excluded.steps,water=excluded.water,activeCalories=excluded.activeCalories",
    ).run(res.locals.userId, a.date, a.steps, a.water, a.activeCalories);
    res.json({ ok: true });
  });
  app.post("/api/workouts", (req, res) => {
    const w = workoutSchema.parse(req.body);
    const p = snapshot(res.locals.userId).profile;
    if (!p)
      return res.status(400).json({ error: "Complete your profile first" });
    const existing = db
      .prepare("SELECT user_id FROM workouts WHERE id=?")
      .get(w.id);
    if (existing) {
      if (existing.user_id !== res.locals.userId)
        return res.status(409).json({ error: "Conflicting entry identifier" });
      return res.json({ ok: true });
    }
    const calories = workoutEnergy(p.weight, w.duration, w.intensity);
    db.exec("BEGIN");
    try {
      db.prepare("INSERT INTO workouts VALUES(?,?,?,?)").run(
        w.id,
        res.locals.userId,
        w.date,
        JSON.stringify({ ...w, calories }),
      );
      for (const e of w.exercises) {
        const result = db
          .prepare("INSERT INTO workout_exercises(workout_id,name) VALUES(?,?)")
          .run(w.id, e.name);
        for (const s of e.sets)
          db.prepare(
            "INSERT INTO workout_sets(exercise_id,weight,reps,rpe) VALUES(?,?,?,?)",
          ).run(result.lastInsertRowid, s.weight, s.reps, s.rpe ?? null);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.status(201).json({ ok: true });
  });
  app.post("/api/saved-meals", (req, res) => {
    const m = z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
        servings: z.number().min(0.1).max(1000),
        ingredients: z.array(foodSchema).min(1).max(100),
      })
      .parse(req.body);
    db.prepare("INSERT INTO saved_meals VALUES(?,?,?)").run(
      m.id,
      res.locals.userId,
      JSON.stringify(m),
    );
    res.status(201).json({ ok: true });
  });
  const aiLimit = rateLimit({
    windowMs: 3600000,
    limit: 20,
    keyGenerator: (_req, res) => res.locals.userId,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) =>
      res
        .status(429)
        .json({
          code: "AI_RATE_LIMIT",
          error:
            "You have reached the hourly AI request limit. Please try again later.",
        }),
  });
  app.post("/api/ai/meal", aiLimit, async (req, res) => {
    const { image, notes } = z
      .object({
        image: z
          .string()
          .max(7500000)
          .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/),
        notes: z.string().max(1000).default(""),
      })
      .parse(req.body);
    const original = await recognizeMeal(image, notes),
      id = randomUUID();
    db.prepare("INSERT INTO analyses VALUES(?,?,?,?,?)").run(
      id,
      res.locals.userId,
      JSON.stringify(original),
      null,
      new Date().toISOString(),
    );
    res.json({ id, ...original });
  });
  app.post("/api/ai/coach", aiLimit, async (req, res) => {
    const { question } = z
      .object({ question: z.string().trim().min(1).max(1000) })
      .parse(req.body);
    res.json({ answer: await coach(snapshot(res.locals.userId), question) });
  });
  app.get("/api/account/export", (_req, res) => {
    const data = snapshot(res.locals.userId),
      analyses = db
        .prepare(
          "SELECT id,original,corrected,created FROM analyses WHERE user_id=?",
        )
        .all(res.locals.userId);
    res
      .set("Content-Disposition", 'attachment; filename="bulkbro-export.json"')
      .json({ ...data, analyses });
  });
  app.delete("/api/account", async (req, res) => {
    const { password } = z
      .object({ password: z.string().max(128) })
      .parse(req.body);
    const u = db
      .prepare("SELECT password FROM users WHERE id=?")
      .get(res.locals.userId) as { password: string };
    if (!(await passwordValid(password, u.password)))
      return res.status(401).json({ error: "Password is incorrect" });
    db.prepare("DELETE FROM users WHERE id=?").run(res.locals.userId);
    res.clearCookie("bulkbro_session", { path: "/" }).json({ ok: true });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError)
        return res.status(400).json({
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
      const aiError = classifyAiError(error);
      if (aiError)
        return res
          .status(aiError.status)
          .json({ code: aiError.code, error: aiError.message });
      const e = error as { status?: number; type?: string };
      if (e.type === "entity.too.large")
        return res
          .status(413)
          .json({ error: "Image is too large. Choose an image under 5 MB." });
      res.status(503).json({
        error:
          "This service is temporarily unavailable. Your existing data is safe. Please try again.",
      });
    },
  );
  return app;
}
