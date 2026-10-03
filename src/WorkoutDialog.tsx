import { useState } from "react";
import { Plus, Trash2, Check, Dumbbell } from "lucide-react";
import { Modal, Field } from "./components";
import { newId } from "./id";
import { workoutSchema, volume, type Workout } from "../shared/domain";
const templates: Record<string, string[]> = {
  Push: ["Bench press", "Overhead press", "Triceps pushdown"],
  Pull: ["Deadlift", "Lat pulldown", "Barbell row"],
  Legs: ["Squat", "Romanian deadlift", "Leg press"],
  Upper: ["Bench press", "Barbell row", "Overhead press"],
  Lower: ["Squat", "Romanian deadlift", "Calf raise"],
  "Full body": ["Squat", "Bench press", "Barbell row"],
};
export function WorkoutDialog({
  date,
  workouts,
  onClose,
  onSave,
}: {
  date: string;
  workouts: Workout[];
  onClose: () => void;
  onSave: (w: Workout) => Promise<void>;
}) {
  const [w, setW] = useState<Workout>({
      id: newId(),
      date,
      name: "",
      duration: 45,
      intensity: "moderate",
      exercises: [{ name: "", sets: [{ weight: 0, reps: 8 }] }],
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function template(name: string, names: string[]) {
    setW({
      ...w,
      name,
      exercises: names.map((name) => ({
        name,
        sets: [{ weight: 0, reps: 8 }],
      })),
    });
  }
  function update(
    i: number,
    j: number,
    key: "weight" | "reps" | "rpe",
    v: number,
  ) {
    setW({
      ...w,
      exercises: w.exercises.map((e, index) =>
        index === i
          ? {
              ...e,
              sets: e.sets.map((s, k) => (k === j ? { ...s, [key]: v } : s)),
            }
          : e,
      ),
    });
  }
  return (
    <Modal title="Put another session in the books" wide onClose={onClose}>
      <p className="muted">
        Start from a routine or build your own. Working weights are always yours
        to enter.
      </p>
      <div className="suggestions">
        {Object.entries(templates).map(([name, names]) => (
          <button
            className="chip"
            key={name}
            onClick={() => template(name, names)}
          >
            <Dumbbell size={14} />
            {name}
          </button>
        ))}
      </div>
      {workouts.length > 0 && (
        <Field label="Reuse a previous routine">
          <select
            defaultValue=""
            onChange={(e) => {
              const old = workouts.find((w) => w.id === e.target.value);
              if (old)
                setW({
                  ...old,
                  id: w.id,
                  date,
                  exercises: old.exercises.map((e) => ({
                    ...e,
                    sets: e.sets.map((s) => ({ ...s })),
                  })),
                });
            }}
          >
            <option value="" disabled>
              Choose a previous workout
            </option>
            {workouts
              .slice()
              .reverse()
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.date}
                </option>
              ))}
          </select>
        </Field>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave(workoutSchema.parse(w));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Workout name">
            <input
              value={w.name}
              maxLength={100}
              required
              placeholder="e.g. Monday push"
              onChange={(e) => setW({ ...w, name: e.target.value })}
            />
          </Field>
          <Field label="Duration (minutes)">
            <input
              type="number"
              min="1"
              max="600"
              required
              value={w.duration}
              onChange={(e) => setW({ ...w, duration: Number(e.target.value) })}
            />
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={w.date}
              required
              onChange={(e) => setW({ ...w, date: e.target.value })}
            />
          </Field>
          <Field label="Session intensity">
            <select
              value={w.intensity}
              onChange={(e) =>
                setW({
                  ...w,
                  intensity: e.target.value as Workout["intensity"],
                })
              }
            >
              <option value="light">Light</option>
              <option value="moderate">Moderate</option>
              <option value="vigorous">Vigorous</option>
            </select>
          </Field>
        </div>
        {w.exercises.map((exercise, i) => {
          const last = workouts
            .slice()
            .reverse()
            .flatMap((w) => w.exercises)
            .find((e) => e.name.toLowerCase() === exercise.name.toLowerCase());
          return (
            <div className="exercise-editor" key={i}>
              <div className="exercise-heading">
                <Field label={"Exercise " + (i + 1)}>
                  <input
                    list="exercises"
                    aria-label={"Exercise " + (i + 1)}
                    required
                    placeholder="Exercise name"
                    value={exercise.name}
                    onChange={(e) =>
                      setW({
                        ...w,
                        exercises: w.exercises.map((x, k) =>
                          k === i ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </Field>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove exercise"
                  disabled={w.exercises.length === 1}
                  onClick={() =>
                    setW({
                      ...w,
                      exercises: w.exercises.filter((_, k) => k !== i),
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {last && (
                <small className="muted">
                  Last session:{" "}
                  {last.sets
                    .map((s) => `${s.weight} kg × ${s.reps}`)
                    .join(" · ")}
                </small>
              )}
              <div className="set-head">
                <span>SET</span>
                <span>WEIGHT (KG)</span>
                <span>REPS</span>
                <span>RPE (OPTIONAL)</span>
                <span />
              </div>
              {exercise.sets.map((s, j) => (
                <div className="set-row" key={j}>
                  <span>{j + 1}</span>
                  <input
                    aria-label={`Exercise ${i + 1} set ${j + 1} weight`}
                    type="number"
                    min="0"
                    max="1500"
                    step="0.5"
                    required
                    value={s.weight}
                    onChange={(e) =>
                      update(i, j, "weight", Number(e.target.value))
                    }
                  />
                  <input
                    aria-label={`Exercise ${i + 1} set ${j + 1} reps`}
                    type="number"
                    min="1"
                    max="1000"
                    required
                    value={s.reps}
                    onChange={(e) =>
                      update(i, j, "reps", Number(e.target.value))
                    }
                  />
                  <input
                    aria-label={`Exercise ${i + 1} set ${j + 1} RPE`}
                    type="number"
                    min="1"
                    max="10"
                    step="0.5"
                    value={s.rpe ?? ""}
                    onChange={(e) => {
                      if (e.target.value)
                        update(i, j, "rpe", Number(e.target.value));
                      else
                        setW({
                          ...w,
                          exercises: w.exercises.map((x, k) =>
                            k === i
                              ? {
                                  ...x,
                                  sets: x.sets.map((a, b) =>
                                    b === j ? { ...a, rpe: undefined } : a,
                                  ),
                                }
                              : x,
                          ),
                        });
                    }}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove set"
                    disabled={exercise.sets.length === 1}
                    onClick={() =>
                      setW({
                        ...w,
                        exercises: w.exercises.map((x, k) =>
                          k === i
                            ? { ...x, sets: x.sets.filter((_, b) => b !== j) }
                            : x,
                        ),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setW({
                    ...w,
                    exercises: w.exercises.map((x, k) =>
                      k === i
                        ? { ...x, sets: [...x.sets, { ...x.sets.at(-1)! }] }
                        : x,
                    ),
                  })
                }
              >
                <Plus size={15} />
                Add set
              </button>
            </div>
          );
        })}
        <datalist id="exercises">
          {Array.from(new Set(Object.values(templates).flat())).map((e) => (
            <option key={e} value={e} />
          ))}
        </datalist>
        <button
          type="button"
          className="button secondary full"
          onClick={() =>
            setW({
              ...w,
              exercises: [
                ...w.exercises,
                { name: "", sets: [{ weight: 0, reps: 8 }] },
              ],
            })
          }
        >
          <Plus size={17} />
          Add exercise
        </button>
        <div className="workout-total">
          <span>Total volume</span>
          <strong>{volume(w).toLocaleString()} kg</strong>
        </div>
        <p className="muted">
          Energy expenditure will be a MET-based estimate using your bodyweight,
          duration and intensity—not a precise calculation from sets and reps.
        </p>
        {error && <p className="error">{error}</p>}
        <button className="button primary full" disabled={busy}>
          {busy ? "Saving session…" : "Complete workout"}
          <Check size={18} />
        </button>
      </form>
    </Modal>
  );
}
