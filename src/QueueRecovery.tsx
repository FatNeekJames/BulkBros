import type { Pending } from "./api";

function describeChange(item: Pending) {
  const body = item.body as Record<string, unknown> | undefined;
  if (item.path.startsWith("/logs?")) {
    const params = new URLSearchParams(item.path.split("?")[1]);
    return `Delete ${params.get("meal")} · ${params.get("date")}`;
  }
  if (item.path === "/logs" && Array.isArray(item.body)) {
    const names = item.body
      .map((food: { name: string }) => food.name)
      .join(", ");
    return `Log ${names} · ${item.body[0]?.date}`;
  }
  if (item.path.startsWith("/logs/"))
    return body
      ? `Edit ${body.name} · ${body.meal} · ${body.date}`
      : "Delete food entry";
  if (item.path === "/profile") return "Update profile and daily targets";
  if (item.path === "/weights") return `Weigh-in · ${body?.date}`;
  if (item.path === "/activity") return `Daily activity · ${body?.date}`;
  if (item.path === "/workouts") return `Workout · ${body?.date}`;
  return "Saved change";
}

export function QueueRecovery({
  items,
  busy,
  onRetry,
  onDiscard,
}: {
  items: Pending[];
  busy: boolean;
  onRetry: (id?: string) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
}) {
  if (!items.length) return null;
  const conflicts = items.filter((item) => item.conflict).length;
  return (
    <section className="queue-recovery info" aria-label="Offline changes">
      <div className="queue-heading">
        <div>
          <strong>{items.length} entries waiting to sync.</strong>
          <p>
            {conflicts
              ? `${conflicts} ${conflicts === 1 ? "change needs" : "changes need"} attention. Other entries can still save. Resolve or discard each local change below.`
              : "Your changes are saved on this device until they reach your account."}
          </p>
        </div>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => onRetry()}
        >
          {busy ? "Checking…" : "Retry sync"}
        </button>
      </div>
      <details open={conflicts > 0 ? true : undefined}>
        <summary>Review saved changes</summary>
        <ul className="queue-changes">
          {items.map((item) => {
            const description = describeChange(item);
            return (
              <li className="queue-change" key={item.id}>
                <strong>{description}</strong>
                <p>
                  {item.conflict
                    ? `Needs attention: ${item.conflict.message} (${item.conflict.status}). This local change is still saved on this device.`
                    : "Waiting to sync. Changes to the same record wait for earlier changes to be resolved."}
                </p>
                <div className="queue-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    aria-label={`Retry ${description}`}
                    onClick={() => onRetry(item.conflict ? item.id : undefined)}
                  >
                    Retry change
                  </button>
                  <button
                    className="text-button danger"
                    disabled={busy}
                    aria-label={`Discard ${description}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Discard this local change? ${description}. Your account will be reloaded and all other queued changes will be kept.`,
                        )
                      )
                        void onDiscard(item.id);
                    }}
                  >
                    Discard change
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
