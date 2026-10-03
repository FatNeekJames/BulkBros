import { useState, type FormEvent } from "react";
import { ArrowRight, Info } from "lucide-react";
import { Field } from "./components";
import {
  calculateTargets,
  macroCalories,
  profileSchema,
  type Profile,
  type Macros,
} from "../shared/domain";
export function ProfileForm({
  initial,
  onSave,
}: {
  initial?: Profile;
  onSave: (p: Profile) => Promise<void>;
}) {
  const [units, setUnits] = useState(initial?.units || "metric"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [manual, setManual] = useState(!!initial?.targets),
    [mode, setMode] = useState("grams"),
    [preview, setPreview] = useState<ReturnType<
      typeof calculateTargets
    > | null>(initial ? calculateTargets(initial) : null),
    [macro, setMacro] = useState<Macros>(
      initial?.targets || {
        calories: 2400,
        protein: 150,
        carbs: 285,
        fat: 73.3333333333,
      },
    ),
    [percent, setPercent] = useState({ protein: 25, carbs: 45, fat: 30 });
  function read(form: HTMLFormElement): Profile {
    const f = new FormData(form),
      n = (name: string) => Number(f.get(name));
    return {
      name: String(f.get("name")),
      username: String(f.get("username")),
      age: n("age"),
      sex: String(f.get("sex")) as Profile["sex"],
      height: n("height") * (units === "imperial" ? 2.54 : 1),
      weight: n("weight") / (units === "imperial" ? 2.20462 : 1),
      targetWeight: n("targetWeight") / (units === "imperial" ? 2.20462 : 1),
      units,
      activity: String(f.get("activity")) as Profile["activity"],
      workoutsPerWeek: n("workoutsPerWeek"),
      goal: String(f.get("goal")) as Profile["goal"],
      speed: String(f.get("speed")) as Profile["speed"],
      stepGoal: n("stepGoal"),
      exerciseCalories: f.get("exerciseCalories") === "on",
    };
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const p = read(e.currentTarget);
      if (manual) {
        if (mode === "percent") {
          if (
            Math.abs(percent.protein + percent.carbs + percent.fat - 100) > 0.01
          )
            throw Error("Macro percentages must total 100%.");
          p.targets = {
            calories: macro.calories,
            protein: (macro.calories * percent.protein) / 400,
            carbs: (macro.calories * percent.carbs) / 400,
            fat: (macro.calories * percent.fat) / 900,
          };
        } else p.targets = { ...macro };
      }
      await onSave(profileSchema.parse(p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check your profile details");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      onChange={(e) => {
        const form = e.currentTarget;
        try {
          const p = read(form);
          if (p.age >= 18 && p.height >= 100 && p.weight >= 30)
            setPreview(calculateTargets(p));
        } catch {}
      }}
    >
      <h3 className="form-section">
        01 <span>The basics</span>
      </h3>
      <div className="form-grid">
        <Field label="First name">
          <input
            name="name"
            defaultValue={initial?.name}
            maxLength={60}
            placeholder="Your name"
            required
          />
        </Field>
        <Field label="Username">
          <input
            name="username"
            defaultValue={initial?.username}
            pattern="[a-zA-Z0-9_]{3,30}"
            placeholder="your_username"
            required
            minLength={3}
            maxLength={30}
          />
        </Field>
        <Field
          label="Age"
          hint="This release supports adults aged 18+. No weight-loss targets are generated for minors."
        >
          <input
            name="age"
            type="number"
            min={18}
            max={100}
            defaultValue={initial?.age}
            placeholder="Years"
            required
          />
        </Field>
        <Field
          label="Sex used for metabolic equation"
          hint="Used only to estimate resting energy needs."
        >
          <select name="sex" defaultValue={initial?.sex || "male"}>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </Field>
      </div>
      <h3 className="form-section">
        02 <span>Your starting point</span>
      </h3>
      <div className="tabs">
        <button
          type="button"
          className={units === "metric" ? "selected" : ""}
          onClick={() => setUnits("metric")}
        >
          Metric · kg / cm
        </button>
        <button
          type="button"
          className={units === "imperial" ? "selected" : ""}
          onClick={() => setUnits("imperial")}
        >
          Imperial · lb / inches
        </button>
      </div>
      <div className="form-grid three" key={units}>
        <Field label={"Height (" + (units === "metric" ? "cm" : "in") + ")"}>
          <input
            name="height"
            type="number"
            step="0.1"
            min={units === "metric" ? 100 : 39.4}
            max={units === "metric" ? 250 : 98.4}
            defaultValue={
              initial
                ? (initial.height / (units === "imperial" ? 2.54 : 1)).toFixed(
                    1,
                  )
                : undefined
            }
            required
          />
        </Field>
        <Field
          label={"Current weight (" + (units === "metric" ? "kg" : "lb") + ")"}
        >
          <input
            name="weight"
            type="number"
            step="0.1"
            min={units === "metric" ? 30 : 66.2}
            max={units === "metric" ? 350 : 771}
            defaultValue={
              initial
                ? (
                    initial.weight * (units === "imperial" ? 2.20462 : 1)
                  ).toFixed(1)
                : undefined
            }
            required
          />
        </Field>
        <Field
          label={"Goal weight (" + (units === "metric" ? "kg" : "lb") + ")"}
        >
          <input
            name="targetWeight"
            type="number"
            step="0.1"
            min={units === "metric" ? 30 : 66.2}
            max={units === "metric" ? 350 : 771}
            defaultValue={
              initial
                ? (
                    initial.targetWeight * (units === "imperial" ? 2.20462 : 1)
                  ).toFixed(1)
                : undefined
            }
            required
          />
        </Field>
      </div>
      <div className="form-grid">
        <Field
          label="Daily activity"
          hint="Include your usual exercise when choosing an activity level."
        >
          <select
            name="activity"
            defaultValue={initial?.activity || "moderate"}
          >
            <option value="sedentary">Sedentary · mainly seated</option>
            <option value="light">Lightly active · some walking</option>
            <option value="moderate">
              Moderately active · regular training
            </option>
            <option value="very">
              Very active · active job or frequent training
            </option>
            <option value="extreme">
              Extremely active · heavy daily activity
            </option>
          </select>
        </Field>
        <Field label="Workouts per week">
          <input
            name="workoutsPerWeek"
            type="number"
            min="0"
            max="14"
            defaultValue={initial?.workoutsPerWeek ?? 3}
            required
          />
        </Field>
        <Field label="Your goal">
          <select name="goal" defaultValue={initial?.goal || "maintain"}>
            <option value="gain">Gain weight / build muscle</option>
            <option value="maintain">Maintain weight</option>
            <option value="lose">Lose weight</option>
          </select>
        </Field>
        <Field
          label="Pace"
          hint="Aggressive changes are harder to sustain. Consider professional guidance before major dietary changes."
        >
          <select name="speed" defaultValue={initial?.speed || "slow"}>
            <option value="slow">Slow / lean gain</option>
            <option value="moderate">Moderate</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </Field>
        <Field label="Daily step goal">
          <input
            name="stepGoal"
            type="number"
            min="100"
            max="100000"
            defaultValue={initial?.stepGoal ?? 8000}
            required
          />
        </Field>
      </div>
      <h3 className="form-section">
        03 <span>Your daily fuel</span>
      </h3>
      {preview && (
        <div className="target-preview">
          <div>
            <small>Estimated BMR</small>
            <strong>
              {preview.bmr}
              <span> kcal</span>
            </strong>
          </div>
          <div>
            <small>Estimated maintenance</small>
            <strong>
              {preview.tdee}
              <span> kcal</span>
            </strong>
          </div>
          <div>
            <small>Suggested target · estimate</small>
            <strong className="lime">
              {preview.recommended}
              <span> kcal</span>
            </strong>
          </div>
        </div>
      )}
      <p className="info">
        <Info size={17} />
        These are starting estimates, not exact measurements. Review your weight
        trend over several weeks and adjust gradually. Targets are never changed
        automatically.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={manual}
          onChange={(e) => {
            setManual(e.target.checked);
            if (e.target.checked && !initial?.targets && preview)
              setMacro(preview.targets);
          }}
        />
        Set my own macro targets
      </label>
      {manual && (
        <>
          <div className="tabs">
            <button
              type="button"
              className={mode === "grams" ? "selected" : ""}
              onClick={() => setMode("grams")}
            >
              Grams
            </button>
            <button
              type="button"
              className={mode === "percent" ? "selected" : ""}
              onClick={() => setMode("percent")}
            >
              Percent of calories
            </button>
          </div>
          {
            <Field label="Calorie target">
              <input
                type="number"
                min={1}
                max={10000}
                value={macro.calories}
                onChange={(e) =>
                  setMacro({ ...macro, calories: Number(e.target.value) })
                }
                required
              />
            </Field>
          }
          <div className="form-grid three">
            {(["protein", "carbs", "fat"] as const).map((k) => (
              <Field
                key={k}
                label={k + " (" + (mode === "grams" ? "g" : "%") + ")"}
              >
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  max={mode === "grams" ? 1500 : 100}
                  value={
                    mode === "grams"
                      ? Math.round(macro[k] * 10) / 10
                      : percent[k]
                  }
                  onChange={(e) =>
                    mode === "grams"
                      ? setMacro({ ...macro, [k]: Number(e.target.value) })
                      : setPercent({ ...percent, [k]: Number(e.target.value) })
                  }
                  required
                />
              </Field>
            ))}
          </div>
          <p className="muted">
            {mode === "grams"
              ? `${Math.round(macroCalories(macro))} kcal from macros (4/4/9). Your calorie target remains independently editable.`
              : `${percent.protein + percent.carbs + percent.fat}% allocated. Must total 100%.`}
          </p>
        </>
      )}
      <label className="checkbox">
        <input
          name="exerciseCalories"
          type="checkbox"
          defaultChecked={initial?.exerciseCalories ?? false}
        />
        Add estimated activity calories to my calorie target
      </label>
      <p className="muted small-copy">
        Off by default. Your activity multiplier already includes usual
        exercise; enabling this may count some expenditure twice. Food is not
        something you need to earn.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary full" disabled={busy}>
        {busy
          ? "Saving your plan…"
          : initial
            ? "Save my plan"
            : "Let’s get started"}
        <ArrowRight size={18} />
      </button>
    </form>
  );
}
