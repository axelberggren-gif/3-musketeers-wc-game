"use client";

import { useState } from "react";
import { signInWithEmail, verifyEmailOtp } from "@/lib/auth/signIn";

export function LoginForm({
  inviteToken,
}: {
  inviteToken?: string;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"email" | "code">("email");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await signInWithEmail(email, inviteToken);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCode("");
    setPhase("code");
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await verifyEmailOtp(email, code, inviteToken);
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    // Full navigation so the session cookies just set by the server action are
    // sent on the next request (the auth gate in (app)/layout.tsx reads them).
    window.location.assign(result.redirectTo);
  }

  if (phase === "code") {
    return (
      <form onSubmit={handleVerify} className="flex flex-col gap-3">
        <span
          className="badge badge-pitch self-start"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          ✓ Code sent
        </span>
        <p className="text-sm text-ink-soft">
          We emailed a code to{" "}
          <span className="font-mono-sticker text-ink">{email}</span>. Type it in below to finish
          signing in — or click the link in the same email.
        </p>
        <label htmlFor="code" className="label">
          Login code
        </label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={10}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="input font-mono-sticker text-lg tracking-[0.4em]"
          placeholder="123456"
        />
        {error && <p className="text-sm text-red font-medium">{error}</p>}
        <button type="submit" disabled={pending || !code} className="btn btn-primary mt-1">
          {pending ? "Verifying…" : "Verify & sign in"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPhase("email");
            setCode("");
            setError(null);
          }}
          className="btn btn-ghost self-start"
        >
          ← Use a different email
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSendCode} className="flex flex-col gap-3">
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
      <button type="submit" disabled={pending} className="btn btn-primary mt-1">
        {pending ? "Sending…" : "Email me a code"}
      </button>
      {!inviteToken && (
        <p className="text-xs text-ink-soft mt-1">
          Don&rsquo;t have an account? Ask a league owner for an invite link.
        </p>
      )}
    </form>
  );
}
