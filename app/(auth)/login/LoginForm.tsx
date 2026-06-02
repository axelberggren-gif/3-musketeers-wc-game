"use client";

import { useState } from "react";
import { signInWithEmail } from "@/lib/auth/signIn";

export function LoginForm({
  inviteToken,
}: {
  inviteToken?: string;
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
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col gap-3">
        <span
          className="badge badge-pitch self-start"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          ✓ Magic link sent
        </span>
        <p className="text-sm text-ink-soft">
          We sent a link to{" "}
          <span className="font-mono-sticker text-ink">{email}</span>. Click it from your inbox
          to finish signing in.
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
      {error && <p className="text-sm text-red font-medium">{error}</p>}
      <button type="submit" disabled={status === "sending"} className="btn btn-primary mt-1">
        {status === "sending" ? "Sending…" : "Send magic link"}
      </button>
      {!inviteToken && (
        <p className="text-xs text-ink-soft mt-1">
          Don&rsquo;t have an account? Ask a league owner for an invite link.
        </p>
      )}
    </form>
  );
}
