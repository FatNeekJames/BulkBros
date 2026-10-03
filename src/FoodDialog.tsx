import { useEffect, useRef, useState } from "react";
import {
  Search,
  Plus,
  PenLine,
  Bookmark,
  Trash2,
  Star,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { Modal, Field, Empty } from "./components";
import { api } from "./api";
import { newId } from "./id";
import {
  dateSchema,
  localDate,
  foodSchema,
  scaleFood,
  totals,
  type Food,
  type FoodLog,
  type Snapshot,
} from "../shared/domain";

const blank: Food = {
  name: "",
  brand: "",
  serving: 100,
  unit: "g",
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fibre: 0,
  source: "User entry",
};
const nutrients = ["calories", "protein", "carbs", "fat"] as const;
const precision = (n: number) => Number(n.toFixed(1));
const foodKey = (f: Food) =>
  [
    f.name.toLowerCase(),
    f.brand.toLowerCase(),
    f.unit,
    f.serving,
    ...nutrients.map((key) => f[key]),
  ].join("|");
function uniqueFoods(foods: Food[], favourites: string[] = []) {
  const preferredIds = new Set(favourites);
  const unique = new Map<string, Food>();
  for (const food of foods) {
    const key = foodKey(food);
    const existing = unique.get(key);
    if (
      !existing ||
      (food.id &&
        preferredIds.has(food.id) &&
        (!existing.id || !preferredIds.has(existing.id)))
    ) {
      unique.set(key, food);
    }
  }
  return [...unique.values()];
}
type DraftFood = { key: string; base: Food; quantity: string };
function scaledDraft(draft: DraftFood) {
  const amount = Number(draft.quantity);
  if (
    !draft.quantity.trim() ||
    !Number.isFinite(amount) ||
    amount < 0.1 ||
    amount > 10000
  )
    return null;
  const result = foodSchema.safeParse(scaleFood(draft.base, amount));
  return result.success ? result.data : null;
}

export function FoodDialog({
  data,
  date,
  meal,
  mode,
  onClose,
  onSave,
  onRefresh,
}: {
  data: Snapshot;
  date: string;
  meal: string;
  mode: string;
  onClose: () => void;
  onSave: (logs: FoodLog[]) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState(
    ["manual", "saved"].includes(mode) ? mode : "search",
  );
  const [category, setCategory] = useState(meal);
  const [logDate, setLogDate] = useState(date);
  const [query, setQuery] = useState("");
  const [basket, setBasket] = useState<DraftFood[]>([]);
  const [manual, setManual] = useState<Food>({ ...blank });
  const [quantity, setQuantity] = useState("100");
  const [basis, setBasis] = useState<"grams" | "serving">("grams");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [newFoods, setNewFoods] = useState<Food[]>([]);
  const [recipeName, setRecipeName] = useState("");
  const [servings, setServings] = useState("1");
  const [recipeSaved, setRecipeSaved] = useState(false);
  const [browse, setBrowse] = useState(true);
  const reviewRef = useRef<HTMLElement>(null);
  const savingRef = useRef(false);
  const library = uniqueFoods([...newFoods, ...data.foods], data.favourites);
  const recent = uniqueFoods(
    [...data.logs].reverse().sort((a, b) => b.date.localeCompare(a.date)),
  );
  const favourites = library.filter(
    (food) => food.id && data.favourites.includes(food.id),
  );
  const search = query.trim().toLowerCase();
  const results = uniqueFoods([...library, ...recent]).filter((food) =>
    `${food.name} ${food.brand}`.toLowerCase().includes(search),
  );
  const scaled = basket.map(scaledDraft);
  const validBasket = scaled.every((food) => food !== null);
  const foods = scaled.filter((food): food is Food => food !== null);
  const total = totals(foods);
  const portionCount = Number(servings);
  const previousMeals = Array.from(
    data.logs
      .reduce((groups, log) => {
        if (log.date > logDate) return groups;
        const key = `${log.date}|${log.meal}`;
        const group = groups.get(key) || {
          date: log.date,
          meal: log.meal,
          foods: [] as Food[],
        };
        group.foods.push(log);
        groups.set(key, group);
        return groups;
      }, new Map<string, { date: string; meal: string; foods: Food[] }>())
      .values(),
  )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  useEffect(() => {
    if (basket.length && !browse) {
      reviewRef.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
      const inputs = reviewRef.current?.querySelectorAll<HTMLInputElement>(
        "input[data-quantity]",
      );
      inputs?.[inputs.length - 1]?.focus({ preventScroll: true });
    }
  }, [basket.length, browse]);

  async function run(fn: () => Promise<void>) {
    if (savingRef.current) return;
    savingRef.current = true;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your draft is still here; try again.",
      );
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }
  function addFoods(items: Food[]) {
    if (basket.length + items.length > 50) {
      setError(
        "A meal can contain up to 50 foods. Log this meal before adding more.",
      );
      return;
    }
    setError("");
    setBasket((current) => [
      ...current,
      ...items.map((food) => ({
        key: newId(),
        base: { ...food },
        quantity: String(food.serving),
      })),
    ]);
    setRecipeSaved(false);
    setBrowse(false);
  }
  function updateDraft(index: number, change: Partial<DraftFood>) {
    setBasket((current) =>
      current.map((draft, i) =>
        i === index ? { ...draft, ...change } : draft,
      ),
    );
    setRecipeSaved(false);
  }
  async function refreshLibrary() {
    try {
      await onRefresh();
    } catch {
      setNotice(
        "Saved to your account. The latest list could not reload; reopen this dialog to refresh it.",
      );
    }
  }
  async function favourite(food: Food) {
    await run(async () => {
      let own = library.find(
        (candidate) => foodKey(candidate) === foodKey(food),
      );
      if (!own?.id) {
        own = await api<Food>(
          "/foods",
          "POST",
          foodSchema.parse(food),
          data.user.id,
        );
        setNewFoods((current) => [...current, own!]);
      }
      const starredIds = new Set(
        [...newFoods, ...data.foods]
          .filter(
            (candidate) =>
              foodKey(candidate) === foodKey(food) &&
              candidate.id &&
              data.favourites.includes(candidate.id),
          )
          .map((candidate) => candidate.id!),
      );
      const active = starredIds.size === 0;
      // Legacy versions could star multiple identical copies. The single star
      // controls every equivalent copy so removing it stays removed on reload.
      for (const id of active ? [own.id!] : starredIds) {
        await api("/favourites/" + id, "PUT", { active }, data.user.id);
      }
      setNotice(
        active
          ? "Saved to your favourite foods."
          : "Removed from your favourite foods.",
      );
      await refreshLibrary();
    });
  }
  async function addManualFood() {
    await run(async () => {
      if (basket.length >= 50) {
        throw Error(
          "A meal can contain up to 50 foods. Log this meal before adding more.",
        );
      }
      const definition = foodSchema.safeParse(manual);
      if (!definition.success)
        throw Error("Enter a food name and valid nutrition from the label.");
      const draft = scaledDraft({ key: "", base: definition.data, quantity });
      if (!draft)
        throw Error(
          "Enter a quantity from 0.1 to 10,000, with nutrition within the supported range.",
        );
      let saved: Food = definition.data;
      let savedToLibrary = false;
      try {
        saved = await api<Food>(
          "/foods",
          "POST",
          definition.data,
          data.user.id,
        );
        savedToLibrary = true;
        setNewFoods((current) => [...current, saved]);
      } catch {
        setNotice(
          "Your food library could not be saved. The food is still in your review below; log the meal to keep this portion, or try adding it to favourites when you are online.",
        );
      }
      setBasket((current) => [
        ...current,
        { key: newId(), base: saved, quantity },
      ]);
      setRecipeSaved(false);
      setBrowse(false);
      setManual({ ...blank });
      setBasis("grams");
      setQuantity("100");
      if (savedToLibrary) {
        setNotice(
          "Custom food saved for next time. Review your portion, then log your meal.",
        );
        await refreshLibrary();
      }
    });
  }

  return (
    <Modal title="Log a meal" wide onClose={onClose}>
      <div className="form-grid">
        <Field label="Meal">
          <input
            list="meal-categories"
            maxLength={40}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          />
          <datalist id="meal-categories">
            {[
              "Breakfast",
              "Lunch",
              "Dinner",
              "Snacks",
              "Pre-workout",
              "Post-workout",
            ].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label="Date">
          <input
            type="date"
            max={localDate()}
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
            required
          />
        </Field>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="info" role="status">
          {notice}
        </p>
      )}
      {basket.length > 0 && (
        <section
          ref={reviewRef}
          className="review-meal compact-review"
          aria-label="Meal review"
        >
          <div className="card-heading">
            <h3>
              Review your meal{" "}
              <span className="pill">
                {basket.length} {basket.length === 1 ? "FOOD" : "FOODS"}
              </span>
            </h3>
          </div>
          {basket.map((draft, index) => {
            const food = scaled[index];
            return (
              <div className="review-food" key={draft.key}>
                <div className="review-food-title">
                  <strong>{draft.base.name}</strong>
                  <button
                    className="icon-button"
                    aria-label={"Remove " + draft.base.name}
                    disabled={busy}
                    onClick={() => {
                      setBasket((current) =>
                        current.filter((_, i) => i !== index),
                      );
                      setRecipeSaved(false);
                      if (basket.length === 1) setBrowse(true);
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                <div className="portion-row">
                  <Field label={`Quantity (${draft.base.unit})`}>
                    <input
                      data-quantity
                      type="number"
                      inputMode="decimal"
                      min="0.1"
                      max="10000"
                      step="0.1"
                      value={draft.quantity}
                      disabled={busy}
                      aria-invalid={!food}
                      onChange={(e) =>
                        updateDraft(index, { quantity: e.target.value })
                      }
                    />
                  </Field>
                  <p className="food-nutrition" aria-live="polite">
                    {food ? (
                      <>
                        <strong>{Math.round(food.calories)} kcal</strong>
                        <br />P {precision(food.protein)} g · C{" "}
                        {precision(food.carbs)} g · F {precision(food.fat)} g
                      </>
                    ) : (
                      "Enter a valid quantity to calculate nutrition."
                    )}
                  </p>
                </div>
                <small className="muted">
                  From {Math.round(draft.base.calories)} kcal per{" "}
                  {precision(draft.base.serving)} {draft.base.unit}. Nutrition
                  scales with your quantity.
                </small>
                <details className="save-recipe">
                  <summary>Correct name or nutrition</summary>
                  <Field label={`Food ${index + 1} name`}>
                    <input
                      maxLength={150}
                      value={draft.base.name}
                      onChange={(e) =>
                        updateDraft(index, {
                          base: { ...draft.base, name: e.target.value },
                        })
                      }
                    />
                  </Field>
                  <p className="muted">
                    Correct the label values per {precision(draft.base.serving)}{" "}
                    {draft.base.unit}. This changes this meal only.
                  </p>
                  <div className="form-grid">
                    {nutrients.map((key) => (
                      <Field
                        key={key}
                        label={`${key} (${key === "calories" ? "kcal" : "g"})`}
                      >
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={key === "calories" ? 10000 : 1000}
                          step="0.1"
                          value={precision(draft.base[key])}
                          onChange={(e) =>
                            updateDraft(index, {
                              base: {
                                ...draft.base,
                                [key]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </Field>
                    ))}
                  </div>
                </details>
              </div>
            );
          })}
          <div className="meal-total food-save-bar">
            <div aria-live="polite">
              <strong>
                {validBasket ? Math.round(total.calories) : "—"}
                <small> kcal</small>
              </strong>
              <span>
                {validBasket
                  ? `P ${precision(total.protein)} g · C ${precision(total.carbs)} g · F ${precision(total.fat)} g`
                  : "Check every quantity before saving"}
              </span>
            </div>
            <button
              className="button primary"
              disabled={
                busy ||
                !validBasket ||
                !category.trim() ||
                !dateSchema.safeParse(logDate).success ||
                logDate > localDate()
              }
              onClick={() =>
                run(async () => {
                  await onSave(
                    foods.map((food, index) => ({
                      ...food,
                      id: basket[index].key,
                      meal: category.trim(),
                      date: logDate,
                    })),
                  );
                })
              }
            >
              {busy ? "Saving…" : "Log meal"}
              <ArrowRight size={18} />
            </button>
          </div>
          <p className="small-copy muted">
            Calories are shown to the nearest kcal; macros to 0.1 g.
            Calculations keep full precision.
          </p>
          <div className="quick-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setBrowse(!browse)}
            >
              <Plus size={17} />
              {browse ? "Hide food picker" : "Add another food"}
            </button>
          </div>
          <details className="save-recipe">
            <summary>
              <Bookmark size={16} />
              Save this as a recipe or reusable meal
            </summary>
            <div className="form-grid">
              <Field label="Recipe name">
                <input
                  value={recipeName}
                  maxLength={100}
                  onChange={(e) => {
                    setRecipeName(e.target.value);
                    setRecipeSaved(false);
                  }}
                  placeholder="My usual breakfast"
                />
              </Field>
              <Field label="Number of servings">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  max="1000"
                  step="0.1"
                  value={servings}
                  onChange={(e) => {
                    setServings(e.target.value);
                    setRecipeSaved(false);
                  }}
                />
              </Field>
            </div>
            <p className="muted">
              {portionCount > 0 && validBasket
                ? `${Math.round(total.calories / portionCount)} kcal per portion`
                : "Enter a valid number of servings."}
            </p>
            <button
              className="button secondary"
              disabled={
                busy ||
                recipeSaved ||
                !recipeName.trim() ||
                !validBasket ||
                !Number.isFinite(portionCount) ||
                portionCount < 0.1 ||
                portionCount > 1000
              }
              onClick={() =>
                run(async () => {
                  await api(
                    "/saved-meals",
                    "POST",
                    {
                      id: newId(),
                      name: recipeName.trim(),
                      servings: portionCount,
                      ingredients: foods,
                    },
                    data.user.id,
                  );
                  setRecipeSaved(true);
                  setNotice(
                    "Reusable meal saved. Log your meal above to count it towards this day.",
                  );
                  await refreshLibrary();
                })
              }
            >
              {recipeSaved ? "Recipe saved" : "Save recipe"}
            </button>
          </details>
        </section>
      )}
      {(browse || basket.length === 0) && (
        <>
          <div className="tabs food-tabs" aria-label="Choose a food source">
            {[
              { id: "search", label: "Your foods", icon: Search },
              { id: "manual", label: "Manual", icon: PenLine },
              { id: "saved", label: "Saved", icon: Bookmark },
            ].map((item) => (
              <button
                key={item.id}
                disabled={busy}
                aria-pressed={tab === item.id}
                className={tab === item.id ? "selected" : ""}
                onClick={() => {
                  setTab(item.id);
                  setError("");
                }}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            ))}
          </div>
          {tab === "search" && (
            <>
              <div className="search-form">
                <div className="search-input">
                  <Search size={18} />
                  <input
                    aria-label="Search your foods"
                    placeholder="Search your foods or brands…"
                    maxLength={100}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              <p className="small-copy muted">
                Your private foods and logged portions. Create a food from its
                nutrition label to get started.
              </p>
              {search ? (
                <>
                  <h3 className="result-heading">Search results</h3>
                  <FoodResults
                    foods={results}
                    onAdd={(food) => addFoods([food])}
                    onFavourite={favourite}
                    favourites={data.favourites}
                    ownFoods={library}
                    disabled={busy}
                  />
                  {!results.length && (
                    <Empty
                      title="No matching foods"
                      text="Create this food using the nutrition on its label."
                      action={
                        <button
                          className="button secondary"
                          onClick={() => {
                            setManual({ ...blank, name: query });
                            setBasis("grams");
                            setQuantity("100");
                            setTab("manual");
                          }}
                        >
                          Create food
                        </button>
                      }
                    />
                  )}
                </>
              ) : (
                <>
                  {favourites.length > 0 && (
                    <>
                      <h3 className="result-heading">Your favourites</h3>
                      <FoodResults
                        foods={favourites}
                        onAdd={(food) => addFoods([food])}
                        onFavourite={favourite}
                        favourites={data.favourites}
                        ownFoods={library}
                        disabled={busy}
                      />
                    </>
                  )}
                  {recent.length > 0 && (
                    <>
                      <h3 className="result-heading">
                        Recently logged{" "}
                        <small>
                          Starts with your last logged portion. Adjust it before
                          saving.
                        </small>
                      </h3>
                      <FoodResults
                        foods={recent.slice(0, 6)}
                        onAdd={(food) => addFoods([food])}
                        onFavourite={favourite}
                        favourites={data.favourites}
                        ownFoods={library}
                        disabled={busy}
                      />
                    </>
                  )}
                  {library.length > 0 && (
                    <>
                      <h3 className="result-heading">
                        Your food library{" "}
                        <small>
                          Use the star to keep a favourite close by.
                        </small>
                      </h3>
                      <FoodResults
                        foods={library}
                        onAdd={(food) => addFoods([food])}
                        onFavourite={favourite}
                        favourites={data.favourites}
                        ownFoods={library}
                        disabled={busy}
                      />
                    </>
                  )}
                  {!library.length && !recent.length && (
                    <Empty
                      title="Your first meal starts here"
                      text="Add a food from its label. It will be saved privately for a quicker log next time."
                      action={
                        <button
                          className="button primary"
                          onClick={() => setTab("manual")}
                        >
                          <Plus size={17} />
                          Create food
                        </button>
                      }
                    />
                  )}
                </>
              )}
            </>
          )}
          {tab === "manual" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void addManualFood();
              }}
            >
              <div className="form-grid">
                <Field label="Food name">
                  <input
                    value={manual.name}
                    onChange={(e) =>
                      setManual({ ...manual, name: e.target.value })
                    }
                    maxLength={150}
                    placeholder="e.g. Greek yoghurt"
                    required
                  />
                </Field>
                <Field label="Nutrition label">
                  <select
                    value={basis}
                    onChange={(e) => {
                      const next = e.target.value as "grams" | "serving";
                      setBasis(next);
                      setManual({
                        ...manual,
                        serving: next === "grams" ? 100 : 1,
                        unit: next === "grams" ? "g" : "serving",
                      });
                      setQuantity(next === "grams" ? "100" : "1");
                    }}
                  >
                    <option value="grams">Per 100 g</option>
                    <option value="serving">Per serving</option>
                  </select>
                </Field>
              </div>
              <p className="small-copy muted">
                Enter label values for{" "}
                {basis === "grams" ? "100 g" : "one serving"}.{" "}
                {basis === "grams"
                  ? "For example, 150 g uses 1.5 × these values."
                  : "For example, 2 servings uses 2 × these values."}
              </p>
              <div className="form-grid">
                {nutrients.map((key) => (
                  <Field
                    key={key}
                    label={`${key} (${key === "calories" ? "kcal" : "g"})`}
                  >
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max={key === "calories" ? 10000 : 1000}
                      step="0.1"
                      value={manual[key]}
                      onChange={(e) =>
                        setManual({ ...manual, [key]: Number(e.target.value) })
                      }
                      required
                    />
                  </Field>
                ))}
              </div>
              <Field
                label={
                  basis === "grams" ? "Quantity (g)" : "Quantity (serving)"
                }
                hint={
                  basis === "grams"
                    ? "The amount you ate, in grams."
                    : "The number of label servings you ate; decimals are welcome."
                }
              >
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  max="10000"
                  step="0.1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </Field>
              <button
                className="button primary full"
                disabled={busy}
                type="submit"
              >
                <Plus size={17} />
                {busy ? "Adding…" : "Add to meal"}
              </button>
              <details className="save-recipe">
                <summary>Optional label details</summary>
                <div className="form-grid">
                  <Field label="Brand (optional)">
                    <input
                      value={manual.brand}
                      maxLength={100}
                      onChange={(e) =>
                        setManual({ ...manual, brand: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="fibre (g)">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="1000"
                      step="0.1"
                      value={manual.fibre}
                      onChange={(e) =>
                        setManual({ ...manual, fibre: Number(e.target.value) })
                      }
                    />
                  </Field>
                </div>
              </details>
            </form>
          )}
          {tab === "saved" && (
            <>
              <h3 className="result-heading">Saved meals & recipes</h3>
              <p className="small-copy muted">
                Add a portion, check the quantities, then log it for {logDate}.
              </p>
              {data.savedMeals.map((savedMeal) => (
                <div className="food-result" key={savedMeal.id}>
                  <div>
                    <strong>{savedMeal.name}</strong>
                    <small>
                      {savedMeal.ingredients.length} ingredients ·{" "}
                      {Math.round(
                        totals(savedMeal.ingredients).calories /
                          savedMeal.servings,
                      )}{" "}
                      kcal per portion
                    </small>
                  </div>
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() =>
                      addFoods(
                        savedMeal.ingredients.map((food) =>
                          scaleFood(food, food.serving / savedMeal.servings),
                        ),
                      )
                    }
                  >
                    <Plus size={16} />
                    Add portion
                  </button>
                </div>
              ))}
              {!data.savedMeals.length && (
                <p className="muted">
                  Add foods to a meal, then choose “Save this as a recipe or
                  reusable meal”.
                </p>
              )}
              <h3 className="result-heading">Repeat a previous meal</h3>
              {previousMeals.map((previous) => (
                <div
                  className="food-result"
                  key={previous.date + previous.meal}
                >
                  <div>
                    <strong>
                      {previous.meal} · {previous.date}
                    </strong>
                    <small>
                      {previous.foods.map((food) => food.name).join(", ")}
                    </small>
                    <small>
                      {Math.round(totals(previous.foods).calories)} kcal ·{" "}
                      {previous.foods.length}{" "}
                      {previous.foods.length === 1 ? "food" : "foods"}
                    </small>
                  </div>
                  <button
                    className="button secondary small"
                    disabled={busy}
                    aria-label={`Repeat ${previous.meal} from ${previous.date}`}
                    onClick={() => addFoods(previous.foods)}
                  >
                    <RotateCcw size={16} />
                    Repeat meal
                  </button>
                </div>
              ))}
              {!previousMeals.length && (
                <p className="muted">
                  Your logged meals will appear here for a quick repeat.
                </p>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function FoodResults({
  foods,
  onAdd,
  onFavourite,
  favourites,
  ownFoods,
  disabled,
}: {
  foods: Food[];
  onAdd: (food: Food) => void;
  onFavourite: (food: Food) => void;
  favourites: string[];
  ownFoods: Food[];
  disabled: boolean;
}) {
  return (
    <div className="food-results">
      {foods.map((food, index) => {
        const own = ownFoods.find(
          (candidate) => foodKey(candidate) === foodKey(food),
        );
        const active = !!own?.id && favourites.includes(own.id);
        return (
          <div className="food-result" key={(food.id || food.name) + index}>
            <div>
              <strong>{food.name}</strong>
              <small>
                {food.brand ? food.brand + " · " : ""}
                {precision(food.serving)} {food.unit} · P{" "}
                {precision(food.protein)} g · C {precision(food.carbs)} g · F{" "}
                {precision(food.fat)} g
              </small>
            </div>
            <span>
              {Math.round(food.calories)}
              <small> kcal</small>
            </span>
            <button
              className="icon-button"
              aria-label={(active ? "Unfavourite " : "Favourite ") + food.name}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onFavourite(food)}
            >
              <Star size={17} fill={active ? "currentColor" : "none"} />
            </button>
            <button
              className="icon-button add-circle"
              aria-label={"Add " + food.name}
              disabled={disabled}
              onClick={() => onAdd(food)}
            >
              <Plus size={18} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
