import { z } from "zod";
import { foodSchema, type Food } from "../shared/domain";
const productSchema = z
  .object({
    code: z.string().optional(),
    product_name: z.string().optional(),
    brands: z
      .union([
        z.string(),
        z.array(z.string()).transform((values) => values.join(", ")),
      ])
      .optional(),
    nutriments: z.record(z.unknown()).optional(),
  })
  .passthrough();
export function parseProduct(input: unknown): Food | null {
  const p = productSchema.safeParse(input);
  if (!p.success || !p.data.product_name || !p.data.nutriments) return null;
  const n = p.data.nutriments;
  const values = [
    n["energy-kcal_100g"] ??
      (typeof n.energy_100g === "number" ? n.energy_100g / 4.184 : undefined),
    n.proteins_100g,
    n.carbohydrates_100g,
    n.fat_100g,
  ];
  if (values.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0))
    return null;
  const result = foodSchema.safeParse({
    name: p.data.product_name,
    brand: p.data.brands ?? "",
    serving: 100,
    unit: "g",
    calories: values[0],
    protein: values[1],
    carbs: values[2],
    fat: values[3],
    fibre: typeof n.fiber_100g === "number" ? n.fiber_100g : 0,
    source: "Open Food Facts (ODbL)",
  });
  return result.success ? { ...result.data, id: p.data.code } : null;
}
async function request(url: string) {
  const r = await fetch(url, {
    headers: { "User-Agent": "BulkBro/0.1 (personal nutrition tracker)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok)
    throw Error(
      "Food database is temporarily unavailable. Try again or use manual entry.",
    );
  return r.json();
}
const searchCache = new Map<string, { expires: number; foods: Food[] }>();
export async function searchFoods(query: string): Promise<Food[]> {
  const key = query.trim().toLowerCase();
  const cached = searchCache.get(key);
  if (cached && cached.expires > Date.now())
    return structuredClone(cached.foods);
  // The dedicated full-text service supports relevant name/brand matching;
  // Product Opener's v2 search does not support equivalent full-text queries.
  const r = await fetch("https://search.openfoodfacts.org/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "BulkBro/0.1 (personal nutrition tracker)",
    },
    body: JSON.stringify({
      q: query,
      page_size: 16,
      langs: ["en"],
      fields: ["code", "product_name", "brands", "nutriments"],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok)
    throw Error(
      "Food database is temporarily unavailable. Try again or use manual entry.",
    );
  const d = await r.json();
  const foods = (Array.isArray(d.hits) ? d.hits : [])
    .map(parseProduct)
    .filter((p: Food | null): p is Food => p !== null);
  if (searchCache.size >= 200)
    searchCache.delete(searchCache.keys().next().value!);
  searchCache.set(key, { expires: Date.now() + 10 * 60000, foods });
  return structuredClone(foods);
}
export async function barcodeFood(code: string) {
  const d = await request(
    `https://world.openfoodfacts.org/api/v2/product/${code}?fields=code,product_name,brands,nutriments`,
  );
  return parseProduct(d.product);
}
export async function mealMatches(query: string): Promise<Food[]> {
  if (!process.env.USDA_API_KEY) return searchFoods(query);
  const r = await fetch(
    "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=" +
      encodeURIComponent(process.env.USDA_API_KEY),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        pageSize: 5,
        dataType: ["Foundation", "SR Legacy"],
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!r.ok) throw Error("Nutrition lookup unavailable");
  const d = await r.json();
  return (d.foods ?? [])
    .map(
      (f: {
        fdcId: number;
        description: string;
        foodNutrients: { nutrientId: number; value: number }[];
      }) => {
        const nutrient = (id: number) =>
          f.foodNutrients.find((n) => n.nutrientId === id)?.value;
        return {
          id: String(f.fdcId),
          name: f.description,
          brand: "",
          serving: 100,
          unit: "g",
          calories: nutrient(1008),
          protein: nutrient(1003),
          carbs: nutrient(1005),
          fat: nutrient(1004),
          fibre: nutrient(1079) ?? 0,
          source: "USDA FoodData Central",
        };
      },
    )
    .filter((f: unknown) => foodSchema.safeParse(f).success);
}
