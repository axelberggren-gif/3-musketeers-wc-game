import { beforeEach, describe, expect, it, vi } from "vitest";

// signIn.ts calls supabaseServer().auth.{signInWithOtp,verifyOtp}. Mock the
// client so these server actions can be exercised without a live Supabase —
// the validation guards and redirect logic are pure and worth covering.
const { signInWithOtp, verifyOtp, supabaseServer } = vi.hoisted(() => {
  const signInWithOtp = vi.fn();
  const verifyOtp = vi.fn();
  return {
    signInWithOtp,
    verifyOtp,
    supabaseServer: vi.fn(async () => ({ auth: { signInWithOtp, verifyOtp } })),
  };
});

vi.mock("@/lib/supabase/server", () => ({ supabaseServer }));

import { signInWithEmail, verifyEmailOtp } from "./signIn";

beforeEach(() => {
  vi.clearAllMocks();
  signInWithOtp.mockResolvedValue({ error: null });
  verifyOtp.mockResolvedValue({ error: null });
});

describe("verifyEmailOtp", () => {
  it("rejects an empty email before touching Supabase", async () => {
    expect(await verifyEmailOtp("", "123456")).toEqual({
      ok: false,
      error: "Email is required",
    });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a blank code before touching Supabase", async () => {
    expect(await verifyEmailOtp("a@b.com", "   ")).toEqual({
      ok: false,
      error: "Enter the code from your email",
    });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("verifies with type 'email', lower-casing the email and trimming the code", async () => {
    await verifyEmailOtp("  USER@Example.COM ", " 123456 ");
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "user@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("surfaces the Supabase error message on failure", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    expect(await verifyEmailOtp("a@b.com", "000000")).toEqual({
      ok: false,
      error: "Token has expired or is invalid",
    });
  });

  it("redirects to /leagues when there is no invite token", async () => {
    expect(await verifyEmailOtp("a@b.com", "123456")).toEqual({
      ok: true,
      redirectTo: "/leagues",
    });
  });

  it("bounces through /join/[token] when an invite token is present", async () => {
    expect(await verifyEmailOtp("a@b.com", "123456", "abc-123")).toEqual({
      ok: true,
      redirectTo: "/join/abc-123",
    });
  });
});

describe("signInWithEmail", () => {
  it("rejects an empty email before touching Supabase", async () => {
    expect(await signInWithEmail("   ")).toEqual({ ok: false, error: "Email is required" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends the OTP and reports code_sent", async () => {
    expect(await signInWithEmail("a@b.com")).toEqual({ ok: true, mode: "code_sent" });
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it("only allows user creation when an invite token is supplied", async () => {
    await signInWithEmail("a@b.com");
    expect(signInWithOtp.mock.calls.at(-1)?.[0].options.shouldCreateUser).toBe(false);

    await signInWithEmail("a@b.com", "tok");
    expect(signInWithOtp.mock.calls.at(-1)?.[0].options.shouldCreateUser).toBe(true);
  });

  it("threads the invite token through emailRedirectTo", async () => {
    await signInWithEmail("a@b.com", "tok-123");
    const redirectTo: string = signInWithOtp.mock.calls.at(-1)?.[0].options.emailRedirectTo;
    expect(redirectTo).toContain("/auth/callback");
    expect(redirectTo).toContain("invite=tok-123");
  });

  it("surfaces the Supabase error message on failure", async () => {
    signInWithOtp.mockResolvedValue({ error: { message: "rate limit exceeded" } });
    expect(await signInWithEmail("a@b.com")).toEqual({ ok: false, error: "rate limit exceeded" });
  });
});
