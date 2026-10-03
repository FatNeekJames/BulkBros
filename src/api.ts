import { z } from "zod";
import {
  dateSchema,
  foodSchema,
  logSchema,
  logBatchSchema,
  profileSchema,
  workoutSchema,
  type Snapshot,
  type FoodLog,
  type Workout,
  type WeightEntry,
  type Activity,
  type Profile,
} from "../shared/domain";
import { newId } from "./id";
import {
  accountLifetime,
  isCurrentAccount,
  requireAccountWork,
  requireCurrentAccount,
  commitAccountBoundary,
  startAccountLifetime,
  StaleAccountError,
  type AccountLifetime,
} from "./accountLifecycle";
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
  expectedUserId?: string,
  lifetime = accountLifetime(),
): Promise<T> {
  requireCurrentAccount(lifetime);
  const accountChange =
    path.startsWith("/auth/") || (path === "/account" && method === "DELETE");
  if (!accountChange) requireAccountWork(lifetime);
  if (expectedUserId && lifetime.userId && expectedUserId !== lifetime.userId)
    throw new StaleAccountError();
  try {
    const r = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Bulkbro-Client": "1",
        ...(expectedUserId ? { "X-Bulkbro-User": expectedUserId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    requireCurrentAccount(lifetime);
    const data = await r.json().catch(() => {
      throw new ApiError(
        "The server response could not be read. Check your diary before retrying the save.",
        r.status,
      );
    });
    requireCurrentAccount(lifetime);
    if (!r.ok)
      throw new ApiError(data.error || "Request failed", r.status, data.code);
    if (path === "/snapshot") {
      const parsed = snapshotSchema.safeParse(data);
      if (!parsed.success)
        throw new ApiError(
          "Your account data could not be read safely. Please retry; existing records have not been changed.",
          503,
        );
      return parsed.data as T;
    }
    return data;
  } catch (error) {
    // A late network failure is cancellation, never a reason to enqueue offline data.
    requireCurrentAccount(lifetime);
    throw error;
  }
}
export type Pending = {
  id: string;
  userId: string;
  path: string;
  body: unknown;
  method: string;
  conflict?: { status: number; message: string };
};
const queueKey = "bulkbro-pending-v1";
const cacheKey = "bulkbro-cache";
const warnings = new Map<string, string>();
export class LocalStorageError extends Error {}
export function storageWarning() {
  return [...warnings.values()].join(" ");
}
const weightSchema = z.object({
  id: z.string().uuid(),
  date: dateSchema,
  weight: z.number().finite().min(30).max(350),
});
const activitySchema = z.object({
  date: dateSchema,
  steps: z.number().int().min(0).max(100000),
  water: z.number().finite().min(0).max(20),
  activeCalories: z.number().finite().min(0).max(10000),
});
const snapshotSchema = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string().email() }),
  profile: profileSchema.nullable(),
  foods: z.array(foodSchema.extend({ id: z.string().optional() })),
  logs: z.array(logSchema),
  weights: z.array(weightSchema),
  activity: z.array(activitySchema),
  workouts: z.array(
    workoutSchema.extend({ calories: z.number().finite().min(0).optional() }),
  ),
  savedMeals: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100),
      servings: z.number().finite().min(0.1).max(1000),
      ingredients: z
        .array(foodSchema.extend({ id: z.string().optional() }))
        .min(1),
    }),
  ),
  favourites: z.array(z.string()),
});
function mealDeletion(path: string) {
  if (!path.startsWith("/logs?")) return null;
  const query = new URL(path, "http://bulkbro.local").searchParams;
  const value = z
    .object({ date: dateSchema, meal: z.string().trim().min(1).max(40) })
    .safeParse({ date: query.get("date"), meal: query.get("meal") });
  return value.success ? value.data : null;
}
const queueItemSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    path: z.string(),
    body: z.unknown(),
    method: z.string(),
    conflict: z
      .object({
        status: z.number().int().min(400).max(499),
        message: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((item, ctx) => {
    const valid =
      (item.path === "/logs" &&
        item.method === "POST" &&
        logBatchSchema.safeParse(item.body).success) ||
      (/^\/logs\/[0-9a-f-]{36}$/i.test(item.path) &&
        item.method === "PUT" &&
        logSchema.safeParse(item.body).success &&
        (item.body as FoodLog).id === item.path.slice(6)) ||
      (/^\/logs\/[0-9a-f-]{36}$/i.test(item.path) &&
        item.method === "DELETE") ||
      (item.method === "DELETE" && mealDeletion(item.path) !== null) ||
      (item.path === "/profile" &&
        item.method === "PUT" &&
        profileSchema.safeParse(item.body).success) ||
      (item.path === "/workouts" &&
        item.method === "POST" &&
        workoutSchema.safeParse(item.body).success) ||
      (item.path === "/weights" &&
        item.method === "POST" &&
        weightSchema.safeParse(item.body).success) ||
      (item.path === "/activity" &&
        item.method === "PUT" &&
        activitySchema.safeParse(item.body).success);
    if (!valid)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid queued entry",
      });
  });
function readQueue(): Pending[] {
  try {
    const value = z
      .array(queueItemSchema)
      .parse(JSON.parse(localStorage.getItem(queueKey) || "[]"));
    warnings.delete(queueKey);
    return value as Pending[];
  } catch {
    const message =
      "Offline entries cannot be read from this browser. Existing storage has been preserved; reconnect before saving.";
    warnings.set(queueKey, message);
    throw new LocalStorageError(message);
  }
}
function writeQueue(value: Pending[], synced = false) {
  try {
    localStorage.setItem(queueKey, JSON.stringify(value));
    warnings.delete(queueKey);
  } catch {
    const message = synced
      ? "Your entry reached the server, but this browser could not clear its offline queue. Reconnect to retry safely."
      : "Not saved: this browser could not store your offline entry. Keep this form open and reconnect to save.";
    warnings.set(queueKey, message);
    throw new LocalStorageError(message);
  }
}
export function pending(): Pending[] {
  try {
    return readQueue();
  } catch {
    return [];
  }
}
export function enqueue(
  userId: string,
  path: string,
  body: unknown,
  method = "POST",
  lifetime = accountLifetime(),
) {
  const q = readQueue();
  requireAccountWork(lifetime);
  const item = { id: newId(), userId, path, body, method };
  if (!queueItemSchema.safeParse(item).success)
    throw new LocalStorageError(
      "This entry cannot be saved offline. Reconnect and try again.",
    );
  q.push(item);
  writeQueue(q);
}
const syncs = new Map<
  string,
  { lifetime: AccountLifetime; operation: Promise<void> }
>();
export async function waitForSync(
  userId: string,
  lifetime = accountLifetime(),
): Promise<void> {
  requireAccountWork(lifetime);
  const current = syncs.get(userId);
  if (current?.lifetime === lifetime) await current.operation;
  requireAccountWork(lifetime);
}
type Operation = Pick<Pending, "path" | "body" | "method">;
function overlaps(a: Operation, b: Operation): boolean {
  const aLogs =
    a.path === "/logs" || a.path.startsWith("/logs/") || mealDeletion(a.path);
  const bLogs =
    b.path === "/logs" || b.path.startsWith("/logs/") || mealDeletion(b.path);
  if (aLogs && bLogs) {
    const aGroup = mealDeletion(a.path);
    const bGroup = mealDeletion(b.path);
    if (aGroup && bGroup)
      return aGroup.date === bGroup.date && aGroup.meal === bGroup.meal;
    if (aGroup || bGroup) {
      const group = (aGroup || bGroup)!;
      const other = aGroup ? b : a;
      // An edit may move an entry out of this meal, and a single-entry delete
      // has no stored meal. Keep their ordering when the source is unknown.
      if (other.path.startsWith("/logs/")) return true;
      return (other.body as FoodLog[]).some(
        (log) => log.date === group.date && log.meal === group.meal,
      );
    }
    const ids = (item: Operation) =>
      item.path === "/logs"
        ? (item.body as FoodLog[]).map((log) => log.id)
        : [item.path.slice(6)];
    const aIds = new Set(ids(a));
    return ids(b).some((id) => aIds.has(id));
  }
  if (a.path !== b.path) return false;
  if (a.path === "/weights" || a.path === "/activity")
    return (
      (a.body as WeightEntry | Activity).date ===
      (b.body as WeightEntry | Activity).date
    );
  if (a.path === "/workouts")
    return (a.body as Workout).id === (b.body as Workout).id;
  return true;
}
function blockedOperations(queue: Pending[]) {
  const blocked: { item: Pending; cause: Pending }[] = [];
  for (const item of queue) {
    const cause = item.conflict
      ? item
      : blocked.find((entry) => overlaps(entry.item, item))?.cause;
    if (cause) blocked.push({ item, cause });
  }
  return blocked;
}
export function pendingConflict(
  userId: string,
  path: string,
  body: unknown,
  method = "POST",
): Pending | undefined {
  return blockedOperations(
    readQueue().filter((item) => item.userId === userId),
  ).find(({ item }) => overlaps(item, { path, body, method }))?.cause;
}
export function syncQueue(
  userId: string,
  lifetime = accountLifetime(),
): Promise<void> {
  if (!isCurrentAccount(lifetime) || lifetime.changing)
    return Promise.reject(new StaleAccountError());
  const existing = syncs.get(userId);
  if (existing?.lifetime === lifetime) return existing.operation;
  const operation = replayQueue(userId, lifetime).finally(() => {
    if (syncs.get(userId)?.operation === operation) syncs.delete(userId);
  });
  syncs.set(userId, { lifetime, operation });
  return operation;
}
async function replayQueue(userId: string, lifetime: AccountLifetime) {
  const blocked: Pending[] = [];
  for (const item of readQueue().filter((p) => p.userId === userId)) {
    requireAccountWork(lifetime);
    if (item.conflict || blocked.some((earlier) => overlaps(earlier, item))) {
      blocked.push(item);
      continue;
    }
    try {
      await api(item.path, item.method, item.body, userId, lifetime);
    } catch (error) {
      requireAccountWork(lifetime);
      if (
        error instanceof ApiError &&
        [400, 403, 404, 409].includes(error.status) &&
        error.code !== "ACCOUNT_CHANGED"
      ) {
        writeQueue(
          readQueue().map((queued) =>
            queued.id === item.id
              ? {
                  ...queued,
                  conflict: { status: error.status, message: error.message },
                }
              : queued,
          ),
        );
        blocked.push(item);
        continue;
      }
      throw error;
    }
    requireAccountWork(lifetime);
    writeQueue(
      readQueue().filter((p) => p.id !== item.id),
      true,
    );
  }
}
export async function retryPending(
  userId: string,
  itemId: string,
  lifetime = accountLifetime(),
) {
  await waitForSync(userId, lifetime);
  requireAccountWork(lifetime);
  const queue = readQueue();
  const item = queue.find(
    (entry) => entry.id === itemId && entry.userId === userId,
  );
  if (!item?.conflict)
    throw new Error(
      "This queued conflict is no longer available. Refresh your diary.",
    );
  writeQueue(
    queue.map((entry) => {
      if (entry !== item) return entry;
      const { conflict: _conflict, ...retry } = entry;
      return retry;
    }),
  );
  await syncQueue(userId, lifetime);
}
export async function discardPending(
  userId: string,
  itemId: string,
  lifetime = accountLifetime(),
) {
  await waitForSync(userId, lifetime);
  requireAccountWork(lifetime);
  const queue = readQueue();
  const item = queue.find(
    (entry) => entry.id === itemId && entry.userId === userId,
  );
  if (!item)
    throw new Error(
      "This queued change is no longer available. Refresh your diary.",
    );
  writeQueue(queue.filter((entry) => entry !== item));
}
export function overlayPending(snapshot: Snapshot): Snapshot {
  const s = structuredClone(snapshot);
  for (const item of pending().filter((p) => p.userId === s.user.id)) {
    if (item.path === "/logs" && item.method === "POST")
      for (const l of item.body as FoodLog[])
        if (!s.logs.some((x) => x.id === l.id)) s.logs.push(l);
    if (item.path.startsWith("/logs/")) {
      const id = item.path.slice(6);
      if (item.method === "PUT") {
        const log = item.body as FoodLog;
        const index = s.logs.findIndex((entry) => entry.id === id);
        if (index === -1) s.logs.push(log);
        else s.logs[index] = log;
      }
      if (item.method === "DELETE")
        s.logs = s.logs.filter((log) => log.id !== id);
    }
    const group = item.method === "DELETE" ? mealDeletion(item.path) : null;
    if (group)
      s.logs = s.logs.filter(
        (log) => log.date !== group.date || log.meal !== group.meal,
      );
    if (item.path === "/profile") s.profile = item.body as Profile;
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
export function cacheSnapshot(s: Snapshot, lifetime = accountLifetime()) {
  requireAccountWork(lifetime);
  try {
    snapshotSchema.parse(s);
    localStorage.setItem(cacheKey, JSON.stringify(s));
    warnings.delete(cacheKey);
    return true;
  } catch {
    warnings.set(
      cacheKey,
      "Offline access is unavailable because this browser could not save a valid cache. Server saves still work when connected.",
    );
    return false;
  }
}
export function cachedSnapshot(): Snapshot | null {
  try {
    const saved = localStorage.getItem(cacheKey);
    if (saved === null) return null;
    const result = snapshotSchema.parse(JSON.parse(saved));
    warnings.delete(cacheKey);
    return result;
  } catch {
    warnings.set(
      cacheKey,
      "Saved offline data cannot be read. Reconnect to load your account; existing storage has been preserved.",
    );
    return null;
  }
}
export function clearLocal() {
  // Invalidate peer work before clearing data, without treating a failed signal as success.
  let boundaryError: unknown;
  try {
    commitAccountBoundary();
  } catch (error) {
    boundaryError = error;
    // The server transition already completed: cancel this tab's old work even
    // if storage cannot notify its peers, and keep the sign-in form usable.
    startAccountLifetime();
  }
  try {
    localStorage.removeItem(cacheKey);
    localStorage.removeItem(queueKey);
    warnings.clear();
  } catch {
    const message =
      "Signed out of the server, but this browser could not clear its offline data. Clear this site's browser data before sharing this device.";
    warnings.set(cacheKey, message);
    if (boundaryError) throw boundaryError;
    throw new LocalStorageError(message);
  }
  if (boundaryError) throw boundaryError;
}
