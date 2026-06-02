"use client";

import { useState } from "react";
import { signInWithEmail, verifyEmailCode } from "@/lib/auth/signIn";

export function LoginForm({
  inviteToken,
}: {
  inviteToken?: string;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signInWithEmail(email, inviteToken);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStep("code");
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await verifyEmailCode(email, code, inviteToken);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    // Hard navigation so the freshly-set session cookies are picked up.
    window.location.href = result.redirectTo;
  }

  if (step === "code") {
    return (
      <form onSubmit={handleVerify} className="flex flex-col gap-3">
        <span
          className="badge badge-pitch self-start"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          ✓ Code sent
        </span>
        <p className="text-sm text-ink-soft">
          We emailed a 6-digit code to{" "}
          <span className="font-mono-sticker text-ink">{email}</span>. Enter it below — it
          expires shortly.
        </p>
        <label htmlFor="code" className="label">
          Sign-in code
        </label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="input text-center text-lg tracking-[0.4em] font-mono-sticker"
          placeholder="••••••"
        />
        {error && <p className="text-sm text-red font-medium">{error}</p>}
        <button
          type="submit"
          disabled={busy || code.length < 6}
          className="btn btn-primary mt-1"
        >
          {busy ? "Verifying…" : "Verify & sign in"}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
          }}
          className="text-xs text-ink-soft underline self-start"
        >
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSend} className="flex flex-col gap-3">
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
      <button type="submit" disabled={busy} className="btn btn-primary mt-1">
        {busy ? "Sending…" : "Email me a code"}
      </button>
      {!inviteToken && (
        <p className="text-xs text-ink-soft mt-1">
          Don&rsquo;t have an account? Ask a league owner for an invite link.
        </p>
      )}
    </form>
  );
}
