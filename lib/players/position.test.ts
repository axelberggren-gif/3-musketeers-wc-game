import { describe, expect, it } from "vitest";
import { normalizePosition, POSITION_FILTERS, type PositionGroup } from "./position";

describe("normalizePosition", () => {
  it("maps the coarse football-data labels", () => {
    expect(normalizePosition("Goalkeeper")).toBe("GK");
    expect(normalizePosition("Defence")).toBe("DEF");
    expect(normalizePosition("Midfield")).toBe("MID");
    expect(normalizePosition("Offence")).toBe("ATT");
  });

  it("maps granular labels", () => {
    expect(normalizePosition("Centre-Back")).toBe("DEF");
    expect(normalizePosition("Left-Back")).toBe("DEF");
    expect(normalizePosition("Right Winger")).toBe("ATT");
    expect(normalizePosition("Centre-Forward")).toBe("ATT");
    expect(normalizePosition("Second Striker")).toBe("ATT");
    expect(normalizePosition("Attacking Midfield")).toBe("MID");
  });

  it("resolves ambiguous compounds by match order", () => {
    // Wing-Back is a defender, not a winger ("back" wins over "wing").
    expect(normalizePosition("Wing-Back")).toBe("DEF");
    // Defensive Midfield is a midfielder, not a defender ("midfield" wins over "defen").
    expect(normalizePosition("Defensive Midfield")).toBe("MID");
  });

  it("is case-insensitive", () => {
    expect(normalizePosition("goalkeeper")).toBe("GK");
    expect(normalizePosition("MIDFIELD")).toBe("MID");
  });

  it("returns null for unknown / empty input", () => {
    expect(normalizePosition(null)).toBeNull();
    expect(normalizePosition(undefined)).toBeNull();
    expect(normalizePosition("")).toBeNull();
    expect(normalizePosition("Manager")).toBeNull();
  });

  it("exposes the four filter buckets in display order", () => {
    expect(POSITION_FILTERS.map((f) => f.key)).toEqual<PositionGroup[]>(["DEF", "MID", "ATT", "GK"]);
  });
});
