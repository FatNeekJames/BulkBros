import { afterEach, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import { openDatabase, type DB } from "../server/db";
import { createApp } from "../server/app";
import { calculateTargets, type Profile } from "../shared/domain";
let db: DB, app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDatabase(":memory:");
  app = createApp(db);
});
afterEach(() => db.close());
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
});
describe("data persistence and calculations", () => {
  it("stores a profile and rejects inconsistent manual macros", async () => {
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
