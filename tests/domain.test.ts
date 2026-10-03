import { describe, it, expect } from "vitest";
import {
  calculateTargets,
  macroCalories,
  scaleFood,
  totals,
  volume,
  workoutEnergy,
  streak,
  mealStreak,
  localDate,
  offsetDate,
  achievements,
  rollingWeights,
  personalRecords,
  profileSchema,
  dateSchema,
  logBatchSchema,
  savedMealSchema,
  workoutSchema,
  type Profile,
  type Food,
  type Workout,
  type Snapshot,
} from "../shared/domain";
import { parseProduct } from "../server/nutrition";
import { recognitionSchema } from "../server/ai";
import { classifyAiError } from "../server/ai-errors";
import { newId } from "../src/id";
import { z } from "zod";
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
describe("meal-day streaks", () => {
  it("starts empty, counts a saved day once and ignores future/invalid dates", () => {
    expect(mealStreak([], "2026-10-03")).toEqual({
      current: 0,
      best: 0,
      completedToday: false,
      loggedDays: 0,
    });
    expect(
      mealStreak(
        ["2026-10-03", "2026-10-03", "2026-10-04", "2026-02-30", "bad"],
        "2026-10-03",
      ),
    ).toEqual({ current: 1, best: 1, completedToday: true, loggedDays: 1 });
  });
  it("keeps yesterday's streak until an entire local day is missed", () => {
    const dates = ["2026-10-01", "2026-10-02"];
    expect(mealStreak(dates, "2026-10-02")).toMatchObject({
      current: 2,
      completedToday: true,
    });
    expect(mealStreak(dates, "2026-10-03")).toMatchObject({
      current: 2,
      completedToday: false,
    });
    expect(mealStreak(dates, "2026-10-04")).toMatchObject({
      current: 0,
      best: 2,
    });
  });
  it("joins a gap on backfill and removes a day only when its final food is deleted", () => {
    const dates = ["2026-10-01", "2026-10-03", "2026-10-03"];
    expect(mealStreak(dates, "2026-10-03").current).toBe(1);
    const backfilled = [...dates, "2026-10-02"];
    expect(mealStreak(backfilled, "2026-10-03")).toMatchObject({
      current: 3,
      best: 3,
    });
    expect(mealStreak(backfilled.slice(1), "2026-10-03").current).toBe(2);
    expect(
      mealStreak(["2026-10-01", "2026-10-02", "2026-10-03"], "2026-10-03")
        .current,
    ).toBe(3);
    expect(
      mealStreak(["2026-10-01", "2026-10-03"], "2026-10-03"),
    ).toMatchObject({
      current: 1,
      best: 1,
    });
  });
  it("retains the best historical run after a missed day", () => {
    expect(
      mealStreak(
        ["2026-09-29", "2026-09-27", "2026-09-28", "2026-10-03"],
        "2026-10-03",
      ),
    ).toMatchObject({ current: 1, best: 3 });
  });
  it("rolls over at local midnight and changes only today's boundary after travel", () => {
    const dates = ["2026-10-01", "2026-10-02"];
    const instant = new Date("2026-10-03T23:00:00Z");
    expect(localDate(instant, "Europe/London")).toBe("2026-10-04");
    expect(localDate(instant, "America/Los_Angeles")).toBe("2026-10-03");
    expect(mealStreak(dates, localDate(instant, "Europe/London")).current).toBe(
      0,
    );
    expect(
      mealStreak(dates, localDate(instant, "America/Los_Angeles")).current,
    ).toBe(2);
    expect(dates).toEqual(["2026-10-01", "2026-10-02"]);
    const before = new Date("2026-10-03T22:59:59Z");
    expect(mealStreak(dates, localDate(before, "Europe/London")).current).toBe(
      2,
    );
  });
  it("does calendar arithmetic across DST, leap days and year boundaries", () => {
    expect(offsetDate("2026-03-29", 1)).toBe("2026-03-30");
    expect(offsetDate("2026-10-25", -1)).toBe("2026-10-24");
    expect(offsetDate("2024-03-01", -1)).toBe("2024-02-29");
    expect(offsetDate("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("keeps earned habit achievements after a gap and recalculates corrections", () => {
    const snapshot: Snapshot = {
      user: { id: "test", email: "test@example.test" },
      profile,
      foods: [],
      logs: Array.from({ length: 7 }, (_, i) => ({
        ...food,
        id: crypto.randomUUID(),
        date: offsetDate("2026-09-01", i),
        meal: "Breakfast",
      })),
      workouts: [],
      weights: [],
      activity: [],
      savedMeals: [],
      favourites: [],
    };
    const habit = (s: Snapshot) =>
      achievements(s, "2026-10-03").find(
        (a) => a.title === "Building the habit",
      );
    expect(habit(snapshot)?.value).toBe(7);
    expect(habit({ ...snapshot, logs: snapshot.logs.slice(1) })?.value).toBe(6);
    expect(
      achievements(
        { ...snapshot, logs: [{ ...snapshot.logs[0], date: "2026-10-04" }] },
        "2026-10-03",
      ).find((a) => a.title === "First fuel")?.value,
    ).toBe(0);
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

describe("collection validation budgets", () => {
  function unreadableItems(length: number) {
    const items = new Array(length);
    Object.defineProperty(items, 0, {
      get() {
        throw new Error("Oversized collections must not inspect their items");
      },
    });
    return items;
  }

  it.each([
    ["logs", () => logBatchSchema.safeParse(unreadableItems(51)), []],
    [
      "ingredients",
      () =>
        savedMealSchema.safeParse({
          id: crypto.randomUUID(),
          name: "Recipe",
          servings: 1,
          ingredients: unreadableItems(101),
        }),
      ["ingredients"],
    ],
    [
      "exercises",
      () =>
        workoutSchema.safeParse({ ...workout, exercises: unreadableItems(41) }),
      ["exercises"],
    ],
    [
      "sets",
      () =>
        workoutSchema.safeParse({
          ...workout,
          exercises: [{ name: "Bench press", sets: unreadableItems(31) }],
        }),
      ["exercises", 0, "sets"],
    ],
  ] as const)(
    "rejects excess %s before reading any item",
    (_name, parse, path) => {
      const result = parse();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0]).toMatchObject({ code: "too_big", path });
      }
    },
  );

  it("preserves maximum collections, defaults and extendable workout objects", () => {
    const log = {
      ...food,
      id: crypto.randomUUID(),
      date: "2026-09-20",
      meal: "Lunch",
    };
    expect(
      logBatchSchema.parse(Array.from({ length: 50 }, () => log)),
    ).toHaveLength(50);
    expect(
      savedMealSchema.parse({
        id: crypto.randomUUID(),
        name: "Recipe",
        servings: 1,
        ingredients: Array.from({ length: 100 }, () => food),
      }).ingredients,
    ).toHaveLength(100);
    const extended = workoutSchema.extend({ calories: z.number().optional() });
    const result = extended.parse({
      ...workout,
      calories: 100,
      exercises: Array.from({ length: 40 }, () => ({
        name: "Bench press",
        sets: Array.from({ length: 30 }, () => ({ weight: 80, reps: 8 })),
      })),
    });
    expect(result.exercises).toHaveLength(40);
    expect(result.exercises[0].sets).toHaveLength(30);
    expect(result.calories).toBe(100);
    expect(logBatchSchema.safeParse([]).success).toBe(false);
    expect(workoutSchema.safeParse({ ...workout, exercises: [] }).success).toBe(
      false,
    );
    expect(
      workoutSchema.safeParse({
        ...workout,
        exercises: [{ name: "Bench press", sets: [] }],
      }).success,
    ).toBe(false);
  });
});
