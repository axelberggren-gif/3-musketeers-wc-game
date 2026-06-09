import { describe, expect, it } from "vitest";
import { deriveBracketSlot, isTransientFetchError, mapStage, mapStatus, mapWinner } from "./client";

describe("deriveBracketSlot", () => {
  it("labels R32 slots 1..16 by index", () => {
    expect(deriveBracketSlot("R32", 0)).toBe("R32-1");
    expect(deriveBracketSlot("R32", 15)).toBe("R32-16");
  });
  it("labels R16 slots 1..8 by index", () => {
    expect(deriveBracketSlot("R16", 0)).toBe("R16-1");
    expect(deriveBracketSlot("R16", 7)).toBe("R16-8");
  });
  it("labels QF slots A..D and SF slots A..B", () => {
    expect(deriveBracketSlot("QF", 0)).toBe("QF-A");
    expect(deriveBracketSlot("QF", 3)).toBe("QF-D");
    expect(deriveBracketSlot("SF", 0)).toBe("SF-A");
    expect(deriveBracketSlot("SF", 1)).toBe("SF-B");
  });
  it("uses bare 'F' and '3RD' for those stages", () => {
    expect(deriveBracketSlot("F", 0)).toBe("F");
    expect(deriveBracketSlot("3RD", 0)).toBe("3RD");
  });
  it("returns null for group-stage matches", () => {
    expect(deriveBracketSlot("GROUP", 0)).toBeNull();
  });
});

describe("mapStage", () => {
  it("translates football-data stage enum", () => {
    expect(mapStage("GROUP_STAGE")).toBe("GROUP");
    expect(mapStage("LAST_32")).toBe("R32");
    expect(mapStage("LAST_16")).toBe("R16");
    expect(mapStage("QUARTER_FINALS")).toBe("QF");
    expect(mapStage("SEMI_FINALS")).toBe("SF");
    expect(mapStage("THIRD_PLACE")).toBe("3RD");
    expect(mapStage("FINAL")).toBe("F");
  });
});

describe("mapWinner", () => {
  it("collapses HOME_TEAM / AWAY_TEAM / DRAW", () => {
    expect(mapWinner("HOME_TEAM")).toBe("HOME");
    expect(mapWinner("AWAY_TEAM")).toBe("AWAY");
    expect(mapWinner("DRAW")).toBe("DRAW");
    expect(mapWinner(null)).toBeNull();
  });
});

describe("isTransientFetchError", () => {
  // The error-name strings here are load-bearing: req()'s retry loop only
  // loops when this returns true, so a wrong name string = no retries in prod.

  describe("transient (retryable) cases", () => {
    it("treats Node undici's bare 'TypeError: fetch failed' as transient", () => {
      // This is exactly what undici throws for DNS / TCP reset / TLS / socket
      // hang up — the original Sentry JAVASCRIPT-NEXTJS-7 signature.
      const err = new TypeError("fetch failed");
      expect(err.name).toBe("TypeError"); // guard against a future name change
      expect(isTransientFetchError(err)).toBe(true);
    });

    it("treats AbortSignal.timeout()'s TimeoutError (by name) as transient", () => {
      // AbortSignal.timeout() rejects with a DOMException named "TimeoutError".
      // Match by name regardless of message.
      expect(isTransientFetchError({ name: "TimeoutError", message: "The operation timed out." })).toBe(true);
      expect(isTransientFetchError({ name: "TimeoutError" })).toBe(true);
    });

    it("treats AbortError (by name) as transient", () => {
      expect(isTransientFetchError({ name: "AbortError", message: "This operation was aborted" })).toBe(true);
      expect(isTransientFetchError({ name: "AbortError" })).toBe(true);
    });

    it("matches a real DOMException-shaped TimeoutError instance", () => {
      // DOMException exists in the Node test runtime; verify the real shape.
      const err = new DOMException("timed out", "TimeoutError");
      expect(err.name).toBe("TimeoutError");
      expect(isTransientFetchError(err)).toBe(true);
    });
  });

  describe("fail-fast (non-retryable) cases", () => {
    it("does NOT retry a 4xx-derived error thrown from the non-ok branch", () => {
      // req() throws `new Error("football-data 404 ...")` for 4xx — a generic
      // Error with the default name "Error", which must fail fast.
      const err = new Error("football-data 404 /competitions/WC/teams: Not Found");
      expect(isTransientFetchError(err)).toBe(false);
    });

    it("does NOT retry a final 5xx-derived error (plain Error)", () => {
      // The 5xx retry is handled inline in req() via `continue`; by the time
      // such an error is thrown it's final and must not loop again here.
      const err = new Error("football-data 503 /matches/1: Service Unavailable");
      expect(isTransientFetchError(err)).toBe(false);
    });

    it("does NOT retry a generic Error", () => {
      expect(isTransientFetchError(new Error("boom"))).toBe(false);
    });

    it("does NOT retry a TypeError whose message is NOT 'fetch failed'", () => {
      // Only the exact "fetch failed" message is the undici network signature;
      // other TypeErrors are programmer errors and must fail fast.
      expect(isTransientFetchError(new TypeError("Cannot read properties of undefined"))).toBe(false);
      expect(isTransientFetchError({ name: "TypeError", message: "fetch FAILED" })).toBe(false);
    });

    it("does NOT match a typo'd / unknown error name", () => {
      expect(isTransientFetchError({ name: "Timeout", message: "x" })).toBe(false);
      expect(isTransientFetchError({ name: "NetworkError", message: "x" })).toBe(false);
    });

    it("returns false for non-object / nullish inputs", () => {
      expect(isTransientFetchError(null)).toBe(false);
      expect(isTransientFetchError(undefined)).toBe(false);
      expect(isTransientFetchError("fetch failed")).toBe(false);
      expect(isTransientFetchError(42)).toBe(false);
      expect(isTransientFetchError(true)).toBe(false);
    });

    it("returns false for an object with no name/message", () => {
      expect(isTransientFetchError({})).toBe(false);
    });
  });
});

describe("mapStatus", () => {
  it("collapses in-play states to LIVE and cancelled-likes to POSTPONED", () => {
    expect(mapStatus("IN_PLAY")).toBe("LIVE");
    expect(mapStatus("PAUSED")).toBe("LIVE");
    expect(mapStatus("FINISHED")).toBe("FINISHED");
    expect(mapStatus("POSTPONED")).toBe("POSTPONED");
    expect(mapStatus("SUSPENDED")).toBe("POSTPONED");
    expect(mapStatus("CANCELLED")).toBe("POSTPONED");
    expect(mapStatus("SCHEDULED")).toBe("SCHEDULED");
    expect(mapStatus("TIMED")).toBe("SCHEDULED");
  });
});
