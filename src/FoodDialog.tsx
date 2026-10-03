import { useState, useEffect, useRef } from "react";
import {
  Search,
  Plus,
  Camera,
  ScanLine,
  PenLine,
  Bookmark,
  Trash2,
  Check,
  Star,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Modal, Field, Empty } from "./components";
import { api, ApiError } from "./api";
import { newId } from "./id";
import {
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
type Scan = {
  id: string;
  questions: string[];
  foods: {
    name: string;
    grams: number;
    confidence: string;
    candidates: Food[];
    lookupError: string | null;
  }[];
};
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
  const [tab, setTab] = useState(mode),
    [category, setCategory] = useState(meal),
    [logDate, setLogDate] = useState(date),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<Food[]>([]),
    [searched, setSearched] = useState(false),
    [basket, setBasket] = useState<Food[]>([]),
    [manual, setManual] = useState<Food>({ ...blank }),
    [error, setError] = useState(""),
    [errorCode, setErrorCode] = useState(""),
    [busy, setBusy] = useState(false),
    [warning, setWarning] = useState(""),
    [barcode, setBarcode] = useState(""),
    [camera, setCamera] = useState(false),
    [photo, setPhoto] = useState(""),
    [notes, setNotes] = useState(""),
    [scan, setScan] = useState<Scan | null>(null),
    [chosen, setChosen] = useState<number[]>([]),
    [recipeName, setRecipeName] = useState(""),
    [servings, setServings] = useState(1),
    [recipeSaved, setRecipeSaved] = useState(false);
  const recent = Array.from(
      new Map(
        data.logs
          .slice()
          .reverse()
          .map((f) => [f.name, f]),
      ).values(),
    ).slice(0, 8),
    fav = data.foods.filter((f) => f.id && data.favourites.includes(f.id));
  async function run(fn: () => Promise<void>) {
    setError("");
    setErrorCode("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      setErrorCode(e instanceof ApiError ? e.code || "" : "");
    } finally {
      setBusy(false);
    }
  }
  function add(f: Food) {
    setBasket((b) => [...b, { ...f }]);
    setRecipeSaved(false);
  }
  async function lookup(code = barcode) {
    await run(async () => {
      const f = await api<Food>("/foods/barcode/" + encodeURIComponent(code));
      setResults([f]);
      setSearched(true);
      setCamera(false);
    });
  }
  async function favourite(f: Food) {
    await run(async () => {
      const own = await api<Food>("/foods", "POST", f);
      await api("/favourites/" + own.id, "PUT", { active: true });
      await onRefresh();
      setWarning("Saved to your favourite foods.");
    });
  }
  const total = totals(basket);
  return (
    <Modal title="A little fuel for your day" wide onClose={onClose}>
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
            ].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="Date">
          <input
            type="date"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
            required
          />
        </Field>
      </div>
      <div className="tabs food-tabs">
        {[
          { id: "search", label: "Search", icon: Search },
          { id: "manual", label: "Manual", icon: PenLine },
          { id: "barcode", label: "Barcode", icon: ScanLine },
          { id: "ai", label: "Scan meal", icon: Camera },
          { id: "saved", label: "Saved", icon: Bookmark },
        ].map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "selected" : ""}
            onClick={() => {
              setTab(t.id);
              setError("");
              setResults([]);
              setSearched(false);
            }}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === "search" && (
        <>
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const r = await api<{ foods: Food[]; warning: string | null }>(
                  "/foods/search?q=" + encodeURIComponent(query),
                );
                setResults(r.foods);
                setWarning(r.warning || "");
                setSearched(true);
              });
            }}
          >
            <div className="search-input">
              <Search size={18} />
              <input
                aria-label="Search foods"
                placeholder="Search foods or brands…"
                minLength={2}
                maxLength={100}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                required
              />
            </div>
            <button className="button primary" disabled={busy}>
              Search
            </button>
          </form>
          {searched ? (
            <>
              <h3 className="result-heading">
                Search results{" "}
                <small>
                  Nutrition per listed serving · Verify against the label
                </small>
              </h3>
              <FoodResults
                foods={results}
                onAdd={add}
                onFavourite={favourite}
              />
              {!results.length && (
                <Empty
                  title="No matching foods"
                  text="Try a different name, or add the nutrition from your food label."
                  action={
                    <button
                      className="button secondary"
                      onClick={() => setTab("manual")}
                    >
                      Create food
                    </button>
                  }
                />
              )}
            </>
          ) : (
            <>
              <h3 className="result-heading">Recently logged</h3>
              <FoodResults foods={recent} onAdd={add} />
              {!recent.length && (
                <p className="muted">
                  Your recently logged foods will appear here for quick access.
                </p>
              )}
              <h3 className="result-heading">Your favourites</h3>
              <FoodResults foods={fav} onAdd={add} />
              {!fav.length && (
                <p className="muted">
                  Save foods from search with the star button.
                </p>
              )}
            </>
          )}
        </>
      )}
      {tab === "manual" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              add(foodSchema.parse(manual));
              setManual({ ...blank });
              setWarning("Added to your review below.");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <div className="form-grid">
            <Field label="Food name">
              <input
                value={manual.name}
                onChange={(e) => setManual({ ...manual, name: e.target.value })}
                maxLength={150}
                placeholder="e.g. Greek yoghurt"
                required
              />
            </Field>
            <Field label="Brand (optional)">
              <input
                value={manual.brand}
                onChange={(e) =>
                  setManual({ ...manual, brand: e.target.value })
                }
                maxLength={100}
              />
            </Field>
            <Field label="Serving amount">
              <input
                type="number"
                min="0.1"
                max="10000"
                step="0.1"
                value={manual.serving}
                onChange={(e) =>
                  setManual({ ...manual, serving: Number(e.target.value) })
                }
                required
              />
            </Field>
            <Field label="Serving unit">
              <select
                value={manual.unit}
                onChange={(e) => setManual({ ...manual, unit: e.target.value })}
              >
                <option>g</option>
                <option>ml</option>
                <option>portion</option>
                <option>piece</option>
              </select>
            </Field>
          </div>
          <p className="muted">
            Enter nutrition for the serving amount above, using the product
            label or a trusted database.
          </p>
          <div className="form-grid three">
            {(["calories", "protein", "carbs", "fat", "fibre"] as const).map(
              (k) => (
                <Field
                  key={k}
                  label={k + " (" + (k === "calories" ? "kcal" : "g") + ")"}
                >
                  <input
                    type="number"
                    min="0"
                    max={k === "calories" ? 10000 : 1000}
                    step="0.1"
                    value={manual[k]}
                    onChange={(e) =>
                      setManual({ ...manual, [k]: Number(e.target.value) })
                    }
                    required
                  />
                </Field>
              ),
            )}
          </div>
          <div className="quick-actions">
            <button type="submit" className="button primary">
              <Plus size={17} />
              Add to meal
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const f = foodSchema.parse(manual);
                  await api("/foods", "POST", f);
                  await onRefresh();
                  setWarning("Custom food saved privately.");
                })
              }
            >
              <Bookmark size={16} />
              Save custom food
            </button>
          </div>
        </form>
      )}
      {tab === "barcode" && (
        <>
          <p className="muted">
            Scan a packaged food or enter its barcode. Results come from Open
            Food Facts. Check the label before logging.
          </p>
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault();
              lookup();
            }}
          >
            <input
              aria-label="Barcode number"
              placeholder="Enter 8–14 digit barcode"
              inputMode="numeric"
              pattern="[0-9]{8,14}"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              required
            />
            <button className="button primary" disabled={busy}>
              Look up
            </button>
          </form>
          <button
            className="button secondary full"
            onClick={() => setCamera(!camera)}
          >
            <ScanLine size={18} />
            {camera ? "Close camera" : "Open barcode camera"}
          </button>
          {camera && (
            <BarcodeCamera
              onCode={(code) => {
                setBarcode(code);
                lookup(code);
              }}
            />
          )}
          <FoodResults foods={results} onAdd={add} />
        </>
      )}
      {tab === "ai" && (
        <>
          <div className="scan-intro">
            <span className="activity-icon green">
              <Camera size={24} />
            </span>
            <h3>A photo is a starting point.</h3>
            <p>
              We identify foods and approximate portions, then look up
              nutrition. You review every match. Hidden oils and portion sizes
              can change the result.
            </p>
          </div>
          <Field label="Meal photo · JPEG, PNG or WebP, up to 5 MB">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 5 * 1024 * 1024) {
                  setError("Choose a photo under 5 MB.");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  setPhoto(String(reader.result));
                  setScan(null);
                  setChosen([]);
                };
                reader.readAsDataURL(f);
              }}
            />
          </Field>
          {photo && (
            <img className="meal-preview" src={photo} alt="Meal to analyse" />
          )}
          <Field
            label="Anything useful to know?"
            hint="Mention cooking method, oil, sauces or rough portion size."
          >
            <textarea
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Grilled chicken, cooked rice, about a teaspoon of oil…"
            />
          </Field>
          <p className="small-copy muted">
            Choosing Analyse sends this photo and your notes to OpenAI. The app
            stores the estimate and corrections, not the photo.
          </p>
          <button
            className="button primary"
            disabled={busy || !photo}
            onClick={() =>
              run(async () => {
                const result = await api<Scan>("/ai/meal", "POST", {
                  image: photo,
                  notes,
                });
                setScan(result);
                setChosen([]);
              })
            }
          >
            <Sparkles size={17} />
            {busy ? "Identifying your meal…" : "Analyse meal"}
          </button>
          {scan && (
            <div className="scan-results">
              {scan.questions.length > 0 && (
                <div className="info">
                  <div>
                    <strong>A few things to check</strong>
                    {scan.questions.map((q) => (
                      <p key={q}>{q}</p>
                    ))}
                    <small>
                      Add answers above and analyse again if needed.
                    </small>
                  </div>
                </div>
              )}
              {!scan.foods.length && (
                <p className="muted">
                  No meal was recognised. Try a clearer photo or use manual
                  entry.
                </p>
              )}
              {scan.foods.map((f, i) => (
                <div className="scan-food" key={i}>
                  <div className="card-heading">
                    <h3>
                      {f.name} · ~{f.grams} g
                    </h3>
                    <span className="pill">
                      {f.confidence} recognition confidence
                    </span>
                  </div>
                  <p className="muted">
                    Choose a matching database food. These are search
                    candidates, not confirmed matches.
                  </p>
                  {f.lookupError && <p className="error">{f.lookupError}</p>}
                  {chosen.includes(i) ? (
                    <p className="lime">
                      <Check size={16} />
                      Added for your review below.
                    </p>
                  ) : (
                    <FoodResults
                      foods={f.candidates}
                      onAdd={(food) => {
                        add(food);
                        setChosen([...chosen, i]);
                      }}
                    />
                  )}
                  {!f.candidates.length && (
                    <button
                      className="button secondary"
                      onClick={() => {
                        setManual({ ...blank, name: f.name, serving: f.grams });
                        setTab("manual");
                      }}
                    >
                      Enter verified nutrition manually
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {tab === "saved" && (
        <>
          <h3>Saved meals & recipes</h3>
          <p className="muted">
            Add one portion of a saved recipe to your review. To make a recipe,
            add ingredients to the review below, give it a name and set the
            number of portions.
          </p>
          {data.savedMeals.length ? (
            data.savedMeals.map((m) => {
              const t = totals(m.ingredients);
              return (
                <div className="food-result" key={m.id}>
                  <div>
                    <strong>{m.name}</strong>
                    <small>
                      {m.ingredients.length} ingredients · {m.servings} servings
                      · {Math.round(t.calories / m.servings)} kcal / portion
                    </small>
                  </div>
                  <button
                    className="button secondary small"
                    onClick={() =>
                      m.ingredients.forEach((f) =>
                        add(scaleFood(f, f.serving / m.servings)),
                      )
                    }
                  >
                    <Plus size={16} />
                    Add portion
                  </button>
                </div>
              );
            })
          ) : (
            <Empty
              title="Good meals deserve an encore"
              text="Build a recipe from your ingredients below, then save it for next time."
            />
          )}
        </>
      )}
      {warning && (
        <p className="info" role="status">
          {warning}
        </p>
      )}
      {error && (
        <div className="scan-error">
          <p className="error" role="alert">
            {error}
          </p>
          {tab === "ai" && errorCode === "AI_CREDITS_EXHAUSTED" && (
            <>
              <p className="muted">Your photo was not logged.</p>
              <div className="quick-actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    setError("");
                    setTab("search");
                  }}
                >
                  <Search size={17} />
                  Search foods
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    setError("");
                    setTab("manual");
                  }}
                >
                  <PenLine size={17} />
                  Enter food manually
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {basket.length > 0 && (
        <section className="review-meal">
          <div className="card-heading">
            <h3>
              Review your meal{" "}
              <span className="pill">{basket.length} FOODS</span>
            </h3>
            <span className="muted">Everything is editable</span>
          </div>
          {basket.map((f, i) => (
            <div className="review-food" key={i}>
              <div className="review-food-title">
                <input
                  aria-label={`Food ${i + 1} name`}
                  maxLength={150}
                  value={f.name}
                  onChange={(e) =>
                    setBasket((b) =>
                      b.map((v, j) =>
                        j === i ? { ...v, name: e.target.value } : v,
                      ),
                    )
                  }
                />
                <button
                  className="icon-button"
                  aria-label={"Remove " + f.name}
                  onClick={() => setBasket((b) => b.filter((_, j) => i !== j))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <small className="muted">
                {f.source} · {f.brand || "No brand"}
              </small>
              <div className="form-grid three">
                <Field label="Amount">
                  <input
                    type="number"
                    min="0.1"
                    max="10000"
                    step="0.1"
                    value={Math.round(f.serving * 100) / 100}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (n > 0)
                        setBasket((b) =>
                          b.map((v, j) => (j === i ? scaleFood(v, n) : v)),
                        );
                    }}
                  />
                </Field>
                <Field label="Unit">
                  <input
                    maxLength={20}
                    value={f.unit}
                    onChange={(e) =>
                      setBasket((b) =>
                        b.map((v, j) =>
                          j === i ? { ...v, unit: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </Field>
                {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
                  <Field
                    label={k + (k === "calories" ? " (kcal)" : " (g)")}
                    key={k}
                  >
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      max={k === "calories" ? 10000 : 1000}
                      value={Math.round(f[k] * 10) / 10}
                      onChange={(e) =>
                        setBasket((b) =>
                          b.map((v, j) =>
                            j === i ? { ...v, [k]: Number(e.target.value) } : v,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
              </div>
            </div>
          ))}
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
                  onChange={(e) => setRecipeName(e.target.value)}
                  placeholder="My usual breakfast"
                />
              </Field>
              <Field label="Number of servings">
                <input
                  type="number"
                  min="0.1"
                  max="1000"
                  step="0.1"
                  value={servings}
                  onChange={(e) => setServings(Number(e.target.value))}
                />
              </Field>
            </div>
            <p className="muted">
              {Math.round(total.calories / servings)} kcal · P{" "}
              {Math.round(total.protein / servings)} / C{" "}
              {Math.round(total.carbs / servings)} / F{" "}
              {Math.round(total.fat / servings)} g per portion
            </p>
            <button
              className="button secondary"
              disabled={
                busy || recipeSaved || !recipeName.trim() || servings <= 0
              }
              onClick={() =>
                run(async () => {
                  await api("/saved-meals", "POST", {
                    id: newId(),
                    name: recipeName,
                    servings,
                    ingredients: basket,
                  });
                  await onRefresh();
                  setRecipeSaved(true);
                })
              }
            >
              {recipeSaved ? "Recipe saved" : "Save recipe"}
            </button>
          </details>
          <div className="meal-total">
            <div>
              <strong>
                {Math.round(total.calories)}
                <small> kcal</small>
              </strong>
              <span>
                P {Math.round(total.protein)} · C {Math.round(total.carbs)} · F{" "}
                {Math.round(total.fat)} g
              </span>
            </div>
            <button
              className="button primary"
              disabled={busy || !category.trim() || !logDate}
              onClick={() =>
                run(async () => {
                  const foods = basket.map((f) => foodSchema.parse(f));
                  await onSave(
                    foods.map((f) => ({
                      ...f,
                      id: newId(),
                      meal: category,
                      date: logDate,
                      ...(scan ? { analysisId: scan.id } : {}),
                    })),
                  );
                })
              }
            >
              {busy ? "Saving…" : "Log meal"}
              <ArrowRight size={18} />
            </button>
          </div>
        </section>
      )}
    </Modal>
  );
}
function FoodResults({
  foods,
  onAdd,
  onFavourite,
}: {
  foods: Food[];
  onAdd: (f: Food) => void;
  onFavourite?: (f: Food) => void;
}) {
  return (
    <div className="food-results">
      {foods.map((f, i) => (
        <div className="food-result" key={(f.id || f.name) + i}>
          <div>
            <strong>{f.name}</strong>
            <small>
              {f.brand ? f.brand + " · " : ""}
              {Math.round(f.serving)} {f.unit} · P {Math.round(f.protein)} C{" "}
              {Math.round(f.carbs)} F {Math.round(f.fat)}
            </small>
            <small>{f.source}</small>
          </div>
          <span>
            {Math.round(f.calories)}
            <small> kcal</small>
          </span>
          {onFavourite && (
            <button
              className="icon-button"
              aria-label={"Favourite " + f.name}
              onClick={() => onFavourite(f)}
            >
              <Star size={16} />
            </button>
          )}
          <button
            className="icon-button add-circle"
            aria-label={"Add " + f.name}
            onClick={() => onAdd(f)}
          >
            <Plus size={17} />
          </button>
        </div>
      ))}
    </div>
  );
}
function BarcodeCamera({ onCode }: { onCode: (code: string) => void }) {
  const ref = useRef<HTMLVideoElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let stream: MediaStream | undefined,
      timer: ReturnType<typeof setInterval> | undefined,
      cancelled = false,
      detecting = false;
    const run = async () => {
      try {
        type Detector = {
          detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
        };
        const Constructor = (
          window as unknown as {
            BarcodeDetector?: new (o: { formats: string[] }) => Detector;
          }
        ).BarcodeDetector;
        if (!Constructor) {
          setError(
            "Camera barcode detection isn’t supported in this browser. Enter the barcode number above.",
          );
          return;
        }
        const detector = new Constructor({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e"],
        });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (ref.current) {
          ref.current.srcObject = stream;
          await ref.current.play();
        }
        timer = setInterval(async () => {
          if (cancelled || detecting || !ref.current) return;
          detecting = true;
          try {
            const results = await detector.detect(ref.current);
            if (results[0]) {
              cancelled = true;
              onCode(results[0].rawValue);
            }
          } catch {
          } finally {
            detecting = false;
          }
        }, 500);
      } catch {
        setError(
          "Camera access unavailable. You can enter the barcode number above.",
        );
      }
    };
    run();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div>
      {error ? (
        <p className="info">{error}</p>
      ) : (
        <video
          className="barcode-video"
          ref={ref}
          muted
          playsInline
          aria-label="Barcode camera preview"
        />
      )}
    </div>
  );
}
