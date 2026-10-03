import { describe, it, expect } from "vitest";
import {
  calculateTargets,
  macroCalories,
  scaleFood,
  totals,
  volume,
  workoutEnergy,
  streak,
  rollingWeights,
  personalRecords,
  profileSchema,
  dateSchema,
  type Profile,
  type Food,
  type Workout,
} from "../shared/domain";
import { parseProduct } from "../server/nutrition";
import { recognitionSchema } from "../server/ai";
import { classifyAiError } from "../server/ai-errors";
import { newId } from "../src/id";
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
const food: Food = {
  name: "Test food",
  brand: "",
  serving: 100,
  unit: "g",
  calories: 200,
  protein: 10,
  carbs: 30,
  fat: 4,
  fibre: 2,
  source: "Test fixture",
};
const workout: Workout = {
  id: crypto.randomUUID(),
  date: "2026-09-20",
  name: "Push",
  duration: 45,
  intensity: "moderate",
  exercises: [
    {
      name: "Bench press",
      sets: [
        { weight: 80, reps: 8 },
        { weight: 80, reps: 7 },
      ],
    },
  ],
};
describe("nutrition mathematics", () => {
  it("accepts brand arrays from the full-text search service", () => {
    const food = parseProduct({
      product_name: "Porridge",
      brands: ["Brand one"],
      nutriments: {
        "energy-kcal_100g": 371,
        proteins_100g: 11,
        carbohydrates_100g: 64,
        fat_100g: 5.8,
      },
    });
    expect(food?.brand).toBe("Brand one");
  });
  it("uses Mifflin–St Jeor and the chosen activity multiplier", () => {
    const c = calculateTargets(profile);
    expect(c.bmr).toBe(1780);
    expect(c.tdee).toBe(2759);
    expect(c.recommended).toBe(2959);
  });
  it("uses the female equation", () =>
    expect(calculateTargets({ ...profile, sex: "female" }).bmr).toBe(1614));
  it("keeps recommended macro energy equal to calories", () => {
    for (const goal of ["gain", "maintain", "lose"] as const)
      for (const speed of ["slow", "moderate", "aggressive"] as const) {
        const c = calculateTargets({ ...profile, goal, speed });
        expect(macroCalories(c.targets)).toBeCloseTo(c.recommended, 8);
      }
  });
  it("applies a conservative floor instead of extreme restriction", () =>
    expect(
      calculateTargets({
        ...profile,
        sex: "female",
        weight: 40,
        height: 145,
        activity: "sedentary",
        goal: "lose",
        speed: "aggressive",
      }).recommended,
    ).toBeGreaterThanOrEqual(1200));
  it("rejects underage profile targets", () =>
    expect(profileSchema.safeParse({ ...profile, age: 17 }).success).toBe(
      false,
    ));
  it("scales all nutrients from 30g to 75g without rounding accumulation", () => {
    const f = { ...food, serving: 30 };
    const scaled = scaleFood(f, 75);
    expect(scaled.calories).toBe(500);
    expect(scaled.protein).toBe(25);
    expect(scaled.fibre).toBe(5);
    expect(scaleFood(scaled, 30)).toEqual(f);
  });
  it("rejects invalid servings", () => {
    expect(() => scaleFood(food, 0)).toThrow();
    expect(() => scaleFood(food, NaN)).toThrow();
  });
  it("aggregates an empty diary and multiple foods", () => {
    expect(totals([]).calories).toBe(0);
    expect(totals([food, food]).protein).toBe(20);
  });
  it("rejects missing database macros rather than silently treating them as zero", () =>
    expect(
      parseProduct({
        product_name: "Unknown",
        nutriments: { "energy-kcal_100g": 100 },
      }),
    ).toBeNull());
  it("parses complete product nutrition and converts kJ when needed", () => {
    expect(
      parseProduct({
        code: "12345678",
        product_name: "Fixture",
        nutriments: {
          energy_100g: 418.4,
          proteins_100g: 5,
          carbohydrates_100g: 10,
          fat_100g: 3,
        },
      })?.calories,
    ).toBeCloseTo(100);
  });
});
describe("training and progress", () => {
  it("calculates volume from load times repetitions", () =>
    expect(volume(workout)).toBe(1200));
  it("estimates net activity energy from MET, time and mass", () =>
    expect(workoutEnergy(80, 60, "moderate")).toBe(210));
  it("detects improvements only after an exercise baseline", () => {
    expect(personalRecords([workout])).toEqual([]);
    const next = {
      ...workout,
      id: crypto.randomUUID(),
      date: "2026-09-21",
      exercises: [
        {
          name: "Bench press",
          sets: [
            { weight: 90, reps: 9 },
            { weight: 90, reps: 8 },
          ],
        },
      ],
    };
    expect(personalRecords([workout, next]).map((r) => r.type)).toEqual([
      "Heaviest lift",
      "Rep record",
      "Session volume",
    ]);
  });
  it("allows today to be unfinished in a logging streak", () =>
    expect(
      streak(["2026-09-20", "2026-09-21", "2026-09-22"], "2026-09-23"),
    ).toBe(3));
  it("ignores duplicate dates and stops at a missing day", () =>
    expect(
      streak(["2026-09-23", "2026-09-23", "2026-09-21"], "2026-09-23"),
    ).toBe(1));
  it("averages calendar windows instead of the last seven entries", () => {
    const w = rollingWeights([
      { id: "a", date: "2026-08-01", weight: 70 },
      { id: "b", date: "2026-09-20", weight: 80 },
      { id: "c", date: "2026-09-23", weight: 82 },
    ]);
    expect(w[2].average).toBe(81);
  });
  it("rejects impossible calendar dates", () => {
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(dateSchema.safeParse("2026-02-28").success).toBe(true);
  });
  it("validates AI recognition and disallows nonsensical portions", () => {
    expect(
      recognitionSchema.safeParse({
        foods: [{ name: "Rice", grams: -5, confidence: "high" }],
        questions: [],
      }).success,
    ).toBe(false);
    expect(
      recognitionSchema.safeParse({
        foods: [{ name: "Rice", grams: 150, confidence: "medium" }],
        questions: ["Was oil added?"],
      }).success,
    ).toBe(true);
  });
});
describe("AI service failures", () => {
  it("distinguishes exhausted credit from a temporary rate limit", () => {
    expect(
      classifyAiError({ status: 429, code: "credit_balance_exhausted" }),
    ).toMatchObject({ status: 503, code: "AI_CREDITS_EXHAUSTED" });
    expect(
      classifyAiError({ status: 429, code: "rate_limit_exceeded" }),
    ).toMatchObject({ status: 429, code: "AI_RATE_LIMIT" });
    expect(
      classifyAiError({ status: 401, code: "invalid_api_key" }),
    ).toMatchObject({ code: "AI_KEY_UNAVAILABLE" });
  });
});
describe("LAN-safe identifiers", () => {
  it("creates distinct RFC 4122 v4 identifiers from random bytes", () => {
    const a = newId(),
      b = newId();
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(b).not.toBe(a);
  });
});
