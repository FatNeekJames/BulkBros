import type {
  Snapshot,
  FoodLog,
  Workout,
  WeightEntry,
  Activity,
} from "../shared/domain";
import { newId } from "./id";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Bulkbro-Client": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r
    .json()
    .catch(() => ({ error: "Unexpected server response" }));
  if (!r.ok)
    throw new ApiError(data.error || "Request failed", r.status, data.code);
  return data;
}
type Pending = {
  id: string;
  userId: string;
  path: string;
  body: unknown;
  method: string;
};
const queueKey = "bulkbro-pending-v1";
export function pending(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(queueKey) || "[]");
  } catch {
    return [];
  }
}
export function enqueue(
  userId: string,
  path: string,
  body: unknown,
  method = "POST",
) {
  const q = pending();
  q.push({ id: newId(), userId, path, body, method });
  localStorage.setItem(queueKey, JSON.stringify(q));
}
export async function syncQueue(userId: string) {
  for (const item of pending().filter((p) => p.userId === userId)) {
    await api(item.path, item.method, item.body);
    localStorage.setItem(
      queueKey,
      JSON.stringify(pending().filter((p) => p.id !== item.id)),
    );
  }
}
export function overlayPending(snapshot: Snapshot): Snapshot {
  const s = structuredClone(snapshot);
  for (const item of pending().filter((p) => p.userId === s.user.id)) {
    if (item.path === "/logs")
      for (const l of item.body as FoodLog[])
        if (!s.logs.some((x) => x.id === l.id)) s.logs.push(l);
    if (item.path === "/workouts") {
      const w = item.body as Workout;
      if (!s.workouts.some((x) => x.id === w.id)) s.workouts.push(w);
    }
    if (item.path === "/weights") {
      const w = item.body as WeightEntry;
      s.weights = [...s.weights.filter((x) => x.date !== w.date), w];
    }
    if (item.path === "/activity") {
      const a = item.body as Activity;
      s.activity = [...s.activity.filter((x) => x.date !== a.date), a];
    }
  }
  return s;
}
export function cacheSnapshot(s: Snapshot) {
  localStorage.setItem("bulkbro-cache", JSON.stringify(s));
}
export function cachedSnapshot(): Snapshot | null {
  try {
    return JSON.parse(localStorage.getItem("bulkbro-cache") || "null");
  } catch {
    return null;
  }
}
export function clearLocal() {
  localStorage.removeItem("bulkbro-cache");
  localStorage.removeItem(queueKey);
}
