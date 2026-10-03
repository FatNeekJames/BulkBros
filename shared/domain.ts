import { z } from "zod";
function boundedArray<T extends z.ZodTypeAny>(item: T, maximum: number) {
  return z.preprocess((value, context) => {
    // Zod's array .max() records an issue but still parses every child.
    if (Array.isArray(value) && value.length > maximum) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        type: "array",
        maximum,
        inclusive: true,
        fatal: true,
      });
      return z.NEVER;
    }
    return value;
  }, z.array(item).min(1).max(maximum));
}
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Invalid date",
  );
const number = (min = 0, max = 10000) => z.number().finite().min(min).max(max);
export const macrosSchema = z.object({
  calories: number(),
  protein: number(0, 1500),
  carbs: number(0, 2000),
  fat: number(0, 1000),
});
export type Macros = z.infer<typeof macrosSchema>;
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  username: z.string().regex(/^[a-zA-Z0-9_]{3,30}$/),
  age: number(18, 100).int(),
  sex: z.enum(["male", "female"]),
  height: number(100, 250),
  weight: number(30, 350),
  targetWeight: number(30, 350),
  units: z.enum(["metric", "imperial"]),
  activity: z.enum(["sedentary", "light", "moderate", "very", "extreme"]),
  workoutsPerWeek: number(0, 14).int(),
  goal: z.enum(["lose", "maintain", "gain"]),
  speed: z.enum(["slow", "moderate", "aggressive"]),
  stepGoal: number(100, 100000).int(),
  exerciseCalories: z.boolean().default(false),
  targets: macrosSchema.optional(),
});
export type Profile = z.infer<typeof profileSchema>;
export const foodSchema = macrosSchema.extend({
  name: z.string().trim().min(1).max(150),
  brand: z.string().max(100).default(""),
  serving: number(0.1, 10000),
  unit: z.string().min(1).max(20).default("g"),
  source: z.string().max(200).default("User entry"),
  fibre: number(0, 1000).default(0),
});
export type Food = z.infer<typeof foodSchema> & { id?: string };
export const logSchema = foodSchema.extend({
  id: z.string().uuid(),
  date: dateSchema,
  meal: z.string().trim().min(1).max(40),
  analysisId: z.string().uuid().optional(),
});
export type FoodLog = z.infer<typeof logSchema>;
export const logBatchSchema = boundedArray(logSchema, 50);
export const savedMealSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  servings: z.number().finite().min(0.1).max(1000),
  ingredients: boundedArray(foodSchema, 100),
});
export const setSchema = z.object({
  weight: number(0, 1500),
  reps: number(1, 1000).int(),
  rpe: number(1, 10).optional(),
});
export const workoutSchema = z.object({
  id: z.string().uuid(),
  date: dateSchema,
  name: z.string().trim().min(1).max(100),
  duration: number(1, 600),
  intensity: z.enum(["light", "moderate", "vigorous"]),
  exercises: boundedArray(
    z.object({
      name: z.string().trim().min(1).max(100),
      sets: boundedArray(setSchema, 30),
    }),
    40,
  ),
});
export type Workout = z.infer<typeof workoutSchema> & { calories?: number };
export type WeightEntry = { id: string; date: string; weight: number };
export type Activity = {
  date: string;
  steps: number;
  water: number;
  activeCalories: number;
};
export type SavedMeal = {
  id: string;
  name: string;
  servings: number;
  ingredients: Food[];
};
export type Snapshot = {
  user: { id: string; email: string };
  profile: Profile | null;
  foods: Food[];
  logs: FoodLog[];
  weights: WeightEntry[];
  workouts: Workout[];
  activity: Activity[];
  savedMeals: SavedMeal[];
  favourites: string[];
};
export const factors = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  extreme: 1.9,
};
export function calculateTargets(p: Profile) {
  const bmr =
    10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const tdee = Math.round(bmr * factors[p.activity]);
  const adjustment =
    p.goal === "maintain"
      ? 0
      : (p.goal === "gain"
          ? { slow: 200, moderate: 350, aggressive: 500 }
          : { slow: -250, moderate: -400, aggressive: -600 })[p.speed];
  const recommended = Math.max(
    p.sex === "male" ? 1500 : 1200,
    tdee + adjustment,
  );
  const protein = Math.round(p.weight * 1.8),
    fat = Math.round((recommended * 0.25) / 9),
    carbs = Math.max(0, (recommended - protein * 4 - fat * 9) / 4);
  return {
    bmr: Math.round(bmr),
    tdee,
    recommended,
    targets: { calories: recommended, protein, carbs, fat },
  };
}
export function macroCalories(m: Pick<Macros, "protein" | "carbs" | "fat">) {
  return m.protein * 4 + m.carbs * 4 + m.fat * 9;
}
export function scaleFood(f: Food, amount: number): Food {
  if (!Number.isFinite(amount) || amount <= 0 || f.serving <= 0)
    throw Error("Invalid serving");
  const ratio = amount / f.serving;
  return {
    ...f,
    serving: amount,
    calories: f.calories * ratio,
    protein: f.protein * ratio,
    carbs: f.carbs * ratio,
    fat: f.fat * ratio,
    fibre: f.fibre * ratio,
  };
}
export function totals(
  foods: Pick<Food, "calories" | "protein" | "carbs" | "fat">[],
): Macros {
  return foods.reduce(
    (a, f) => ({
      calories: a.calories + f.calories,
      protein: a.protein + f.protein,
      carbs: a.carbs + f.carbs,
      fat: a.fat + f.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}
export function volume(w: Workout) {
  return w.exercises.reduce(
    (a, e) => a + e.sets.reduce((b, s) => b + s.weight * s.reps, 0),
    0,
  );
}
export function workoutEnergy(
  weight: number,
  minutes: number,
  intensity: Workout["intensity"],
) {
  return Math.round(
    ((({ light: 3, moderate: 3.5, vigorous: 6 }[intensity] - 1) *
      3.5 *
      weight) /
      200) *
      minutes,
  );
}
export function currentTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
export function localDate(d = new Date(), timeZone?: string) {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const part = (name: string) => parts.find((p) => p.type === name)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function offsetDate(date: string, n: number) {
  // Calendar arithmetic must not gain or lose a day across DST or travel.
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/**
 * One saved food on a calendar date completes that day, regardless of targets.
 * An unfinished today keeps yesterday's run alive until the next local midnight.
 * Backfills and deletions recalculate both runs from the remaining saved dates;
 * deleting a day's only food removes that day. Future dates never count.
 * Date keys remain as logged when the device timezone changes; only "today"
 * changes. No streak counters or sample dates are persisted separately.
 */
export function mealStreak(dates: string[], today = localDate()) {
  dateSchema.parse(today);
  const days = new Set(
    dates.filter((date) => date <= today && dateSchema.safeParse(date).success),
  );
  let day = days.has(today) ? today : offsetDate(today, -1),
    current = 0;
  while (days.has(day)) {
    current++;
    day = offsetDate(day, -1);
  }
  let best = 0,
    run = 0,
    previous: string | undefined;
  for (const date of [...days].sort()) {
    run = previous && offsetDate(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return {
    current,
    best,
    completedToday: days.has(today),
    loggedDays: days.size,
  };
}
export function streak(dates: string[], today = localDate()) {
  return mealStreak(dates, today).current;
}
export function rollingWeights(entries: WeightEntry[]) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((e) => {
    const recent = sorted.filter(
      (x) => x.date <= e.date && x.date >= offsetDate(e.date, -6),
    );
    return {
      ...e,
      average: recent.reduce((s, x) => s + x.weight, 0) / recent.length,
    };
  });
}
export function personalRecords(workouts: Workout[]) {
  const best = new Map<
    string,
    { weight: number; reps: number; volume: number }
  >();
  const records: {
    exercise: string;
    date: string;
    weight: number;
    reps: number;
    type: string;
  }[] = [];
  for (const w of [...workouts].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const e of w.exercises) {
      const key = e.name.trim().toLowerCase(),
        prev = best.get(key);
      const weight = Math.max(...e.sets.map((s) => s.weight)),
        reps = Math.max(...e.sets.map((s) => s.reps)),
        v = e.sets.reduce((n, s) => n + s.weight * s.reps, 0);
      if (prev) {
        if (weight > prev.weight)
          records.push({
            exercise: e.name,
            date: w.date,
            weight,
            reps: e.sets.find((s) => s.weight === weight)!.reps,
            type: "Heaviest lift",
          });
        if (reps > prev.reps)
          records.push({
            exercise: e.name,
            date: w.date,
            weight: e.sets.find((s) => s.reps === reps)!.weight,
            reps,
            type: "Rep record",
          });
        if (v > prev.volume)
          records.push({
            exercise: e.name,
            date: w.date,
            weight,
            reps,
            type: "Session volume",
          });
      }
      best.set(key, {
        weight: Math.max(weight, prev?.weight ?? 0),
        reps: Math.max(reps, prev?.reps ?? 0),
        volume: Math.max(v, prev?.volume ?? 0),
      });
    }
  }
  return records;
}
export function achievements(s: Snapshot, today = localDate()) {
  const ls = mealStreak(
      s.logs.map((l) => l.date),
      today,
    ),
    prs = personalRecords(s.workouts);
  return [
    {
      title: "First fuel",
      description: "Log your first meal",
      value: ls.loggedDays,
      target: 1,
    },
    {
      title: "Building the habit",
      description: "Log food for 7 consecutive days",
      value: ls.best,
      target: 7,
    },
    {
      title: "Under the bar",
      description: "Complete your first workout",
      value: s.workouts.length,
      target: 1,
    },
    {
      title: "Showing up",
      description: "Complete 10 workouts",
      value: s.workouts.length,
      target: 10,
    },
    {
      title: "A stronger you",
      description: "Set a personal record",
      value: prs.length,
      target: 1,
    },
    {
      title: "Go the distance",
      description: "Walk 100,000 lifetime steps",
      value: s.activity.reduce((n, a) => n + a.steps, 0),
      target: 100000,
    },
    {
      title: "Know your trend",
      description: "Record 7 weigh-ins",
      value: s.weights.length,
      target: 7,
    },
  ];
}
