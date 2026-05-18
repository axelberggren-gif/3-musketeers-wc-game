"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function LoginForm({ inviteToken }: { inviteToken?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const supabase = supabaseBrowser();
    const redirectTo = new URL(
      "/auth/callback",
      process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin,
    );
    if (inviteToken) redirectTo.searchParams.set("invite", inviteToken);
    const { error: e1 } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo.toString(),
        shouldCreateUser: !!inviteToken,
      },
    });
    if (e1) {
      setError(e1.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
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
        {status === "sending" ? "Sending…" : "Send magic link"}
      </button>
      {!inviteToken && (
        <p className="text-xs text-[var(--muted)] mt-2">
          Don&rsquo;t have an account? You&rsquo;ll need an invite link from a league owner.
        </p>
      )}
    </form>
  );
}
