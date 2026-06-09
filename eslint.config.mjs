import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  // Core correctness rules (no-unreachable, no-dupe-keys, no-fallthrough, …).
  // eslint-config-next alone leaves every eslint:recommended rule off — an
  // unreachable-implementation bug behind a leftover `throw` shipped through
  // lint because of that gap. nextTs (below) layers the standard TypeScript
  // adjustments on top: no-undef and core no-unused-vars are switched off for
  // TS files (the compiler / @typescript-eslint/no-unused-vars own those).
  // @eslint/js is a direct dependency of eslint 9 itself.
  js.configs.recommended,
  ...nextVitals,
  ...nextTs,
  {
    // typescript-eslint's eslint-recommended overlay (pulled in by nextTs)
    // turns no-unreachable off for TS files, assuming tsc reports ts(7027) —
    // but that's only an error under `allowUnreachableCode: false`, which this
    // repo's tsconfig doesn't set. Re-enable: it's the tripwire for leftover
    // scaffolding (real code stranded after a debug `throw`/`return`).
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: {
      "no-unreachable": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
