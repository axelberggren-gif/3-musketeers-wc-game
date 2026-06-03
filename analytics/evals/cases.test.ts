import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvalCase } from "./validate";

// Validates every committed eval case against the EvalCase schema. New cases
// (hand-finalised from Prompt 02 output) drop into ./cases/*.json and are checked
// automatically — this is the regression suite the correction loop feeds.
const casesDir = join(dirname(fileURLToPath(import.meta.url)), "cases");
const caseFiles = readdirSync(casesDir).filter((f) => f.endsWith(".json"));

describe("eval cases", () => {
  it("has at least one committed case", () => {
    expect(caseFiles.length).toBeGreaterThan(0);
  });

  for (const file of caseFiles) {
    it(`${file} matches the eval-case schema`, () => {
      const parsed: unknown = JSON.parse(readFileSync(join(casesDir, file), "utf8"));
      expect(validateEvalCase(parsed)).toEqual([]);
    });
  }
});
