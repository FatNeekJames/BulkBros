/** Classify provider failures without exposing provider response bodies to clients. */
export function classifyAiError(
  error: unknown,
): { status: number; code: string; message: string } | null {
  if (!error || typeof error !== "object") return null;
  const e = error as {
    status?: unknown;
    code?: unknown;
    error?: { code?: unknown };
  };
  const code = typeof e.code === "string" ? e.code : e.error?.code;
  if (
    e.status === 429 &&
    (code === "credit_balance_exhausted" || code === "insufficient_quota")
  ) {
    return {
      status: 503,
      code: "AI_CREDITS_EXHAUSTED",
      message:
        "AI features are unavailable because the connected OpenAI API project has no credit. Food logging and training tracking still work.",
    };
  }
  if (e.status === 429)
    return {
      status: 429,
      code: "AI_RATE_LIMIT",
      message: "Too many AI requests right now. Please try again shortly.",
    };
  if (e.status === 401 || e.status === 403)
    return {
      status: 503,
      code: "AI_KEY_UNAVAILABLE",
      message:
        "AI features are unavailable because the server API key was rejected. Other tracking features still work.",
    };
  return null;
}
