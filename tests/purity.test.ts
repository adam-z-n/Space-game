import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardrails for determinism: rules code must not read the clock, use
 * Math.random, or use trig/exp functions whose results can differ between
 * JS engines. (tsconfig.core.json separately blocks DOM and Node APIs.)
 */
const FORBIDDEN = [
  /Math\.random/,
  /Date\.now|new Date/,
  /performance\.now/,
  /Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|log|pow|cbrt|hypot)\b/,
];

const dirs = ["src/core", "src/content"];

describe("simulation core purity", () => {
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      it(`${dir}/${file} avoids nondeterministic APIs`, () => {
        // Strip comments so documentation can mention the forbidden APIs.
        const source = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
        for (const pattern of FORBIDDEN) expect(source, `${pattern}`).not.toMatch(pattern);
      });
    }
  }
});
