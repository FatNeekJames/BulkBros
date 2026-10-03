import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import {
  LayoutDashboard,
  Utensils,
  Dumbbell,
  ChartNoAxesCombined,
  Settings,
  Plus,
  Flame,
  Footprints,
  Droplets,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  ArrowRight,
  Scale,
  LogOut,
  WifiOff,
  Check,
  Target,
  Trophy,
  Menu,
  X,
  Trash2,
  Copy,
  Bookmark,
  Download,
  Pencil,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import {
  api,
  ApiError,
  cacheSnapshot,
  cachedSnapshot,
  clearLocal,
  enqueue,
  pending,
  syncQueue,
  waitForSync,
  retryPending,
  discardPending,
  pendingConflict,
  overlayPending,
  storageWarning,
} from "./api";
import { Modal, Field, Progress, Empty, Stat } from "./components";
import { FoodDialog } from "./FoodDialog";
import { WorkoutDialog } from "./WorkoutDialog";
import { EditFoodDialog, TargetsDialog } from "./DiaryDialogs";
import { ProfileForm } from "./ProfileForm";
import { QueueRecovery } from "./QueueRecovery";
import { newId } from "./id";
import {
  accountLifetime,
  accountBoundaryKey,
  boundaryIsSignedIn,
  beginAccountChange,
  commitAccountBoundary,
  isCurrentAccount,
  requireAccountWork,
  requireCurrentAccount,
  startAccountLifetime,
  StaleAccountError,
  type AccountLifetime,
} from "./accountLifecycle";
import {
  calculateTargets,
  totals,
  localDate,
  offsetDate,
  streak,
  mealStreak,
  currentTimeZone,
  rollingWeights,
  volume,
  personalRecords,
  achievements,
  type Snapshot,
  type FoodLog,
  type Profile,
  type Workout,
  type WeightEntry,
  type Activity,
} from "../shared/domain";
export const BRAND = import.meta.env.VITE_APP_NAME || "Bulk Bro";
const nav = [
  { id: "home", label: "Overview", icon: LayoutDashboard },
  { id: "food", label: "Food diary", icon: Utensils },
  { id: "training", label: "Training", icon: Dumbbell },
  { id: "progress", label: "Progress", icon: ChartNoAxesCombined },
];
const fmt = (n: number) => Math.round(n).toLocaleString();
const mealNames = ["Breakfast", "Lunch", "Dinner", "Snacks"];
type Dialog =
  "food" | "workout" | "weight" | "activity" | "profile" | "targets" | null;
export default function App() {
  const [data, setData] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("home"),
    [date, setDate] = useState(localDate()),
    [clockDay, setClockDay] = useState(localDate()),
    [timezone, setTimezone] = useState(currentTimeZone()),
    [editing, setEditing] = useState<FoodLog | null>(null),
    [mutationBusy, setMutationBusy] = useState(false),
    [dialog, setDialog] = useState<Dialog>(null),
    [foodMode, setFoodMode] = useState("search"),
    [meal, setMeal] = useState("Breakfast"),
    [notice, setNotice] = useState(""),
    [offline, setOffline] = useState(!navigator.onLine),
    [queueItems, setQueueItems] = useState(pending),
    [syncBusy, setSyncBusy] = useState(false),
    [mobileNav, setMobileNav] = useState(false);
  const recovering = useRef(false);
  const refreshRevision = useRef(0);
  const activeMutations = useRef(new Set<Promise<void>>());
  const [renderedLifetime, setRenderedLifetime] = useState(accountLifetime);
  const applySnapshot = useCallback(
    (snapshot: Snapshot, lifetime: AccountLifetime) => {
      requireAccountWork(lifetime);
      if (lifetime.userId !== snapshot.user.id) {
        lifetime = startAccountLifetime(snapshot.user.id, lifetime.boundary);
        setRenderedLifetime(lifetime);
        setDialog(null);
        setEditing(null);
        setPage("home");
      }
      const s = overlayPending(snapshot);
      cacheSnapshot(s, lifetime);
      setData(s);
      setQueueItems(pending());
      return lifetime;
    },
    [],
  );
  const refresh = useCallback(
    async (lifetime = accountLifetime()) => {
      requireAccountWork(lifetime);
      if (recovering.current) return;
      const revision = refreshRevision.current;
      const snapshot = await api<Snapshot>(
        "/snapshot",
        "GET",
        undefined,
        undefined,
        lifetime,
      );
      requireAccountWork(lifetime);
      // A snapshot requested before recovery cannot overwrite its newer result.
      if (!recovering.current && revision === refreshRevision.current)
        return applySnapshot(snapshot, lifetime);
    },
    [applySnapshot],
  );
  // Child callbacks retain their originating lifetime across awaits and account switches.
  const refreshRenderedAccount = () => refresh(renderedLifetime).then(() => {});
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== accountBoundaryKey && event.key !== null) return;
      if (isCurrentAccount(accountLifetime())) return;
      // Peers adopt the marker without writing it or clearing another tab's new data.
      const lifetime = startAccountLifetime();
      setRenderedLifetime(lifetime);
      refreshRevision.current += 1;
      recovering.current = false;
      activeMutations.current.clear();
      setData(null);
      setQueueItems([]);
      setDialog(null);
      setEditing(null);
      setPage("home");
      setNotice("");
      setAuthError("");
      setAuthBusy(false);
      setSyncBusy(false);
      setMutationBusy(false);
      setLoading(false);
      if (boundaryIsSignedIn()) {
        void refresh(lifetime).catch((error) => {
          if (
            isCurrentAccount(lifetime) &&
            !(error instanceof StaleAccountError)
          )
            setNotice(
              "Your account changed in another tab. Sign in again or reload to continue.",
            );
        });
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [refresh]);
  useEffect(() => {
    const tick = () => {
      const next = localDate();
      setClockDay((previous) => {
        if (previous !== next)
          setDate((selected) =>
            selected === previous && !dialog && !editing ? next : selected,
          );
        return next;
      });
      setTimezone(currentTimeZone());
    };
    const timer = window.setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [dialog, editing]);
  useEffect(() => {
    const lifetime = accountLifetime();
    let completedLifetime = lifetime;
    refresh(lifetime)
      .then((applied) => {
        if (applied) completedLifetime = applied;
      })
      .catch((e) => {
        if (!isCurrentAccount(lifetime) || e instanceof StaleAccountError)
          return;
        if (e instanceof ApiError && e.status === 401) {
          try {
            clearLocal();
          } catch (error) {
            setNotice((error as Error).message);
          }
          completedLifetime = accountLifetime();
          setRenderedLifetime(completedLifetime);
          setData(null);
        } else {
          const saved = cachedSnapshot();
          if (saved) completedLifetime = applySnapshot(saved, lifetime);
          else setData(null);
          setOffline(true);
          if (!saved)
            setNotice(
              "Cannot reach the server. Check your connection and retry.",
            );
        }
      })
      .finally(() => {
        if (isCurrentAccount(completedLifetime)) setLoading(false);
      });
  }, [refresh, applySnapshot]);
  useEffect(() => {
    const lifetime = accountLifetime();
    if (
      data?.user.id &&
      lifetime.userId === data.user.id &&
      !lifetime.changing &&
      !recovering.current &&
      navigator.onLine &&
      pending().some((p) => p.userId === data.user.id)
    ) {
      syncQueue(data.user.id, lifetime)
        .then(() => refresh(lifetime))
        .catch((e) => {
          if (isCurrentAccount(lifetime))
            setNotice(
              "Your queued entries are saved on this device. Sync needs attention: " +
                e.message,
            );
        })
        .finally(() => {
          if (isCurrentAccount(lifetime)) setQueueItems(pending());
        });
    }
  }, [data?.user.id, refresh, renderedLifetime]);
  useEffect(() => {
    const lifetime = accountLifetime();
    const online = () => {
      if (!isCurrentAccount(lifetime) || lifetime.changing) return;
      setOffline(false);
      if (data && !recovering.current)
        (pending().some((item) => item.userId === data.user.id)
          ? syncQueue(data.user.id, lifetime)
          : Promise.resolve()
        )
          .then(() => refresh(lifetime))
          .then(() => {
            requireAccountWork(lifetime);
            const remaining = pending().filter(
              (item) => item.userId === data.user.id,
            );
            setNotice(
              remaining.length
                ? "Some changes need your attention. Other entries can still sync."
                : "Your offline entries are synced.",
            );
          })
          .catch((e) => {
            if (isCurrentAccount(lifetime))
              setNotice("Sync needs attention: " + e.message);
          })
          .finally(() => {
            if (isCurrentAccount(lifetime)) setQueueItems(pending());
          });
    };
    const off = () => {
      if (isCurrentAccount(lifetime)) setOffline(true);
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", off);
    };
  }, [data?.user.id, refresh, renderedLifetime]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(t);
  }, [notice]);
  async function recoverQueue(action: "retry" | "discard", id?: string) {
    const lifetime = renderedLifetime;
    requireAccountWork(lifetime);
    if (!data || recovering.current) return;
    // Lock synchronously, before any promise yields, so a new online event or
    // save cannot start between draining writes and reading the baseline.
    recovering.current = true;
    refreshRevision.current += 1;
    setSyncBusy(true);
    setNotice("");
    try {
      await Promise.allSettled([...activeMutations.current]);
      requireAccountWork(lifetime);
      await waitForSync(data.user.id, lifetime);
      if (action === "discard" && id) {
        // Load the account first so discarding a local edit cannot leave an old
        // optimistic copy visible if the server is unreachable.
        const baseline = await api<Snapshot>(
          "/snapshot",
          "GET",
          undefined,
          data.user.id,
          lifetime,
        );
        requireAccountWork(lifetime);
        if (baseline.user.id !== data.user.id)
          throw new Error(
            "Your account changed. Reload before resolving changes.",
          );
        await discardPending(data.user.id, id, lifetime);
        requireAccountWork(lifetime);
        applySnapshot(baseline, lifetime);
        setNotice(
          "Selected local change discarded. Other queued changes are kept.",
        );
      } else {
        if (id) await retryPending(data.user.id, id, lifetime);
        else await syncQueue(data.user.id, lifetime);
        requireAccountWork(lifetime);
        const snapshot = await api<Snapshot>(
          "/snapshot",
          "GET",
          undefined,
          data.user.id,
          lifetime,
        );
        applySnapshot(snapshot, lifetime);
        setNotice(
          pending().some((item) => item.userId === data.user.id)
            ? "Some changes still need attention. Your local changes are kept."
            : "Your offline entries are synced.",
        );
      }
    } catch (e) {
      if (isCurrentAccount(lifetime))
        setNotice("Could not resolve this change: " + (e as Error).message);
    } finally {
      if (isCurrentAccount(lifetime)) {
        setQueueItems(pending());
        recovering.current = false;
        setSyncBusy(false);
      }
    }
  }
  function mutate(
    path: string,
    body: unknown,
    method = "POST",
    optimistic?: (s: Snapshot) => Snapshot,
  ) {
    if (recovering.current)
      return Promise.reject(
        new Error(
          "A queued change is being resolved. Keep this form open and save again in a moment.",
        ),
      );
    const operation = performMutation(path, body, method, optimistic);
    activeMutations.current.add(operation);
    return operation.finally(() => activeMutations.current.delete(operation));
  }
  async function performMutation(
    path: string,
    body: unknown,
    method = "POST",
    optimistic?: (s: Snapshot) => Snapshot,
  ) {
    const lifetime = renderedLifetime;
    requireAccountWork(lifetime);
    if (!data) return;
    setNotice("");
    try {
      if (!navigator.onLine) throw new TypeError("Offline");
      // Replay earlier edits before a new write so reconnect cannot restore stale portions.
      if (pending().some((item) => item.userId === data.user.id)) {
        try {
          await syncQueue(data.user.id, lifetime);
        } finally {
          if (isCurrentAccount(lifetime)) setQueueItems(pending());
        }
      }
      requireAccountWork(lifetime);
      if (pendingConflict(data.user.id, path, body, method)) {
        if (!optimistic)
          throw new Error(
            "Resolve the earlier change to this record before saving.",
          );
        enqueue(data.user.id, path, body, method, lifetime);
        const next = optimistic(data);
        setData(next);
        cacheSnapshot(next, lifetime);
        setQueueItems(pending());
        setNotice(
          "Saved on this device. Resolve the earlier change to this record to sync it.",
        );
        return;
      }
      await api(path, method, body, data.user.id, lifetime);
    } catch (e) {
      requireAccountWork(lifetime);
      if (e instanceof TypeError && optimistic) {
        enqueue(data.user.id, path, body, method, lifetime);
        const next = optimistic(data);
        setData(next);
        cacheSnapshot(next, lifetime);
        setQueueItems(pending());
        setNotice("Saved on this device. We’ll sync when you reconnect.");
        return;
      }
      throw e;
    }
    requireAccountWork(lifetime);
    // A refresh/cache failure after a committed write must never queue that write again.
    if (optimistic) {
      const next = optimistic(data);
      setData(next);
      cacheSnapshot(next, lifetime);
    }
    setQueueItems(pending());
    try {
      await refresh(lifetime);
      requireAccountWork(lifetime);
      setNotice("Saved. You can correct it in your food diary.");
    } catch (error) {
      requireAccountWork(lifetime);
      if (error instanceof StaleAccountError) throw error;
      setNotice(
        "Saved to your account, but the latest totals could not load. Reconnect or reload to refresh.",
      );
    }
  }

  async function logFoods(logs: FoodLog[]) {
    await mutate("/logs", logs, "POST", (s) => ({
      ...s,
      logs: [...s.logs, ...logs],
    }));
    requireAccountWork(renderedLifetime);
    if (logs[0]) setDate(logs[0].date);
    setDialog(null);
  }
  async function saveWorkout(w: Workout) {
    await mutate("/workouts", w, "POST", (s) => ({
      ...s,
      workouts: [...s.workouts, w],
    }));
    requireAccountWork(renderedLifetime);
    setDialog(null);
  }
  function openFood(mode = "search", category = "Breakfast") {
    setFoodMode(mode);
    setMeal(category);
    setDialog("food");
  }
  function beginTransition() {
    requireAccountWork(renderedLifetime);
    const transition = beginAccountChange();
    setRenderedLifetime(transition);
    refreshRevision.current += 1;
    recovering.current = false;
    activeMutations.current.clear();
    setSyncBusy(false);
    setMutationBusy(false);
    return transition;
  }
  function clearAccount() {
    try {
      clearLocal();
    } catch (error) {
      setNotice((error as Error).message);
    }
    setRenderedLifetime(accountLifetime());
    setData(null);
    setQueueItems([]);
    setDialog(null);
    setEditing(null);
    setPage("home");
  }
  async function logout() {
    if (!isCurrentAccount(renderedLifetime) || renderedLifetime.changing)
      return;
    if (recovering.current) {
      setNotice(
        "Wait for the queued change to finish resolving before signing out.",
      );
      return;
    }
    if (
      (pending().length ||
        storageWarning().includes("Offline entries cannot be read")) &&
      !window.confirm(
        "There are unsynced or unreadable entries on this device. Signing out will discard them. Sign out anyway?",
      )
    )
      return;
    const transition = beginTransition();
    try {
      try {
        await api("/auth/logout", "POST", undefined, data?.user.id, transition);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
      requireCurrentAccount(transition);
      clearAccount();
    } catch (e) {
      if (!isCurrentAccount(transition)) return;
      setRenderedLifetime(startAccountLifetime(transition.userId));
      setNotice((e as Error).message);
    }
  }
  async function deleteAccount(password: string) {
    const transition = beginTransition();
    try {
      await api("/account", "DELETE", { password }, data?.user.id, transition);
      requireCurrentAccount(transition);
      clearAccount();
    } catch (error) {
      if (isCurrentAccount(transition)) {
        setRenderedLifetime(startAccountLifetime(transition.userId));
        // Resume effects and handlers under a new lifetime after a rejected deletion.
        setNotice((error as Error).message);
      }
      throw error;
    }
  }
  const [authMode, setAuthMode] = useState("register"),
    [authError, setAuthError] = useState(""),
    [authBusy, setAuthBusy] = useState(false);
  async function auth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isCurrentAccount(renderedLifetime) || renderedLifetime.changing)
      return;
    let lifetime = beginTransition();
    setAuthBusy(true);
    setAuthError("");
    const f = new FormData(e.currentTarget);
    try {
      const user = await api<{ id: string }>(
        "/auth/" + authMode,
        "POST",
        {
          email: f.get("email"),
          password: f.get("password"),
        },
        undefined,
        lifetime,
      );
      requireCurrentAccount(lifetime);
      lifetime = commitAccountBoundary(user.id);
      setRenderedLifetime(lifetime);
      await refresh(lifetime);
    } catch (e) {
      if (isCurrentAccount(lifetime)) {
        lifetime = startAccountLifetime(lifetime.userId);
        setRenderedLifetime(lifetime);
        setAuthError((e as Error).message);
      }
    } finally {
      if (isCurrentAccount(lifetime)) setAuthBusy(false);
    }
  }
  if (loading)
    return (
      <div className="loading">
        <img src="/icon.svg" alt="" />
        <p>Getting your day ready…</p>
      </div>
    );
  if (!data)
    return (
      <div className="auth-page">
        <div className="auth-story">
          <div className="brand">
            <img src="/icon.svg" alt="" />
            {BRAND.toUpperCase()}
            <span className="brand-dot">®</span>
          </div>
          <div className="auth-copy">
            <span className="eyebrow">BUILT FOR THE WORK YOU PUT IN</span>
            <h1>
              Eat with purpose.
              <br />
              Lift with intent.
              <br />
              <em>Grow every day.</em>
            </h1>
            <p>
              Build a stronger you.
              <br />
              Less guesswork. More good days.
            </p>
            <div className="auth-features">
              <span>
                <Utensils size={18} /> Fuel smarter
              </span>
              <span>
                <Dumbbell size={18} /> Train stronger
              </span>
              <span>
                <ChartNoAxesCombined size={18} /> See your progress
              </span>
            </div>
          </div>
          <small>BUILD A STRONGER YOU</small>
        </div>
        <div className="auth-panel">
          <div className="logo-tile">
            <img src="/brand.png" alt="Bulk Bro — Build a stronger you" />
          </div>
          <h2>
            {authMode === "register"
              ? "Your next chapter starts here."
              : "Welcome back."}
          </h2>
          <p className="muted">
            {authMode === "register"
              ? "Make consistency your strongest habit."
              : "Let’s pick up where you left off."}
          </p>
          <form onSubmit={auth}>
            <Field label="Email">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password" hint="At least 12 characters.">
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete={
                  authMode === "register" ? "new-password" : "current-password"
                }
                required
                placeholder="Your secure password"
              />
            </Field>
            {authError && (
              <p className="error" role="alert">
                {authError}
              </p>
            )}
            <button className="button primary full" disabled={authBusy}>
              {authBusy
                ? "One moment…"
                : authMode === "register"
                  ? "Create your account"
                  : "Sign in"}
              <ArrowRight size={18} />
            </button>
          </form>
          <button
            className="text-button auth-switch"
            onClick={() => {
              setAuthMode(authMode === "register" ? "login" : "register");
              setAuthError("");
            }}
          >
            {authMode === "register"
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
          {storageWarning() && (
            <p className="error" role="alert">
              {storageWarning()}
            </p>
          )}
          <p className="privacy-note">
            Your health data is private. Nothing is shared publicly.
            <br />
            This initial release is for adults aged 18 and over.
          </p>
        </div>
        {notice && (
          <div className="toast" role="status">
            {notice}
          </div>
        )}
      </div>
    );
  if (!data.profile)
    return (
      <div className="onboarding">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          {BRAND.toUpperCase()}
        </div>
        <div className="onboarding-card">
          <span className="eyebrow">YOUR PLAN. YOUR PACE.</span>
          <h1>Let’s find your starting point.</h1>
          <p className="muted">
            A few details help us estimate your daily fuel. You’re always in
            control.
          </p>
          <ProfileForm
            onSave={async (p) => {
              await api("/profile", "PUT", p, data.user.id, renderedLifetime);
              await refreshRenderedAccount();
            }}
          />
        </div>
        <button className="text-button" onClick={logout}>
          Sign out
        </button>
      </div>
    );
  const p = data.profile,
    baseTargets = p.targets || calculateTargets(p).targets,
    dayLogs = data.logs.filter((l) => l.date === date),
    dayWorkouts = data.workouts.filter((w) => w.date === date),
    activity = data.activity.find((a) => a.date === date) || {
      date,
      steps: 0,
      water: 0,
      activeCalories: 0,
    };
  // Manually supplied active energy is an all-inclusive daily total; never add workout estimates to it.
  const burned =
      activity.activeCalories > 0
        ? activity.activeCalories
        : dayWorkouts.reduce((n, w) => n + (w.calories || 0), 0),
    targets = {
      ...baseTargets,
      calories: baseTargets.calories + (p.exerciseCalories ? burned : 0),
    },
    eaten = totals(dayLogs),
    remaining = targets.calories - eaten.calories,
    streakInfo = mealStreak(
      data.logs.map((l) => l.date),
      clockDay,
    ),
    loggingStreak = streakInfo.current,
    weights = rollingWeights(data.weights),
    currentWeight = weights.at(-1)?.weight ?? p.weight;
  const today = clockDay,
    week = Array.from({ length: 7 }, (_, i) => offsetDate(date, i - 6)),
    chart = week.map((d) => ({
      date: d,
      label: new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
        weekday: "short",
      }),
      ...totals(data.logs.filter((l) => l.date === d)),
      steps: data.activity.find((a) => a.date === d)?.steps || 0,
      workouts: data.workouts.filter((w) => w.date === d).length,
    }));
  const xp =
      data.logs.length * 10 +
      data.workouts.length * 50 +
      data.weights.length * 15 +
      data.activity.filter((a) => a.steps >= p.stepGoal).length * 30,
    level = Math.floor(xp / 250) + 1;
  const summary = (
    <div className="section-heading">
      <div>
        <span className="eyebrow">YOUR DAILY CHECK-IN</span>
        <h1>
          {page === "home"
            ? `Let’s make it count, ${p.name.split(" ")[0]}.`
            : page === "food"
              ? "Fuel your progress."
              : page === "training"
                ? "Put in the work."
                : page === "progress"
                  ? "The bigger picture."
                  : "Make it yours."}
        </h1>
        <p className="muted">
          {page === "home"
            ? "A little more consistent. A little stronger. Every day."
            : page === "food"
              ? "Every meal is a chance to move forward."
              : page === "training"
                ? "Track the effort. See the progress."
                : page === "progress"
                  ? "Trends tell a better story than any single day."
                  : "Your goals, preferences and privacy."}
        </p>
      </div>
      <div className="day-picker">
        <div className="date-control">
          <button
            aria-label="Previous day"
            onClick={() => setDate(offsetDate(date, -1))}
          >
            <ChevronLeft size={17} />
          </button>
          <input
            aria-label="Selected date"
            type="date"
            value={date}
            max={today}
            onChange={(e) =>
              e.target.value &&
              e.target.value <= today &&
              setDate(e.target.value)
            }
          />
          <button
            aria-label="Next day"
            disabled={date >= today}
            onClick={() => setDate(offsetDate(date, 1))}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <small>
          {date === today ? "Today" : "Historical day"} · {timezone}
        </small>
        {date !== today && (
          <button className="text-button" onClick={() => setDate(today)}>
            Back to today
          </button>
        )}
      </div>
    </div>
  );
  const diaryContext = (
    <>
      {(page === "home" || page === "food") && (
        <section className="day-status" aria-label="Logging habit">
          <div data-testid="day-completion">
            <Check size={18} />
            <span>
              {dayLogs.length
                ? "Daily check-in complete"
                : "Your first meal starts the day"}
              <small>
                {date} ·{" "}
                {dayLogs.length
                  ? "A saved meal counts. No calorie target required."
                  : "Nothing logged yet. Add breakfast, lunch, dinner or a snack."}
              </small>
            </span>
          </div>
          <div>
            <strong data-testid="current-streak">{streakInfo.current}</strong>
            <small>Current streak</small>
          </div>
          <div>
            <strong data-testid="best-streak">{streakInfo.best}</strong>
            <small>Best streak</small>
          </div>
        </section>
      )}
      {(page === "home" || page === "food") && (
        <nav className="week-days" aria-label="Recent diary days">
          {week.map((day) => (
            <button
              key={day}
              className={day === date ? "selected" : ""}
              aria-label={`View diary ${day}`}
              aria-current={day === date ? "date" : undefined}
              onClick={() => setDate(day)}
            >
              <span>
                {new Date(day + "T12:00:00").toLocaleDateString(undefined, {
                  weekday: "short",
                })}
              </span>
              <strong>{Number(day.slice(-2))}</strong>
              <small>
                {data.logs.some((l) => l.date === day) ? "Logged" : "—"}
              </small>
            </button>
          ))}
        </nav>
      )}
      {date !== today && (page === "home" || page === "food") && (
        <p className="muted history-note">
          Historical food entries · compared with your current targets.
        </p>
      )}
    </>
  );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobileNav ? "open" : "")}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setPage("home");
          }}
        >
          <img src="/icon.svg" alt="" />
          {BRAND.toUpperCase()}
          <span className="brand-dot">®</span>
        </a>
        <span className="nav-label">YOUR WORKSPACE</span>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => {
                setPage(n.id);
                setMobileNav(false);
              }}
            >
              <n.icon size={21} />
              {n.label}
              {page === n.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="level-card">
            <div>
              <span className="level-icon">
                <Dumbbell size={18} />
              </span>
              <div>
                <strong>Level {level}</strong>
                <small>
                  {level >= 25
                    ? "Athlete"
                    : level >= 10
                      ? "Lifter"
                      : "Building foundations"}
                </small>
              </div>
            </div>
            <Progress value={xp % 250} max={250} />
            <small>{xp % 250} / 250 XP to next level</small>
          </div>
          <button
            className={"settings-nav " + (page === "settings" ? "active" : "")}
            onClick={() => {
              setPage("settings");
              setMobileNav(false);
            }}
          >
            <Settings size={19} />
            Settings & profile
          </button>
          <button className="user-card" onClick={() => setDialog("profile")}>
            <span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{p.name}</strong>
              <small>@{p.username}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu icon-button"
              aria-label="Toggle navigation"
              onClick={() => setMobileNav(!mobileNav)}
            >
              {mobileNav ? <X /> : <Menu />}
            </button>
            <span className="breadcrumb">
              My workspace <span>/</span>{" "}
              <strong>
                {page === "settings"
                  ? "Settings"
                  : nav.find((n) => n.id === page)?.label}
              </strong>
            </span>
          </div>
          <div className="topbar-actions">
            {offline ? (
              <span className="offline">
                <WifiOff size={15} />
                Offline
              </span>
            ) : (
              <span className="private-dot">Private workspace</span>
            )}
            <span className="streak-badge">
              <Flame size={17} />
              {loggingStreak} day{loggingStreak !== 1 ? "s" : ""}
            </span>
            <button className="button primary small" onClick={() => openFood()}>
              <Plus size={17} />
              Log food
            </button>
          </div>
        </header>
        <main>
          <QueueRecovery
            items={queueItems.filter((item) => item.userId === data.user.id)}
            busy={syncBusy}
            onRetry={(id) => recoverQueue("retry", id)}
            onDiscard={(id) => recoverQueue("discard", id)}
          />
          {storageWarning() && (
            <p className="error" role="alert">
              {storageWarning()}
            </p>
          )}
          {summary}
          {page === "home" && (
            <>
              <div className="dashboard-grid">
                <section className="card calorie-card">
                  <div className="card-heading">
                    <h2>Daily fuel</h2>
                    <span className="pill">
                      {p.goal === "gain"
                        ? "BUILD"
                        : p.goal === "lose"
                          ? "CUT"
                          : "MAINTAIN"}
                    </span>
                  </div>
                  <div className="fuel-body">
                    <div
                      className="calorie-ring"
                      style={{
                        background: `conic-gradient(var(--lime) ${Math.min(100, targets.calories > 0 ? (eaten.calories / targets.calories) * 100 : eaten.calories > 0 ? 100 : 0)}%, #30372b 0)`,
                      }}
                    >
                      <div>
                        <span className="ring-label">CALORIES EATEN</span>
                        <strong data-testid="consumed-calories">
                          {fmt(eaten.calories)}
                        </strong>
                        <span>of {fmt(targets.calories)} kcal</span>
                      </div>
                    </div>
                    <div className="fuel-summary">
                      <div>
                        <span className="lime-dot" />
                        <span>
                          {remaining >= 0
                            ? "Calories remaining"
                            : "Above target"}
                        </span>
                      </div>
                      <strong data-testid="remaining-calories">
                        {fmt(Math.abs(remaining))}
                        <small>kcal</small>
                      </strong>
                      <p>
                        {remaining >= 0
                          ? "Fuel for what’s next."
                          : "One day is part of a bigger trend."}
                      </p>
                      <button
                        className="button primary"
                        onClick={() => openFood()}
                      >
                        <Plus size={17} />
                        Log a meal
                      </button>
                    </div>
                  </div>
                  <div className="fuel-footer">
                    <span>
                      <Target size={15} />
                      Your daily target
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setDialog("targets")}
                      aria-label="Edit daily targets"
                    >
                      {fmt(targets.calories)} kcal <ArrowUpRight size={14} />
                    </button>
                  </div>
                </section>
                <section className="card macro-card">
                  <div className="card-heading">
                    <h2>Make your macros</h2>
                    <Utensils size={18} className="muted" />
                  </div>
                  {(["protein", "carbs", "fat"] as const).map((key, i) => (
                    <div className="macro-row" key={key}>
                      <div>
                        <span className={"macro-dot m" + i} />
                        <strong>
                          {key === "carbs"
                            ? "Carbohydrates"
                            : key.charAt(0).toUpperCase() + key.slice(1)}
                        </strong>
                        <span>
                          <b data-testid={`consumed-${key}`}>
                            {eaten[key].toFixed(1)}
                          </b>{" "}
                          / {targets[key].toFixed(1)} g
                        </span>
                      </div>
                      <Progress
                        value={eaten[key]}
                        max={targets[key]}
                        label={key === "carbs" ? "Carbohydrates" : key}
                        color={
                          ["var(--lime)", "var(--purple)", "var(--orange)"][i]
                        }
                      />
                      <small>
                        {Math.abs(targets[key] - eaten[key]).toFixed(1)} g{" "}
                        {eaten[key] > targets[key]
                          ? "over target"
                          : "remaining"}
                      </small>
                    </div>
                  ))}
                  <div className="macro-note">
                    Consistency over perfection. You’ve got this.
                  </div>
                </section>
              </div>
              {diaryContext}
              <div className="lower-grid">
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>On the menu</h2>
                      <p className="muted">
                        Meals for {date}, all in one place.
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setPage("food")}
                    >
                      View diary <ArrowRight size={16} />
                    </button>
                  </div>
                  <MealList
                    logs={dayLogs}
                    onAdd={(m) => openFood("search", m)}
                  />
                </section>
                <section className="card weekly-card">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">THE LONG GAME</span>
                      <h2>Small wins. Real progress.</h2>
                    </div>
                    <ChartNoAxesCombined size={20} className="lime" />
                  </div>
                  <div className="weekly-weight">
                    <strong>
                      {currentWeight.toFixed(1)}
                      <small>kg</small>
                    </strong>
                    <span>
                      {weights.length >= 2
                        ? `${weights.at(-1)!.average - weights[0].average >= 0 ? "+" : ""}${(weights.at(-1)!.average - weights[0].average).toFixed(1)} kg trend change`
                        : "Your starting point"}
                    </span>
                  </div>
                  {weights.length > 1 ? (
                    <WeightChart data={weights.slice(-30)} />
                  ) : (
                    <div className="mini-empty">
                      Your trend starts with a weigh-in.
                      <br />A few entries make the picture clearer.
                    </div>
                  )}
                  <div className="weekly-bottom">
                    <div>
                      <strong>
                        {
                          data.workouts.filter((w) => week.includes(w.date))
                            .length
                        }
                      </strong>
                      <span>sessions this week</span>
                    </div>
                    <button
                      className="button secondary small"
                      onClick={() => setDialog("weight")}
                    >
                      <Plus size={15} />
                      Weigh in
                    </button>
                  </div>
                </section>
              </div>
              <div className="activity-grid">
                <button
                  className="card activity-card"
                  onClick={() => setDialog("activity")}
                >
                  <div className="activity-icon green">
                    <Footprints size={21} />
                  </div>
                  <div>
                    <span>Daily steps</span>
                    <strong>
                      {fmt(activity.steps)}
                      <small> / {fmt(p.stepGoal)}</small>
                    </strong>
                    <Progress value={activity.steps} max={p.stepGoal} />
                  </div>
                  <ArrowUpRight size={17} />
                </button>
                <button
                  className="card activity-card"
                  onClick={() => setDialog("workout")}
                >
                  <div className="activity-icon purple">
                    <Dumbbell size={21} />
                  </div>
                  <div>
                    <span>Training</span>
                    <strong>
                      {dayWorkouts.length
                        ? dayWorkouts.at(-1)!.name
                        : "Ready when you are"}
                    </strong>
                    <small>
                      {dayWorkouts.length
                        ? `${dayWorkouts.length} workout completed`
                        : "Log your next session"}
                    </small>
                  </div>
                  <ArrowUpRight size={17} />
                </button>
                <button
                  className="card activity-card"
                  onClick={() => setDialog("activity")}
                >
                  <div className="activity-icon orange">
                    <Flame size={21} />
                  </div>
                  <div>
                    <span>Active energy · estimate</span>
                    <strong>
                      {fmt(burned)}
                      <small> kcal</small>
                    </strong>
                    <small>
                      {p.exerciseCalories
                        ? "Included in calorie target"
                        : "Separate from your food target"}
                    </small>
                  </div>
                  <ArrowUpRight size={17} />
                </button>
                <button
                  className="card activity-card"
                  onClick={() => setDialog("activity")}
                >
                  <div className="activity-icon blue">
                    <Droplets size={21} />
                  </div>
                  <div>
                    <span>Water intake</span>
                    <strong>
                      {activity.water.toFixed(1)}
                      <small> litres</small>
                    </strong>
                    <small>Keep the good habits flowing</small>
                  </div>
                  <Plus size={17} />
                </button>
              </div>
              <div className="consistency-banner">
                <div className="activity-icon green">
                  <Flame size={24} />
                </div>
                <div>
                  <h3>Keep showing up for yourself.</h3>
                  <p>
                    {loggingStreak
                      ? `${loggingStreak} day${loggingStreak === 1 ? "" : "s"} of food logging. Best so far: ${streakInfo.best} day${streakInfo.best === 1 ? "" : "s"}.`
                      : "Your first log is the start of a stronger routine."}
                  </p>
                </div>
                <small>
                  One saved meal per local day counts.
                  <br />
                  Backfills and deletions recalculate your streak.
                </small>
              </div>
            </>
          )}
          {page === "food" && (
            <>
              <div className="food-summary">
                {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
                  <div className="card" key={k}>
                    <Stat
                      label={k}
                      value={
                        k === "calories" ? fmt(eaten[k]) : eaten[k].toFixed(1)
                      }
                      unit={`/ ${fmt(targets[k])} ${k === "calories" ? "kcal" : "g"}`}
                    />
                    <Progress value={eaten[k]} max={targets[k]} label={k} />
                    <small className="muted">
                      {Math.abs(targets[k] - eaten[k]).toFixed(
                        k === "calories" ? 0 : 1,
                      )}{" "}
                      {k === "calories" ? "kcal" : "g"}{" "}
                      {eaten[k] > targets[k] ? "over target" : "remaining"}
                    </small>
                  </div>
                ))}
              </div>
              {diaryContext}
              <div className="quick-actions">
                <button className="button primary" onClick={() => openFood()}>
                  <Plus size={18} />
                  Add food
                </button>
                <button
                  className="button secondary"
                  onClick={() => openFood("saved")}
                >
                  <Bookmark size={18} />
                  Saved meals & recipes
                </button>
                <button
                  className="button secondary"
                  disabled={mutationBusy}
                  onClick={async () => {
                    const yesterday = data.logs.filter(
                      (l) => l.date === offsetDate(date, -1),
                    );
                    if (!yesterday.length)
                      return setNotice("No food logged on the previous day.");
                    setMutationBusy(true);
                    try {
                      await logFoods(
                        yesterday.map((l) => ({
                          ...l,
                          id: newId(),
                          date,
                          analysisId: undefined,
                        })),
                      );
                    } catch (e) {
                      if (isCurrentAccount(renderedLifetime))
                        setNotice((e as Error).message);
                    } finally {
                      if (isCurrentAccount(renderedLifetime))
                        setMutationBusy(false);
                    }
                  }}
                >
                  <Copy size={18} />
                  Copy previous day
                </button>
              </div>
              {Array.from(
                new Set([...mealNames, ...dayLogs.map((l) => l.meal)]),
              ).map((m) => (
                <section className="card diary-meal" key={m}>
                  <div className="card-heading">
                    <h2>
                      {m}
                      <small>
                        {fmt(
                          totals(dayLogs.filter((l) => l.meal === m)).calories,
                        )}{" "}
                        kcal
                      </small>
                    </h2>
                    <div className="meal-actions">
                      {!!dayLogs.filter((l) => l.meal === m).length && (
                        <button
                          className="text-button danger"
                          disabled={mutationBusy}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Delete every item in ${m} on ${date}?`,
                              )
                            )
                              return;
                            setMutationBusy(true);
                            try {
                              await mutate(
                                `/logs?date=${date}&meal=${encodeURIComponent(m)}`,
                                undefined,
                                "DELETE",
                                (s) => ({
                                  ...s,
                                  logs: s.logs.filter(
                                    (l) => l.date !== date || l.meal !== m,
                                  ),
                                }),
                              );
                            } catch (e) {
                              if (isCurrentAccount(renderedLifetime))
                                setNotice((e as Error).message);
                            } finally {
                              if (isCurrentAccount(renderedLifetime))
                                setMutationBusy(false);
                            }
                          }}
                        >
                          Delete meal
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={() => openFood("search", m)}
                      >
                        <Plus size={17} />
                        Add food
                      </button>
                    </div>
                  </div>
                  {dayLogs.filter((l) => l.meal === m).length ? (
                    dayLogs
                      .filter((l) => l.meal === m)
                      .map((l) => (
                        <div className="food-line" key={l.id}>
                          <div>
                            <strong>{l.name}</strong>
                            <small>
                              {l.serving.toFixed(1)} {l.unit} ·{" "}
                              {l.brand || l.source}
                            </small>
                          </div>
                          <span className="food-macros">
                            P {l.protein.toFixed(1)} g · C {l.carbs.toFixed(1)}{" "}
                            g · F {l.fat.toFixed(1)} g
                          </span>
                          <strong>
                            {fmt(l.calories)}
                            <small> kcal</small>
                          </strong>
                          <button
                            className="icon-button"
                            aria-label={"Edit " + l.name}
                            onClick={() => setEditing(l)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={"Delete " + l.name}
                            onClick={() =>
                              mutate(
                                "/logs/" + l.id,
                                undefined,
                                "DELETE",
                                (s) => ({
                                  ...s,
                                  logs: s.logs.filter(
                                    (entry) => entry.id !== l.id,
                                  ),
                                }),
                              ).catch((e) => {
                                if (isCurrentAccount(renderedLifetime))
                                  setNotice(e.message);
                              })
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))
                  ) : (
                    <p className="muted meal-empty">
                      Nothing logged yet. Add what’s on your plate.
                    </p>
                  )}
                </section>
              ))}
            </>
          )}
          {page === "training" && (
            <>
              <div className="quick-actions">
                <button
                  className="button primary"
                  onClick={() => setDialog("workout")}
                >
                  <Plus size={18} />
                  Log a workout
                </button>
              </div>
              <div className="food-summary">
                <div className="card">
                  <Stat
                    label="Total sessions"
                    value={data.workouts.length}
                    icon={<Dumbbell size={17} />}
                  />
                </div>
                <div className="card">
                  <Stat
                    label="Total volume"
                    value={fmt(
                      data.workouts.reduce((n, w) => n + volume(w), 0),
                    )}
                    unit="kg"
                  />
                </div>
                <div className="card">
                  <Stat
                    label="Time invested"
                    value={fmt(
                      data.workouts.reduce((n, w) => n + w.duration, 0),
                    )}
                    unit="min"
                  />
                </div>
                <div className="card">
                  <Stat
                    label="Personal records"
                    value={personalRecords(data.workouts).length}
                    icon={<Trophy size={17} />}
                  />
                </div>
              </div>
              <section className="card">
                <div className="card-heading">
                  <h2>Your training history</h2>
                  <span className="pill">EVERY REP COUNTS</span>
                </div>
                {data.workouts.length ? (
                  [...data.workouts].reverse().map((w) => (
                    <details className="workout-history" key={w.id}>
                      <summary>
                        <span className="activity-icon purple">
                          <Dumbbell size={19} />
                        </span>
                        <span>
                          <strong>{w.name}</strong>
                          <small>
                            {w.date} · {w.duration} min · {w.exercises.length}{" "}
                            exercises
                          </small>
                        </span>
                        <span>
                          {fmt(volume(w))} kg<small>total volume</small>
                        </span>
                        <ChevronRight size={17} />
                      </summary>
                      <div className="workout-details">
                        {w.exercises.map((e, i) => (
                          <div key={i}>
                            <strong>{e.name}</strong>
                            {e.sets.map((s, j) => (
                              <span key={j}>
                                Set {j + 1}: {s.weight} kg × {s.reps}
                                {s.rpe ? ` · RPE ${s.rpe}` : ""}
                              </span>
                            ))}
                          </div>
                        ))}
                        <p className="muted">
                          Estimated active energy: {w.calories ?? "—"} kcal.
                          This is a MET-based estimate, not a measurement.
                        </p>
                      </div>
                    </details>
                  ))
                ) : (
                  <Empty
                    title="Your first session starts here"
                    text="Log your exercises, sets and reps. We’ll keep track of your progress."
                    action={
                      <button
                        className="button primary"
                        onClick={() => setDialog("workout")}
                      >
                        Log a workout <ArrowRight size={17} />
                      </button>
                    }
                  />
                )}
              </section>
            </>
          )}
          {page === "progress" && (
            <ProgressHub
              data={data}
              date={date}
              onWeight={() => setDialog("weight")}
            />
          )}
          {page === "settings" && (
            <div className="settings-grid">
              <section className="card">
                <h2>Your plan</h2>
                <p className="muted">
                  Goals are estimates. Update them as you learn what works for
                  you.
                </p>
                <dl>
                  <dt>Goal</dt>
                  <dd>
                    {p.goal === "gain"
                      ? "Gain weight"
                      : p.goal === "lose"
                        ? "Lose weight"
                        : "Maintain weight"}
                  </dd>
                  <dt>Estimated BMR</dt>
                  <dd>{calculateTargets(p).bmr} kcal</dd>
                  <dt>Estimated maintenance</dt>
                  <dd>{calculateTargets(p).tdee} kcal</dd>
                  <dt>Daily target</dt>
                  <dd>{fmt(baseTargets.calories)} kcal</dd>
                  <dt>Activity energy</dt>
                  <dd>
                    {p.exerciseCalories ? "Added to target" : "Kept separate"}
                  </dd>
                </dl>
                <button
                  className="button primary"
                  onClick={() => setDialog("profile")}
                >
                  Edit profile & targets <ArrowUpRight size={17} />
                </button>
              </section>
              <section className="card">
                <h2>Privacy comes first</h2>
                <p className="muted">
                  Your diary, bodyweight and training are private. No public
                  profile or social sharing is enabled.
                </p>
                <p className="muted">
                  Records are saved to your private account on this running
                  server. Other devices need to connect to this same server and
                  sign in; there is no cloud service configured. Recent records
                  are cached on this device for offline use. Signing out clears
                  the cache and pending entries.
                </p>
                <div className="stack">
                  <a
                    className="button secondary"
                    href="/api/account/export"
                    download
                  >
                    <Download size={18} />
                    Export my data
                  </a>
                  <button className="button secondary" onClick={logout}>
                    <LogOut size={18} />
                    Sign out
                  </button>
                  <DeleteAccount onDelete={deleteAccount} />
                </div>
              </section>
              <section className="card">
                <h2>Connected devices</h2>
                <p className="muted">
                  Apple Health and Health Connect require native mobile
                  integrations. They are not connected in this web release. You
                  can enter your daily steps and active energy manually.
                </p>
                <button
                  className="button secondary"
                  onClick={() => setDialog("activity")}
                >
                  Enter activity <Footprints size={17} />
                </button>
              </section>
              <section className="card">
                <h2>About your estimates</h2>
                <p className="muted">
                  Calorie targets use Mifflin–St Jeor with an activity
                  multiplier. Use nutrition labels for your custom foods and
                  review portions. Calories display as whole kcal and macros as
                  0.1 g; calculations retain precision. Exercise energy is
                  always an estimate.
                </p>
                <p className="muted">
                  Major dietary changes are worth discussing with a qualified
                  professional. This release doesn’t calculate targets for
                  under-18s.
                </p>
                <small>
                  Photo scanning and AI coaching are deferred. Manual tracking
                  needs no paid API or food catalogue.
                </small>
              </section>
            </div>
          )}
          <footer className="page-footer">
            <span>
              {BRAND.toUpperCase()} <b> / </b> Build a stronger you
            </span>
            <span>Progress consistently. Live fully.</span>
          </footer>
        </main>
      </div>
      {dialog === "food" && (
        <FoodDialog
          data={data}
          date={date}
          meal={meal}
          mode={foodMode}
          onClose={() => setDialog(null)}
          onSave={logFoods}
          onRefresh={refreshRenderedAccount}
        />
      )}
      {dialog === "workout" && (
        <WorkoutDialog
          date={date}
          workouts={data.workouts}
          onClose={() => setDialog(null)}
          onSave={saveWorkout}
        />
      )}
      {dialog === "profile" && (
        <Modal
          title="Your profile & targets"
          wide
          onClose={() => setDialog(null)}
        >
          <ProfileForm
            initial={p}
            onSave={async (profile) => {
              await mutate("/profile", profile, "PUT");
              requireAccountWork(renderedLifetime);
              setDialog(null);
            }}
          />
        </Modal>
      )}
      {dialog === "weight" && (
        <WeightDialog
          date={date}
          current={currentWeight}
          units={p.units}
          onClose={() => setDialog(null)}
          onSave={async (w) => {
            await mutate("/weights", w, "POST", (s) => ({
              ...s,
              weights: [...s.weights.filter((x) => x.date !== w.date), w],
            }));
            requireAccountWork(renderedLifetime);
            setDialog(null);
          }}
        />
      )}
      {dialog === "activity" && (
        <ActivityDialog
          activity={activity}
          onClose={() => setDialog(null)}
          onSave={async (a) => {
            await mutate("/activity", a, "PUT", (s) => ({
              ...s,
              activity: [...s.activity.filter((x) => x.date !== a.date), a],
            }));
            requireAccountWork(renderedLifetime);
            setDialog(null);
          }}
        />
      )}
      {editing && (
        <EditFoodDialog
          entry={editing}
          meals={Array.from(
            new Set([...mealNames, ...data.logs.map((l) => l.meal)]),
          )}
          onClose={() => setEditing(null)}
          onSave={async (entry) => {
            await mutate("/logs/" + entry.id, entry, "PUT", (s) => ({
              ...s,
              logs: s.logs.map((l) => (l.id === entry.id ? entry : l)),
            }));
            requireAccountWork(renderedLifetime);
            setEditing(null);
          }}
        />
      )}
      {dialog === "targets" && (
        <TargetsDialog
          targets={baseTargets}
          onClose={() => setDialog(null)}
          onSave={async (targets) => {
            await mutate("/profile", { ...p, targets }, "PUT", (s) => ({
              ...s,
              profile: { ...p, targets },
            }));
            requireAccountWork(renderedLifetime);
            setDialog(null);
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function MealList({
  logs,
  onAdd,
}: {
  logs: FoodLog[];
  onAdd: (meal: string) => void;
}) {
  return (
    <div className="meal-list">
      {Array.from(
        new Set([...mealNames.slice(0, 4), ...logs.map((l) => l.meal)]),
      ).map((m, i) => {
        const entries = logs.filter((l) => l.meal === m);
        return (
          <div className="meal-row" key={m}>
            <div className={"meal-symbol tone" + (i % 4)}>
              <Utensils size={18} />
            </div>
            <div>
              <strong>{m}</strong>
              <small>
                {entries.length
                  ? entries.map((l) => l.name).join(", ")
                  : "Ready for a little fuel"}
              </small>
            </div>
            <span>
              {entries.length ? `${fmt(totals(entries).calories)} kcal` : "—"}
            </span>
            <button
              className="icon-button add-circle"
              aria-label={"Add " + m}
              onClick={() => onAdd(m)}
            >
              <Plus size={17} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
function WeightChart({ data }: { data: ReturnType<typeof rollingWeights> }) {
  return (
    <div
      className="chart"
      role="img"
      aria-label="Bodyweight and seven-day rolling average chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="weightGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bdff48" stopOpacity={0.23} />
              <stop offset="100%" stopColor="#bdff48" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#30352e" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(s) => s.slice(5)}
            stroke="#767e72"
            tickLine={false}
            axisLine={false}
            minTickGap={30}
          />
          <YAxis domain={["dataMin - 0.5", "dataMax + 0.5"]} hide />
          <Tooltip
            contentStyle={{
              background: "#242920",
              border: "1px solid #404737",
              borderRadius: 10,
            }}
            formatter={(n, name) => [
              Number(n).toFixed(2) + " kg",
              name === "average" ? "7-day average" : "Weigh-in",
            ]}
          />
          <Area
            type="monotone"
            dataKey="weight"
            stroke="#59614f"
            fill="transparent"
            strokeDasharray="4 4"
          />
          <Area
            type="monotone"
            dataKey="average"
            stroke="#bdff48"
            strokeWidth={2.5}
            fill="url(#weightGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
function ProgressHub({
  data,
  date,
  onWeight,
}: {
  data: Snapshot;
  date: string;
  onWeight: () => void;
}) {
  const [range, setRange] = useState(30);
  const p = data.profile!,
    weights = rollingWeights(
      data.weights.filter(
        (w) =>
          w.date <= date &&
          (range === 0 || w.date >= offsetDate(date, -range + 1)),
      ),
    ),
    days = Array.from({ length: 7 }, (_, i) => offsetDate(date, i - 6)),
    logs = data.logs.filter((l) => days.includes(l.date)),
    loggedDays = new Set(logs.map((l) => l.date)).size,
    total = totals(logs),
    workouts = data.workouts.filter((w) => days.includes(w.date)),
    records = personalRecords(data.workouts),
    first = data.weights[0]?.weight ?? p.weight,
    last = data.weights.at(-1)?.weight ?? p.weight,
    chart = days.map((d) => ({
      day: new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
        weekday: "short",
      }),
      ...totals(logs.filter((l) => l.date === d)),
    }));
  return (
    <>
      <div className="food-summary">
        <div className="card">
          <Stat label="Current weight" value={last.toFixed(1)} unit="kg" />
        </div>
        <div className="card">
          <Stat
            label="Since your first weigh-in"
            value={(last - first >= 0 ? "+" : "") + (last - first).toFixed(1)}
            unit="kg"
          />
        </div>
        <div className="card">
          <Stat label="Goal weight" value={p.targetWeight} unit="kg" />
        </div>
        <div className="card">
          <Stat
            label="Food logging streak"
            value={streak(data.logs.map((l) => l.date))}
            unit="days"
          />
        </div>
      </div>
      <section className="card">
        <div className="card-heading">
          <h2>Seven-day food history</h2>
          <small className="muted">Ending {date}</small>
        </div>
        <p className="muted">
          Current calorie target:{" "}
          {fmt(p.targets?.calories ?? calculateTargets(p).targets.calories)}{" "}
          kcal. Empty days mean no record, not zero intake.
        </p>
        <div className="history-scroll">
          <table className="history-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">kcal</th>
                <th scope="col">Protein (g)</th>
                <th scope="col">Carbs (g)</th>
                <th scope="col">Fat (g)</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const entries = logs.filter((l) => l.date === day);
                const total = totals(entries);
                return (
                  <tr key={day}>
                    <th scope="row">{day}</th>
                    {(["calories", "protein", "carbs", "fat"] as const).map(
                      (key) => (
                        <td key={key}>
                          {entries.length
                            ? total[key].toFixed(key === "calories" ? 0 : 1)
                            : "—"}
                        </td>
                      ),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Weight trend</h2>
            <p className="muted">
              Solid line: rolling 7-day average · Dashed line: individual
              weigh-ins
            </p>
          </div>
          <button className="button primary small" onClick={onWeight}>
            <Plus size={16} />
            Weigh in
          </button>
        </div>
        <div className="tabs">
          {[
            [7, "7D"],
            [30, "30D"],
            [90, "3M"],
            [180, "6M"],
            [365, "1Y"],
            [0, "All"],
          ].map(([n, label]) => (
            <button
              key={n}
              className={range === n ? "selected" : ""}
              onClick={() => setRange(Number(n))}
            >
              {label}
            </button>
          ))}
        </div>
        {weights.length > 1 ? (
          <WeightChart data={weights} />
        ) : (
          <Empty
            title="Give your progress a little time"
            text="Log at least two weigh-ins to see your trend. Daily fluctuations are normal."
          />
        )}
      </section>
      <div className="lower-grid">
        <section className="card">
          <div className="card-heading">
            <h2>Your weekly fuel</h2>
            <span className="pill">LAST 7 DAYS</span>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid stroke="#30352e" vertical={false} />
                <XAxis
                  dataKey="day"
                  stroke="#88917f"
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="#88917f"
                  width={45}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#242920",
                    border: "1px solid #404737",
                    borderRadius: 10,
                  }}
                />
                <Bar dataKey="calories" fill="#bdff48" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card">
          <h2>The weekly check-in</h2>
          <dl>
            <dt>Average calories / logged day</dt>
            <dd>{loggedDays ? fmt(total.calories / loggedDays) : "—"} kcal</dd>
            <dt>Average protein / logged day</dt>
            <dd>{loggedDays ? fmt(total.protein / loggedDays) : "—"} g</dd>
            <dt>Days with food logs</dt>
            <dd>{loggedDays} / 7</dd>
            <dt>Workouts completed</dt>
            <dd>{workouts.length}</dd>
            <dt>Steps recorded</dt>
            <dd>
              {fmt(
                data.activity
                  .filter((a) => days.includes(a.date))
                  .reduce((n, a) => n + a.steps, 0),
              )}
            </dd>
          </dl>
          <p className="insight">
            {loggedDays
              ? `You logged food on ${loggedDays} of the last 7 days and completed ${workouts.length} workouts. Keep building the routine that works for you.`
              : "Start logging to build a weekly picture. Missing entries are never treated as zero food intake."}
          </p>
        </section>
      </div>
      <section className="card">
        <div className="card-heading">
          <h2>Earned, not given.</h2>
          <span className="muted">Your achievements</span>
        </div>
        <div className="achievement-grid">
          {achievements(data).map((a) => (
            <div
              className={
                "achievement " + (a.value >= a.target ? "unlocked" : "")
              }
              key={a.title}
            >
              <Trophy size={25} />
              <h3>{a.title}</h3>
              <p>{a.description}</p>
              <Progress value={a.value} max={a.target} />
              <small>
                {a.value >= a.target
                  ? "Unlocked"
                  : `${fmt(a.value)} / ${fmt(a.target)}`}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Personal records</h2>
        {records.length ? (
          records
            .slice()
            .reverse()
            .map((r, i) => (
              <div className="record" key={i}>
                <Trophy size={18} className="lime" />
                <strong>{r.exercise}</strong>
                <span>
                  {r.type} · {r.weight} kg × {r.reps}
                </span>
                <small>{r.date}</small>
              </div>
            ))
        ) : (
          <p className="muted">
            Your first session sets the baseline. Future improvements appear
            here.
          </p>
        )}
      </section>
    </>
  );
}
function WeightDialog({
  date,
  current,
  units,
  onClose,
  onSave,
}: {
  date: string;
  current: number;
  units: string;
  onClose: () => void;
  onSave: (w: WeightEntry) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="A moment to check in" onClose={onClose}>
      <p className="muted">
        A single number is just a snapshot. Your trend is what matters.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            await onSave({
              id: newId(),
              date: String(f.get("date")),
              weight:
                Number(f.get("weight")) / (units === "imperial" ? 2.20462 : 1),
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Date">
          <input
            name="date"
            type="date"
            max={localDate()}
            defaultValue={date}
            required
          />
        </Field>
        <Field label={"Weight (" + (units === "imperial" ? "lb" : "kg") + ")"}>
          <input
            name="weight"
            type="number"
            step="0.1"
            min={units === "imperial" ? 66.2 : 30}
            max={units === "imperial" ? 771 : 350}
            defaultValue={(
              current * (units === "imperial" ? 2.20462 : 1)
            ).toFixed(1)}
            required
          />
        </Field>
        {error && <p className="error">{error}</p>}
        <button className="button primary full" disabled={busy}>
          Save weigh-in <Check size={17} />
        </button>
      </form>
    </Modal>
  );
}
function ActivityDialog({
  activity,
  onClose,
  onSave,
}: {
  activity: Activity;
  onClose: () => void;
  onSave: (a: Activity) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Your daily activity" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            await onSave({
              date: activity.date,
              steps: Number(f.get("steps")),
              water: Number(f.get("water")),
              activeCalories: Number(f.get("energy")),
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Steps">
          <input
            name="steps"
            type="number"
            min="0"
            max="100000"
            defaultValue={activity.steps}
            required
          />
        </Field>
        <Field label="Water (litres)">
          <input
            name="water"
            type="number"
            min="0"
            max="20"
            step="0.1"
            defaultValue={activity.water}
            required
          />
        </Field>
        <Field
          label="Daily active energy (kcal)"
          hint="Optional total from your wearable, including workouts. This replaces workout estimates to prevent double-counting. Leave 0 to use workout estimates."
        >
          <input
            name="energy"
            type="number"
            min="0"
            max="10000"
            defaultValue={activity.activeCalories}
          />
        </Field>
        {error && <p className="error">{error}</p>}
        <button disabled={busy} className="button primary full">
          Save activity <Check size={17} />
        </button>
      </form>
    </Modal>
  );
}
function DeleteAccount({
  onDelete,
}: {
  onDelete: (password: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button className="text-button danger" onClick={() => setOpen(true)}>
        Delete account & data
      </button>
      {open && (
        <Modal title="Delete your account?" onClose={() => setOpen(false)}>
          <p>
            This permanently deletes your account, sessions and saved fitness
            records. Export anything you want to keep first.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await onDelete(String(f.get("password")));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Field label="Confirm with your password">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            {error && <p className="error">{error}</p>}
            <button className="button danger-button">
              Permanently delete my account
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
