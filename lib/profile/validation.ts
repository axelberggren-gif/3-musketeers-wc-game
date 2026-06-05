// Username rules for the /welcome onboarding screen. Kept in sync with the DB:
// `profiles.username` is citext UNIQUE (case-insensitive) and handle_new_user()
// (migration 0001) only ever produces [a-z0-9_], so we normalise to that charset
// to keep /profile/<username> URLs and the unique key clean.

// Handles that would shadow a top-level route under app/.
const RESERVED = new Set([
  "admin",
  "api",
  "auth",
  "join",
  "leagues",
  "login",
  "match",
  "predict",
  "profile",
  "welcome",
]);

export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateUsername(input: string): UsernameValidation {
  const value = input.trim().toLowerCase();
  if (!value) return { ok: false, error: "Pick a username." };
  if (!/^[a-z0-9_]{3,20}$/.test(value)) {
    return {
      ok: false,
      error: "3–20 characters — lowercase letters, numbers or underscore only.",
    };
  }
  if (RESERVED.has(value)) {
    return { ok: false, error: "That username is reserved — pick another." };
  }
  return { ok: true, value };
}

// Only allow same-origin relative redirect targets (open-redirect guard).
export function sanitizeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/leagues";
  return next;
}
