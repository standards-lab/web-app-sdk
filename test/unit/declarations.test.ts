// tsc, under tsconfig.json, refusing runtime code in a declaration file and checking its types,
// run against scratch trees.
// Adapted from spike-html-apps-sdk (df65376): test/unit/declarations.test.ts, without its
// comparison of the build's declarations against the spike's v0.1.0 fixtures.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

const root = join(import.meta.dirname, "../..");
// The check's own tsc, mise.toml's TypeScript-Go pin, not the typescript package in node_modules.
const tsc = "tsc";

/** Each "path code" tsc reports, sorted, for `files` (paths under layers/ to sources) in scratch. */
function check(files: Record<string, string>): string[] {
  const scratch = mkdtempSync(join(tmpdir(), "declarations-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(join(scratch, "layers", path, ".."), { recursive: true });
      writeFileSync(join(scratch, "layers", path), `${source}\n`);
    }
    writeFileSync(
      join(scratch, "tsconfig.json"),
      JSON.stringify({ extends: join(root, "tsconfig.json"), include: ["layers"] }),
    );
    const run = spawnSync(tsc, ["--noEmit", "-p", "."], { cwd: scratch, encoding: "utf8" });
    assert.equal(run.error, undefined, `tsc didn't run: ${run.error}`);
    const errors = [...run.stdout.matchAll(/^layers\/(\S+)\(\d+,\d+\): error (TS\d+)/gm)];
    // An error outside the scratch layers/ (a config tsc can't read, say) would leave the list
    // empty and pass the cases that expect none, so every error tsc reports must be one of these.
    assert.equal(run.stdout.match(/error TS\d+/g)?.length ?? 0, errors.length, run.stdout);
    return errors.map(([, path, code]) => `${path} ${code}`).sort();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const runtime = {
  "statement.d.ts": `export interface A {}\nconsole.log("runs");`,
  "body.d.ts": `export declare function f(): number;\nexport function g(): number { return 1; }`,
  "binding.d.ts": `let count = 0;`,
  "method.d.ts": `export declare class C { m(): void { } }`,
  "auth.d.ts": `export interface TokenProvider {}\nexport const anonymous: TokenProvider = {};`,
};

// skipLibCheck off is the guard: with it on, tsc skips every .d.ts, and these errors with them.
describe("SDK declarations", () => {
  test("tsc, under tsconfig.json, refuses runtime code in a declaration file", () => {
    assert.deepEqual(check(runtime), [
      "auth.d.ts TS1039",
      "binding.d.ts TS1039",
      "binding.d.ts TS1046",
      "body.d.ts TS1183",
      "method.d.ts TS1183",
      "statement.d.ts TS1036",
    ]);
  });

  test("tsc, under tsconfig.json, checks a declaration file's types", () => {
    assert.deepEqual(check({ "types.d.ts": `export type A = Missing;` }), ["types.d.ts TS2304"]);
  });

  test("tsc accepts declarations alone", () => {
    assert.deepEqual(
      check({
        "ok.d.ts": [
          `export interface A { token(): Promise<string | undefined> }`,
          `export type B<T> = { ok: true; data: T } | { ok: false };`,
          `export declare const a: A;`,
          `export declare function f(x: number): string;`,
        ].join("\n"),
      }),
      [],
    );
  });
});
