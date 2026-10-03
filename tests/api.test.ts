import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { openDatabase, type DB } from "../server/db";
import { createApp } from "../server/app";
import {
  calculateTargets,
  scaleFood,
  totals,
  type Profile,
  type Food,
  type Snapshot,
} from "../shared/domain";
let db: DB, app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDatabase(":memory:");
  app = createApp(db);
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
});
const profile: Profile = {
  name: "Test",
  username: "test_user",
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
  exerciseCalories: false,
};
async function account(email = "one@example.test") {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/register")
    .set("X-Bulkbro-Client", "1")
    .send({ email, password: "a-strong-test-password" })
    .expect(201);
  return agent;
}
const food = () => ({
  id: crypto.randomUUID(),
  date: "2026-09-23",
  meal: "Lunch",
  name: "Test meal",
  brand: "",
  serving: 100,
  unit: "g",
  calories: 300,
  protein: 20,
  carbs: 40,
  fat: 6,
  fibre: 1,
  source: "Test fixture",
});
describe("authentication and authorization", () => {
  it("requires authentication", async () => {
    await request(app).get("/api/snapshot").expect(401);
  });
  it("requires mutation request protection", async () => {
    await request(app).post("/api/auth/register").send({}).expect(403);
  });
  it("blocks foreign origins", async () => {
    await request(app)
      .post("/api/auth/register")
      .set("X-Bulkbro-Client", "1")
      .set("Origin", "https://evil.example")
      .send({})
      .expect(403);
  });
  it("rejects short passwords and duplicate accounts", async () => {
    await request(app)
      .post("/api/auth/register")
      .set("X-Bulkbro-Client", "1")
      .send({ email: "a@example.test", password: "short" })
      .expect(400);
    await account();
    await request(app)
      .post("/api/auth/register")
      .set("X-Bulkbro-Client", "1")
      .send({ email: "one@example.test", password: "a-strong-test-password" })
      .expect(409);
  });
  it("hashes passwords, sets HttpOnly cookies and invalidates logout", async () => {
    const agent = await account();
    const row = db.prepare("SELECT password FROM users").get();
    expect(row?.password).not.toContain("a-strong-test-password");
    const r = await agent
      .post("/api/auth/login")
      .set("X-Bulkbro-Client", "1")
      .send({ email: "one@example.test", password: "a-strong-test-password" })
      .expect(200);
    expect(r.headers["set-cookie"][0]).toContain("HttpOnly");
    await agent
      .post("/api/auth/logout")
      .set("X-Bulkbro-Client", "1")
      .expect(200);
    await agent.get("/api/snapshot").expect(401);
  });
  it("rejects incorrect credentials", async () => {
    await account();
    await request(app)
      .post("/api/auth/login")
      .set("X-Bulkbro-Client", "1")
      .send({ email: "one@example.test", password: "a-wrong-long-password" })
      .expect(401);
  });
  it("isolates users and cannot delete another diary entry", async () => {
    const a = await account(),
      b = await account("two@example.test"),
      f = food();
    await a
      .post("/api/logs")
      .set("X-Bulkbro-Client", "1")
      .send([f])
      .expect(201);
    await b
      .delete("/api/logs/" + f.id)
      .set("X-Bulkbro-Client", "1")
      .expect(200);
    expect((await a.get("/api/snapshot")).body.logs).toHaveLength(1);
    expect((await b.get("/api/snapshot")).body.logs).toHaveLength(0);
  });
  it("keeps two friends' foods, goals, recents, favorites, reusable meals and exported notes private", async () => {
    const a = await account();
    const b = await account("friend@example.test");
    const aId = (await a.get("/api/snapshot")).body.user.id;
    const bId = (await b.get("/api/snapshot")).body.user.id;
    const aFood = (
      await a
        .post("/api/foods")
        .set("X-Bulkbro-Client", "1")
        .send({ ...food(), name: "Private oats" })
        .expect(201)
    ).body;
    const bFood = (
      await b
        .post("/api/foods")
        .set("X-Bulkbro-Client", "1")
        .send({ ...food(), name: "Friend toast" })
        .expect(201)
    ).body;
    const privateLog = { ...food(), name: "Private lunch" };
    await a
      .post("/api/logs")
      .set("X-Bulkbro-Client", "1")
      .send([privateLog])
      .expect(201);
    await b
      .post("/api/logs")
      .set("X-Bulkbro-Client", "1")
      .send([{ ...food(), name: "Friend lunch" }])
      .expect(201);
    await a
      .put("/api/profile")
      .set("X-Bulkbro-Client", "1")
      .send({
        ...profile,
        targets: { calories: 2300, protein: 140, carbs: 260, fat: 70 },
      })
      .expect(200);
    await b
      .put("/api/profile")
      .set("X-Bulkbro-Client", "1")
      .send({
        ...profile,
        username: "friend_user",
        targets: { calories: 2700, protein: 160, carbs: 310, fat: 80 },
      })
      .expect(200);
    await a
      .put("/api/favourites/" + aFood.id)
      .set("X-Bulkbro-Client", "1")
      .send({ active: true })
      .expect(200);
    await b
      .put("/api/favourites/" + aFood.id)
      .set("X-Bulkbro-Client", "1")
      .send({ active: true })
      .expect(404);
    await b
      .put("/api/favourites/" + bFood.id)
      .set("X-Bulkbro-Client", "1")
      .send({ active: true })
      .expect(200);
    const reusable = {
      id: crypto.randomUUID(),
      name: "Private recipe",
      servings: 2,
      ingredients: [aFood],
    };
    await a
      .post("/api/saved-meals")
      .set("X-Bulkbro-Client", "1")
      .send(reusable)
      .expect(201);
    await b
      .post("/api/saved-meals")
      .set("X-Bulkbro-Client", "1")
      .send(reusable)
      .expect(409);
    const analysisId = crypto.randomUUID();
    db.prepare("INSERT INTO analyses VALUES(?,?,?,?,?)").run(
      analysisId,
      aId,
      JSON.stringify({ notes: "Private historic note" }),
      null,
      new Date().toISOString(),
    );
    await b
      .put("/api/logs/" + privateLog.id)
      .set("X-Bulkbro-Client", "1")
      .send({ ...privateLog, calories: 1 })
      .expect(404);
    await b
      .delete("/api/logs?date=2026-09-23&meal=Breakfast")
      .set("X-Bulkbro-Client", "1")
      .expect(200);
    const network = vi.fn(() =>
      Promise.reject(new Error("External API must not be called")),
    );
    vi.stubGlobal("fetch", network);
    const ownSearch = (await a.get("/api/foods/search?q=Private").expect(200))
      .body;
    const friendSearch = (
      await b.get("/api/foods/search?q=Private").expect(200)
    ).body;
    expect(ownSearch.foods).toHaveLength(2);
    expect(friendSearch.foods).toHaveLength(0);
    expect(network).not.toHaveBeenCalled();
    const aExport = (await a.get("/api/account/export").expect(200)).body;
    const bExport = (await b.get("/api/account/export").expect(200)).body;
    expect(aExport.profile.targets.calories).toBe(2300);
    expect(bExport.profile.targets.calories).toBe(2700);
    expect(aExport.logs[0]).toEqual(privateLog);
    expect(bExport.logs[0].name).toBe("Friend lunch");
    expect(aExport.favourites).toEqual([aFood.id]);
    expect(bExport.favourites).toEqual([bFood.id]);
    expect(aExport.savedMeals).toHaveLength(1);
    expect(bExport.savedMeals).toHaveLength(0);
    expect(aExport.analyses).toHaveLength(1);
    expect(bExport.analyses).toHaveLength(0);
    expect(JSON.stringify(bExport)).not.toContain("Private");
    expect(aExport.user.id).toBe(aId);
    expect(bExport.user.id).toBe(bId);
    await a.post("/api/auth/logout").set("X-Bulkbro-Client", "1").expect(200);
    await a.get("/api/account/export").expect(401);
    await a
      .post("/api/auth/login")
      .set("X-Bulkbro-Client", "1")
      .send({
        email: "friend@example.test",
        password: "a-strong-test-password",
      })
      .expect(200);
    expect((await a.get("/api/snapshot")).body).toEqual(
      (await b.get("/api/snapshot")).body,
    );
  });
  it("rejects queued mutations when another account signed in on the same browser", async () => {
    const a = await account();
    const aId = (await a.get("/api/snapshot")).body.user.id;
    await account("friend@example.test");
    await a
      .post("/api/auth/login")
      .set("X-Bulkbro-Client", "1")
      .send({
        email: "friend@example.test",
        password: "a-strong-test-password",
      })
      .expect(200);
    const response = await a
      .post("/api/logs")
      .set("X-Bulkbro-Client", "1")
      .set("X-Bulkbro-User", aId)
      .send([food()])
      .expect(409);
    expect(response.body.code).toBe("ACCOUNT_CHANGED");
    expect((await a.get("/api/snapshot")).body.logs).toEqual([]);
  });
  it("defers every AI endpoint without making a paid request", async () => {
    const a = await account();
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    for (const path of ["/api/ai/meal", "/api/ai/coach"]) {
      const response = await a
        .post(path)
        .set("X-Bulkbro-Client", "1")
        .send({})
        .expect(410);
      expect(response.body.code).toBe("AI_DEFERRED");
    }
    expect(network).not.toHaveBeenCalled();
  });
});
describe("data persistence and calculations", () => {
  it.each([
    { unit: "g", serving: 100, first: 150, corrected: 200 },
    { unit: "servings", serving: 1, first: 1.5, corrected: 2 },
  ])(
    "creates a food, scales $unit, corrects and deletes without changing the food definition",
    async ({ unit, serving, first, corrected }) => {
      const a = await account();
      const definition: Food = { ...food(), unit, serving };
      const created = await a
        .post("/api/foods")
        .set("X-Bulkbro-Client", "1")
        .send(definition)
        .expect(201);
      const id = crypto.randomUUID();
      const entry = {
        ...scaleFood(created.body, first),
        id,
        date: "2026-09-23",
        meal: "Lunch",
      };
      await a
        .post("/api/logs")
        .set("X-Bulkbro-Client", "1")
        .send([entry])
        .expect(201);
      let state: Snapshot = (await a.get("/api/snapshot")).body;
      expect(totals(state.logs)).toEqual({
        calories: 450,
        protein: 30,
        carbs: 60,
        fat: 9,
      });
      const correction = { ...entry, ...scaleFood(entry, corrected) };
      await a
        .put("/api/logs/" + id)
        .set("X-Bulkbro-Client", "1")
        .send(correction)
        .expect(200);
      state = (await a.get("/api/snapshot")).body;
      expect(totals(state.logs)).toEqual({
        calories: 600,
        protein: 40,
        carbs: 80,
        fat: 12,
      });
      expect(state.foods[0].calories).toBe(300);
      await a
        .delete("/api/logs/" + id)
        .set("X-Bulkbro-Client", "1")
        .expect(200);
      state = (await a.get("/api/snapshot")).body;
      expect(totals(state.logs)).toEqual({
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
      });
      expect(state.foods).toHaveLength(1);
    },
  );
  it("changing goals preserves every historical food value", async () => {
    const a = await account();
    const entry = food();
    await a
      .post("/api/logs")
      .set("X-Bulkbro-Client", "1")
      .send([entry])
      .expect(201);
    await a
      .put("/api/profile")
      .set("X-Bulkbro-Client", "1")
      .send({
        ...profile,
        targets: { calories: 2200, protein: 130, carbs: 250, fat: 65 },
      })
      .expect(200);
    const before = (await a.get("/api/snapshot")).body;
    await a
      .put("/api/profile")
      .set("X-Bulkbro-Client", "1")
      .send({
        ...profile,
        targets: { calories: 2600, protein: 160, carbs: 300, fat: 70 },
      })
      .expect(200);
    const after = (await a.get("/api/snapshot")).body;
    expect(after.logs).toEqual(before.logs);
    expect(after.profile.targets.calories).toBe(2600);
  });
  it("keeps accounts, definitions, meals and goals through a database restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bulkbro-persistence-"));
    db.close();
    db = openDatabase(join(directory, "tracker.sqlite"));
    app = createApp(db);
    try {
      const a = await account();
      const entry = food();
      await a
        .put("/api/profile")
        .set("X-Bulkbro-Client", "1")
        .send(profile)
        .expect(200);
      await a
        .post("/api/foods")
        .set("X-Bulkbro-Client", "1")
        .send(entry)
        .expect(201);
      await a
        .post("/api/logs")
        .set("X-Bulkbro-Client", "1")
        .send([entry])
        .expect(201);
      const before = (await a.get("/api/snapshot")).body;
      db.close();
      db = openDatabase(join(directory, "tracker.sqlite"));
      app = createApp(db);
      const reloaded = request.agent(app);
      await reloaded
        .post("/api/auth/login")
        .set("X-Bulkbro-Client", "1")
        .send({ email: "one@example.test", password: "a-strong-test-password" })
        .expect(200);
      expect((await reloaded.get("/api/snapshot")).body).toEqual(before);
    } finally {
      db.close();
      db = openDatabase(":memory:");
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("stores independently editable calorie and macro targets and rejects a zero calorie goal", async () => {
    const a = await account();
    await a
      .put("/api/profile")
      .set("X-Bulkbro-Client", "1")
      .send(profile)
      .expect(200);
    await a
      .put("/api/profile")
      .set("X-Bulkbro-Client", "1")
      .send({
        ...profile,
        targets: { calories: 2500, protein: 1, carbs: 1, fat: 1 },
      })
      .expect(200);
    await a
      .put("/api/profile")
      .set("X-Bulkbro-Client", "1")
      .send({
        ...profile,
        targets: { calories: 0, protein: 1, carbs: 1, fat: 1 },
      })
      .expect(400);
    await a
      .put("/api/profile")
      .set("X-Bulkbro-Client", "1")
      .send({ ...profile, targets: calculateTargets(profile).targets })
      .expect(200);
  });
  it("makes offline food retries idempotent", async () => {
    const a = await account(),
      f = food();
    for (let i = 0; i < 2; i++)
      await a
        .post("/api/logs")
        .set("X-Bulkbro-Client", "1")
        .send([f])
        .expect(201);
    expect((await a.get("/api/snapshot")).body.logs).toHaveLength(1);
  });
  it("rejects negative nutrition and malformed dates", async () => {
    const a = await account();
    await a
      .post("/api/logs")
      .set("X-Bulkbro-Client", "1")
      .send([{ ...food(), calories: -5 }])
      .expect(400);
    await a
      .post("/api/logs")
      .set("X-Bulkbro-Client", "1")
      .send([{ ...food(), date: "2026-02-31" }])
      .expect(400);
  });
  it("upserts one weight per date and one activity total", async () => {
    const a = await account();
    for (const weight of [80, 81])
      await a
        .post("/api/weights")
        .set("X-Bulkbro-Client", "1")
        .send({ id: crypto.randomUUID(), date: "2026-09-23", weight })
        .expect(201);
    for (const steps of [100, 200])
      await a
        .put("/api/activity")
        .set("X-Bulkbro-Client", "1")
        .send({ date: "2026-09-23", steps, water: 1, activeCalories: 0 })
        .expect(200);
    const s = (await a.get("/api/snapshot")).body;
    expect(s.weights).toHaveLength(1);
    expect(s.weights[0].weight).toBe(81);
    expect(s.activity[0].steps).toBe(200);
  });
  it("stores workout sets relationally and rejects foreign analysis references", async () => {
    const a = await account();
    await a.put("/api/profile").set("X-Bulkbro-Client", "1").send(profile);
    const w = {
      id: crypto.randomUUID(),
      date: "2026-09-23",
      name: "Push",
      duration: 60,
      intensity: "moderate",
      exercises: [{ name: "Bench", sets: [{ weight: 80, reps: 8 }] }],
    };
    for (let i = 0; i < 2; i++)
      await a
        .post("/api/workouts")
        .set("X-Bulkbro-Client", "1")
        .send(w)
        .expect(i === 0 ? 201 : 200);
    expect(
      db.prepare("SELECT COUNT(*) as count FROM workout_sets").get()?.count,
    ).toBe(1);
    expect((await a.get("/api/snapshot")).body.workouts[0].calories).toBe(210);
    await a
      .post("/api/logs")
      .set("X-Bulkbro-Client", "1")
      .send([{ ...food(), analysisId: crypto.randomUUID() }])
      .expect(403);
  });
  it("exports data without credentials and cascades account deletion", async () => {
    const a = await account();
    await a.post("/api/logs").set("X-Bulkbro-Client", "1").send([food()]);
    const exportData = await a.get("/api/account/export").expect(200);
    expect(exportData.body.user).not.toHaveProperty("password");
    await a
      .delete("/api/account")
      .set("X-Bulkbro-Client", "1")
      .send({ password: "a-strong-test-password" })
      .expect(200);
    expect(
      db.prepare("SELECT COUNT(*) as count FROM food_logs").get()?.count,
    ).toBe(0);
    await a.get("/api/snapshot").expect(401);
  });
});
