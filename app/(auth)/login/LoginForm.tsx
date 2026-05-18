"use client";

import { useState } from "react";
import { signInWithEmail } from "@/lib/auth/signIn";

export function LoginForm({
  inviteToken,
  devInstant,
}: {
  inviteToken?: string;
  devInstant?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const result = await signInWithEmail(email, inviteToken);
    if (!result.ok) {
      setError(result.error);
      setStatus("error");
      return;
    }
    if (result.mode === "instant") {
      window.location.href = result.url;
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[var(--accent)] font-medium">Check your inbox.</p>
        <p className="text-sm text-[var(--muted)]">
          We sent a magic link to <span className="font-mono">{email}</span>. Click it to sign in.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="email" className="label">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="input"
        placeholder="you@example.com"
      />
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <button type="submit" disabled={status === "sending"} className="btn btn-primary mt-2">
        {status === "sending"
          ? devInstant
            ? "Signing in…"
            : "Sending…"
          : devInstant
            ? "Sign in (dev — no email)"
            : "Send magic link"}
      </button>
      {devInstant && (
        <p className="text-xs text-[var(--accent)] mt-1">
          Dev mode: email must already exist in Supabase. No magic link is sent.
        </p>
      )}
      {!inviteToken && !devInstant && (
        <p className="text-xs text-[var(--muted)] mt-2">
          Don&rsquo;t have an account? You&rsquo;ll need an invite link from a league owner.
        </p>
      )}
    </form>
  );
}
