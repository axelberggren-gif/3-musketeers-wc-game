"use client";

import { useActionState, useState } from "react";
import { completeOnboarding, type OnboardingState } from "@/lib/profile/actions";

export function WelcomeForm({
  next,
  defaultUsername,
}: {
  next: string;
  defaultUsername: string;
}) {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(
    completeOnboarding,
    null,
  );
  // Controlled so the charset is enforced live (server validation is the source
  // of truth; this is just nicer UX).
  const [username, setUsername] = useState(defaultUsername);

  return (
    <form action={formAction} className="flex flex-col gap-3">
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
      {state?.error && <p className="text-sm text-red font-medium">{state.error}</p>}
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
