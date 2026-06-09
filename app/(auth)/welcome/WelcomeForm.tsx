"use client";

import { useState, useTransition } from "react";
import { completeOnboarding } from "@/lib/profile/actions";

export function WelcomeForm({
  next,
  defaultUsername,
}: {
  next: string;
  defaultUsername: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Controlled so the charset is enforced live (server validation is the source
  // of truth; this is just nicer UX).
  const [username, setUsername] = useState(defaultUsername);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await completeOnboarding(null, formData);
        if (result?.error) {
          setError(result.error);
        }
        // On success the server action calls redirect() and never returns —
        // no client-side navigation needed.
      } catch {
        // Network blip mid-server-action (Chrome surfaces this as
        // "TypeError: Failed to fetch", Safari as "Load failed"). Surface a
        // retry-friendly message instead of letting the uncaught rejection
        // bubble to Sentry's window.unhandledrejection auto-capture.
        setError("Couldn’t reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="username" className="label">
        Username
      </label>
      <input
        id="username"
        name="username"
        required
        autoFocus
        autoComplete="username"
        maxLength={20}
        value={username}
        onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
        className="input font-mono-sticker text-lg"
        placeholder="yourname"
      />
      {error && <p className="text-sm text-red font-medium">{error}</p>}
      <button
        type="submit"
        disabled={pending || username.length < 3}
        className="btn btn-primary mt-1"
      >
        {pending ? "Saving…" : "Enter the league"}
      </button>
    </form>
  );
}
