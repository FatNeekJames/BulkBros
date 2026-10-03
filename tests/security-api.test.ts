import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import request from "supertest";
import { createApp } from "../server/app";
import { openDatabase, type DB } from "../server/db";
import { trustLocalProxy } from "../server/request-security";

let db: DB;
let app: ReturnType<typeof createApp>;
let server: Server;

beforeEach(async () => {
  db = openDatabase(":memory:");
  app = createApp(db);
  // Keep one known proxy peer and listener for the entire request budget.
  // request(app) otherwise opens/closes a new ephemeral server on every call.
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error) =>
      error ? reject(error) : resolve(),
    );
    server.once("error", reject);
  });
});
afterEach(async () => {
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  } finally {
    db.close();
  }
});

function session(email = "security@example.test") {
  const id = randomUUID();
  const token = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    id,
    email,
    "unused-test-password-hash",
    new Date().toISOString(),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    createHash("sha256").update(token).digest("hex"),
    id,
    Date.now() + 60000,
  );
  return { Cookie: `bulkbro_session=${token}`, "X-Bulkbro-Client": "1" };
}

const food = {
  name: "Test food",
  brand: "",
  serving: 100,
  unit: "g",
  source: "Fixture",
  calories: 100,
  protein: 5,
  carbs: 15,
  fat: 2,
  fibre: 1,
};
const workout = () => ({
  id: randomUUID(),
  date: "2026-10-03",
  name: "Routine",
  duration: 30,
  intensity: "moderate",
  exercises: [{ name: "Squat", sets: [{ weight: 20, reps: 8 }] }],
});

describe("bounded API validation", () => {
  it.each([
    ["logs", () => Array(10000).fill({}), 50],
    ["workouts", () => ({ ...workout(), exercises: Array(2000).fill({}) }), 40],
    [
      "workouts",
      () => ({
        ...workout(),
        exercises: [{ name: "Squat", sets: Array(4000).fill({}) }],
      }),
      30,
    ],
    [
      "saved-meals",
      () => ({
        id: randomUUID(),
        name: "Recipe",
        servings: 1,
        ingredients: Array(2000).fill({}),
      }),
      100,
    ],
  ] as const)(
    "rejects oversized %s collections with one bounded length error",
    async (path, body, maximum) => {
      const response = await request(server)
        .post(`/api/${path}`)
        .set(session())
        .send(body())
        .expect(400);
      expect(response.body.error).toContain(`at most ${maximum}`);
      expect(response.body.error.split("; ")).toHaveLength(1);
      expect(Buffer.byteLength(response.text)).toBeLessThan(1024);
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM food_logs").get()?.count,
      ).toBe(0);
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM workouts").get()?.count,
      ).toBe(0);
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM saved_meals").get()?.count,
      ).toBe(0);
    },
  );

  it("limits error output for invalid items within allowed collection lengths", async () => {
    const response = await request(server)
      .post("/api/logs")
      .set(session())
      .send(Array(50).fill({}))
      .expect(400);
    expect(response.body.error.split("; ")).toHaveLength(5);
    expect(Buffer.byteLength(response.text)).toBeLessThan(1024);
  });

  it.each([
    ["/api/profile", 16 * 1024],
    ["/api/logs", 256 * 1024],
    ["/api/workouts", 128 * 1024],
    ["/api/saved-meals", 384 * 1024],
  ] as const)("rejects excessive JSON bytes for %s", async (path, bytes) => {
    const write =
      path === "/api/profile"
        ? request(server).put(path)
        : request(server).post(path);
    const response = await write
      .set(session())
      .send({ padding: "x".repeat(bytes) })
      .expect(413);
    expect(response.body.error).toContain("Request is too large");
    expect(response.text).not.toContain("Image");
  });

  it("limits auth bodies and rejects malformed JSON without server errors", async () => {
    await request(server)
      .post("/api/auth/login")
      .set("X-Bulkbro-Client", "1")
      .send({ padding: "x".repeat(4096) })
      .expect(413);
    const response = await request(server)
      .post("/api/logs")
      .set(session())
      .set("Content-Type", "application/json")
      .send("[")
      .expect(400);
    expect(response.body.error).toBe("Request must contain valid JSON.");
  });

  it("accepts maximum supported collections and preserves normal stored data", async () => {
    const headers = session();
    await request(server)
      .put("/api/profile")
      .set(headers)
      .send({
        name: "Test",
        username: "security_user",
        age: 30,
        sex: "male",
        height: 180,
        weight: 80,
        targetWeight: 85,
        units: "metric",
        activity: "moderate",
        workoutsPerWeek: 3,
        goal: "gain",
        speed: "slow",
        stepGoal: 8000,
      })
      .expect(200);
    // Maximum field lengths, including multi-byte text, should fit the route budgets.
    const largeFood = {
      ...food,
      name: "食".repeat(150),
      brand: "食".repeat(100),
      source: "食".repeat(200),
      unit: "食".repeat(20),
    };
    await request(server)
      .post("/api/logs")
      .set(headers)
      .send(
        Array.from({ length: 50 }, () => ({
          ...largeFood,
          id: randomUUID(),
          date: "2026-10-03",
          meal: "食".repeat(40),
        })),
      )
      .expect(201);
    await request(server)
      .post("/api/saved-meals")
      .set(headers)
      .send({
        id: randomUUID(),
        name: "Recipe",
        servings: 1,
        ingredients: Array.from({ length: 100 }, () => largeFood),
      })
      .expect(201);
    await request(server)
      .post("/api/workouts")
      .set(headers)
      .send({
        ...workout(),
        exercises: Array.from({ length: 40 }, () => ({
          name: "食".repeat(100),
          sets: Array.from({ length: 30 }, () => ({
            weight: 1500,
            reps: 1000,
            rpe: 10,
          })),
        })),
      })
      .expect(201);
    const result = await request(server)
      .get("/api/snapshot")
      .set(headers)
      .expect(200);
    expect(result.body.logs).toHaveLength(50);
    expect(result.body.savedMeals[0].ingredients).toHaveLength(100);
    expect(result.body.workouts[0].exercises).toHaveLength(40);
    expect(result.body.workouts[0].exercises[0].sets).toHaveLength(30);
  });
});

describe("client and account rate-limit boundaries", () => {
  function invalidLogin(
    target: ReturnType<typeof createApp> | Server = server,
    forwarding: Record<string, string> = {},
  ) {
    return request(target)
      .post("/api/auth/login")
      .set("X-Bulkbro-Client", "1")
      .set(forwarding)
      .send({});
  }

  it("keeps auth budgets separate for clients behind the local proxy", async () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      await invalidLogin(server, { "X-Forwarded-For": "192.0.2.10" }).expect(
        400,
      );
    }
    await invalidLogin(server, { "X-Forwarded-For": "192.0.2.10" }).expect(429);
    await invalidLogin(server, { "X-Forwarded-For": "192.0.2.11" }).expect(400);
    await request(server)
      .post("/api/auth/register")
      .set("X-Bulkbro-Client", "1")
      .set("X-Forwarded-For", "192.0.2.11")
      .send({
        email: "normal@example.test",
        password: "a-strong-test-password",
      })
      .expect(201);
  });

  it("does not accept header chains, malformed addresses or Forwarded as new identities", async () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      await invalidLogin(server, {
        "X-Forwarded-For":
          attempt % 2 ? `192.0.2.${attempt}, 127.0.0.1` : `invalid-${attempt}`,
        Forwarded: `for=192.0.2.${attempt}`,
        "X-Real-IP": `192.0.2.${attempt}`,
      }).expect(400);
    }
    await invalidLogin(server, { Forwarded: "for=192.0.2.200" }).expect(429);
    await invalidLogin(server, { "X-Forwarded-For": "192.0.2.200" }).expect(
      400,
    );
  });

  it("ignores forged forwarding from a peer outside the exact local proxy addresses", async () => {
    const externalPeer = express();
    externalPeer.use((req, _res, next) => {
      Object.defineProperty(req.socket, "remoteAddress", {
        value: "198.51.100.20",
        configurable: true,
      });
      next();
    });
    externalPeer.use(app);
    for (let attempt = 0; attempt < 25; attempt++) {
      await invalidLogin(externalPeer, {
        "X-Forwarded-For": `192.0.2.${attempt}`,
      }).expect(400);
    }
    await invalidLogin(externalPeer, {
      "X-Forwarded-For": "192.0.2.200",
    }).expect(429);
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(trustLocalProxy(address, 0)).toBe(true);
      expect(trustLocalProxy(address, 1)).toBe(false);
    }
    for (const address of ["127.0.0.2", "192.168.1.1", "198.51.100.20"]) {
      expect(trustLocalProxy(address, 0)).toBe(false);
    }
  });

  it("isolates health polling from sign-in and authenticated API budgets", async () => {
    const headers = session();
    for (let attempt = 0; attempt < 60; attempt++) {
      await request(server).get("/api/health").expect(200);
    }
    await request(server).get("/api/health").expect(429);
    await request(server).get("/api/snapshot").set(headers).expect(200);
    await invalidLogin().expect(400);
    await request(server)
      .get("/api/health")
      .set("X-Forwarded-For", "192.0.2.10")
      .expect(200);
  });

  it("throttles one authenticated account without blocking another on the same client", async () => {
    const first = session();
    const second = session("second@example.test");
    for (let attempt = 0; attempt < 300; attempt++) {
      await request(server).get("/api/snapshot").set(first).expect(200);
    }
    await request(server).get("/api/snapshot").set(first).expect(429);
    await request(server)
      .get("/api/snapshot")
      .set(first)
      .set("X-Forwarded-For", "192.0.2.10")
      .expect(429);
    await request(server).get("/api/snapshot").set(second).expect(200);
    await request(server).get("/api/snapshot").expect(401);
  });

  it("retains separate per-client limits on unauthenticated requests", async () => {
    const headers = session();
    for (let attempt = 0; attempt < 300; attempt++) {
      const response = await request(server)
        .get("/api/snapshot")
        .set("X-Forwarded-For", "192.0.2.10")
        .expect(401);
      expect(response.headers.ratelimit, `request ${attempt + 1}`).toContain(
        `; r=${299 - attempt};`,
      );
    }
    await request(server)
      .get("/api/snapshot")
      .set("X-Forwarded-For", "192.0.2.10")
      .expect(429);
    await request(server)
      .get("/api/snapshot")
      .set("X-Forwarded-For", "192.0.2.11")
      .expect(401);
    await request(server).get("/api/snapshot").set(headers).expect(200);
  });
});
