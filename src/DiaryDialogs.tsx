import { useState } from "react";
import { Field, Modal } from "./components";
import {
  localDate,
  logSchema,
  macrosSchema,
  scaleFood,
  type FoodLog,
  type Macros,
} from "../shared/domain";

export function EditFoodDialog({
  entry,
  meals,
  onClose,
  onSave,
}: {
  entry: FoodLog;
  meals: string[];
  onClose: () => void;
  onSave: (entry: FoodLog) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(entry.serving));
  const [nutrition, setNutrition] = useState<Macros>({
    calories: entry.calories,
    protein: entry.protein,
    carbs: entry.carbs,
    fat: entry.fat,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const validAmount = Number(amount) >= 0.1 && Number(amount) <= 10000;
  const base = { ...entry, ...nutrition };
  const scaled = validAmount ? scaleFood(base, Number(amount)) : base;
  return (
    <Modal title="Edit food" onClose={onClose}>
      <p className="muted">
        Correct the portion, meal or day. Your saved food definition stays the
        same.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = new FormData(e.currentTarget);
          try {
            await onSave(
              logSchema.parse({
                ...entry,
                ...scaled,
                name: form.get("name"),
                meal: form.get("meal"),
                date: form.get("date"),
              }),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Food name">
          <input
            name="name"
            defaultValue={entry.name}
            maxLength={150}
            required
          />
        </Field>
        <div className="form-grid">
          <Field label={`Quantity (${entry.unit})`}>
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              max="10000"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Meal">
            <input
              name="meal"
              list="edit-meal-options"
              defaultValue={entry.meal}
              maxLength={40}
              required
            />
            <datalist id="edit-meal-options">
              {meals.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label="Date">
          <input
            type="date"
            name="date"
            defaultValue={entry.date}
            max={localDate()}
            required
          />
        </Field>
        <details className="save-recipe">
          <summary>Correct nutrition</summary>
          <p className="muted">
            Values for the original {entry.serving} {entry.unit} portion. Your
            new quantity scales these values.
          </p>
          <div className="form-grid">
            {(["calories", "protein", "carbs", "fat"] as const).map((key) => (
              <Field
                key={key}
                label={`${key} (${key === "calories" ? "kcal" : "g"})`}
              >
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={
                    { calories: 10000, protein: 1500, carbs: 2000, fat: 1000 }[
                      key
                    ]
                  }
                  step="any"
                  value={nutrition[key]}
                  onChange={(e) =>
                    setNutrition({
                      ...nutrition,
                      [key]: Number(e.target.value),
                    })
                  }
                  required
                />
              </Field>
            ))}
          </div>
        </details>
        <p className="portion-preview" aria-live="polite">
          {Math.round(scaled.calories)} kcal · Protein{" "}
          {scaled.protein.toFixed(1)} g · Carbs {scaled.carbs.toFixed(1)} g ·
          Fat {scaled.fat.toFixed(1)} g
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy || !validAmount}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
    </Modal>
  );
}

export function TargetsDialog({
  targets,
  onClose,
  onSave,
}: {
  targets: Macros;
  onClose: () => void;
  onSave: (targets: Macros) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Daily targets" onClose={onClose}>
      <p className="muted">
        Your plan, your pace. These targets apply to every day’s comparison.
        Saved foods and portions never change.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await onSave(
              macrosSchema.parse(
                Object.fromEntries(
                  ["calories", "protein", "carbs", "fat"].map((key) => [
                    key,
                    Number(form.get(key)),
                  ]),
                ),
              ),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {(
            [
              ["calories", "Calories (kcal)", 10000],
              ["protein", "Protein (g)", 1500],
              ["carbs", "Carbohydrates (g)", 2000],
              ["fat", "Fat (g)", 1000],
            ] as const
          ).map(([key, label, max]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                inputMode="decimal"
                name={key}
                defaultValue={Math.round(targets[key] * 10) / 10}
                min={key === "calories" ? 1 : 0}
                max={max}
                step={key === "calories" ? "1" : "0.1"}
                required
              />
            </Field>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? "Saving…" : "Save targets"}
        </button>
      </form>
    </Modal>
  );
}
