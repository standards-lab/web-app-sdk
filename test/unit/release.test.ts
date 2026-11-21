// Adapted from spike-html-apps-sdk (df65376): test/unit/release.test.ts, its dependencies checked.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { listFiles, releaseProblems, resolveSelf } from "./release.ts";

const root = join(import.meta.dirname, "../..");
const src = join(root, "src");
const scratches: string[] = [];

const publics = [
  "./api.js",
  "./auth.js",
  "./router.js",
  "./service.js",
  "./events.js",
  "./events/nats.js",
];
const conditions: [string[], string][] = [
  [[], ".js"],
  [["--conditions=types"], ".d.ts"],
];

function scratchDir() {
  const scratch = mkdtempSync(join(tmpdir(), "release-"));
  scratches.push(scratch);
  return scratch;
}

let pack: string;
before(() => {
  const scratch = scratchDir();
  execFileSync("pnpm", ["pack", "--pack-destination", scratch], { cwd: root, stdio: "ignore" });
  const [tarball] = listFiles(scratch);
  execFileSync("tar", ["-xzf", join(scratch, tarball), "-C", scratch]);
  pack = join(scratch, "package");
});
after(() => {
  for (const scratch of scratches) rmSync(scratch, { recursive: true, force: true });
});

interface PackManifest {
  license: string;
  files: string[];
  exports: Record<string, Record<string, string>>;
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
  devDependencies: Record<string, string>;
}

type Change = (dir: string, manifest: PackManifest) => void;

function faulted(change: Change) {
  const copy = join(scratchDir(), "package");
  cpSync(pack, copy, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(copy, "package.json"), "utf8")) as PackManifest;
  change(copy, manifest);
  writeFileSync(join(copy, "package.json"), JSON.stringify(manifest));
  return releaseProblems(copy, src, publics);
}

const remove =
  (path: string): Change =>
  (dir) =>
    rmSync(join(dir, path));

describe("release pack", () => {
  test("the pack is package.json, README.md, LICENSE, and the build", () => {
    const built = listFiles(join(root, "dist")).map((path) => `dist/${path}`);
    assert.ok(built.length > 0, "mise run build wrote no dist/");
    assert.deepEqual(listFiles(pack), [...built, "LICENSE", "README.md", "package.json"].sort());
  });

  test("the pack is the release that files and exports declare", () => {
    assert.deepEqual(releaseProblems(pack, src, publics), []);
  });

  test("the pack keeps the dependencies package.json declares, as written", () => {
    const packed = JSON.parse(readFileSync(join(pack, "package.json"), "utf8"));
    const source = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    for (const field of [
      "dependencies",
      "peerDependencies",
      "peerDependenciesMeta",
      "devDependencies",
    ]) {
      assert.deepEqual(packed[field], source[field], field);
    }
  });

  test("the packed manifest carries no scripts", () => {
    const packed = JSON.parse(readFileSync(join(pack, "package.json"), "utf8"));
    assert.equal(packed.scripts, undefined);
  });

  test("each public subpath resolves through the package's name to its build", () => {
    for (const [flags, extension] of conditions) {
      assert.deepEqual(
        resolveSelf(pack, publics, flags),
        publics.map((subpath) => ({
          path: `dist/${subpath.slice(2, -".js".length)}${extension}`,
        })),
      );
    }
  });

  test("the internal eventstream.js doesn't resolve through the package's name", () => {
    for (const [flags] of conditions) {
      assert.deepEqual(resolveSelf(pack, ["./eventstream.js"], flags), [
        { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
      ]);
    }
  });

  const natsCore = "@nats-io/nats-core";
  const jetstream = "@nats-io/jetstream";
  const tooling = "@standards-lab/web-tooling";
  const toolingRepo = "github:standards-lab/web-tooling";
  const faults: Record<string, [Change, string]> = {
    "a .ts module with no emitted .js": [
      remove("dist/auth.js"),
      "src/auth.ts has no built dist/auth.js",
    ],
    "a .ts module with no emitted .d.ts": [
      remove("dist/service.d.ts"),
      "src/service.ts has no built dist/service.d.ts",
    ],
    "a stray built file": [
      (dir) => writeFileSync(join(dir, "dist/old.js"), ""),
      "dist/old.js is built from no source",
    ],
    "a stray file in the pack": [
      (dir) => writeFileSync(join(dir, "notes.md"), ""),
      "notes.md is packed but isn't the build, LICENSE, README.md, package.json",
    ],
    "a pack without its README": [remove("README.md"), "the pack has no README.md"],
    "an export at a missing file": [
      (_, copy) =>
        (copy.exports["./gone.js"] = { types: "./dist/gone.d.ts", default: "./dist/gone.js" }),
      'exports["./gone.js"] resolves to ./dist/gone.js, which isn\'t built',
    ],
    "a types target outside dist/": [
      (_, copy) => (copy.exports["./api.js"] = { types: "./src/api.ts", default: "./dist/api.js" }),
      'exports["./api.js"] resolves to ./src/api.ts, which isn\'t built',
    ],
    "a public subpath whose types target isn't built": [
      (_, copy) => (copy.exports["./service.js"].types = "./dist/service.ts"),
      'exports["./service.js"] resolves to ./dist/service.ts, which isn\'t built',
    ],
    "a built file no export reaches": [
      (_, copy) => (copy.exports["./auth.js"] = { types: "./dist/auth.d.ts" }),
      "dist/auth.js is reachable through no export",
    ],
    "an export with only a types condition": [
      (_, copy) => (copy.exports["./auth.js"] = { types: "./dist/auth.d.ts" }),
      'exports["./auth.js"] isn\'t a types and a default condition',
    ],
    "an export with a third condition": [
      (_, copy) =>
        (copy.exports["./api.js"] = { import: "./dist/api.js", ...copy.exports["./api.js"] }),
      'exports["./api.js"] isn\'t a types and a default condition',
    ],
    "a public subpath missing from exports": [
      (_, copy) => delete copy.exports["./events/nats.js"],
      'exports has no "./events/nats.js"',
    ],
    "a pattern export, which reaches the internal module": [
      (_, copy) => (copy.exports["./*.js"] = { types: "./dist/*.d.ts", default: "./dist/*.js" }),
      "./eventstream.js is internal, but resolves through the package's name",
    ],
    "an export of the internal module": [
      (_, copy) =>
        (copy.exports["./eventstream.js"] = {
          types: "./dist/eventstream.d.ts",
          default: "./dist/eventstream.js",
        }),
      'exports["./eventstream.js"] isn\'t a public subpath',
    ],
    "a pattern export that reaches nothing": [
      (_, copy) =>
        (copy.exports["./apps/*.js"] = {
          types: "./dist/apps/*.d.ts",
          default: "./dist/apps/*.js",
        }),
      'exports["./apps/*.js"] reaches no built file',
    ],
    "a pack without its LICENSE": [remove("LICENSE"), "LICENSE is missing"],
    "a LICENSE that isn't Apache 2.0": [
      (dir) => writeFileSync(join(dir, "LICENSE"), "All rights reserved.\n"),
      "LICENSE isn't the Apache License 2.0",
    ],
    "a package that declares another license": [
      (_, copy) => (copy.license = "MIT"),
      "package.json declares license MIT, not Apache-2.0",
    ],
    "a build outside files": [
      (_, copy) => (copy.files = ["dist/api.js"]),
      "dist/service.js isn't under package.json's files",
    ],
    "a runtime dependency": [
      (_, copy) => (copy.dependencies = { lit: "3.3.3" }),
      "package.json declares lit in dependencies, but a release has none",
    ],
    "a NATS package in dependencies": [
      (_, copy) => (copy.dependencies = { [natsCore]: "3.5.0" }),
      `package.json declares ${natsCore} in dependencies, but a release has none`,
    ],
    "an extra peer": [
      (_, copy) => (copy.peerDependencies["@nats-io/kv"] = "^3.5.0"),
      "package.json declares peer @nats-io/kv, which no release needs",
    ],
    "a sibling layer as a peer": [
      (_, copy) => (copy.peerDependencies["@standards-lab/web-foundation"] = "^0.3.0"),
      "package.json declares peer @standards-lab/web-foundation, which no release needs",
    ],
    "a NATS package missing from the peers": [
      (_, copy) => delete copy.peerDependencies[jetstream],
      `package.json doesn't declare peer ${jetstream}`,
    ],
    "a peer by an exact version": [
      (_, copy) => (copy.peerDependencies[natsCore] = "3.5.0"),
      `package.json declares peer ${natsCore} 3.5.0, not a caret range`,
    ],
    "a peer by a tilde range": [
      (_, copy) => (copy.peerDependencies[natsCore] = "~3.5.0"),
      `package.json declares peer ${natsCore} ~3.5.0, not a caret range`,
    ],
    "a peer by any version": [
      (_, copy) => (copy.peerDependencies[jetstream] = "*"),
      `package.json declares peer ${jetstream} *, not a caret range`,
    ],
    "a peer that isn't optional": [
      (_, copy) => (copy.peerDependenciesMeta[jetstream] = { optional: false }),
      `package.json's peer ${jetstream} isn't optional`,
    ],
    "a peer with no meta": [
      (_, copy) => delete copy.peerDependenciesMeta[natsCore],
      `package.json's peer ${natsCore} isn't optional`,
    ],
    "a meta entry for no peer": [
      (_, copy) => (copy.peerDependenciesMeta["@nats-io/kv"] = { optional: true }),
      "peerDependenciesMeta names @nats-io/kv, which isn't a peer",
    ],
    "a NATS package with no devDependency": [
      (_, copy) => delete copy.devDependencies[natsCore],
      `package.json doesn't declare devDependency ${natsCore}`,
    ],
    "a NATS devDependency by a range": [
      (_, copy) => (copy.devDependencies[jetstream] = "^3.5.0"),
      `package.json declares devDependency ${jetstream} ^3.5.0, not an exact pin`,
    ],
    "a NATS devDependency outside its peer range": [
      (_, copy) => (copy.devDependencies[natsCore] = "4.0.0"),
      `package.json's devDependency ${natsCore} 4.0.0 is outside its peer range ^3.5.0`,
    ],
    "a NATS devDependency below its peer range": [
      (_, copy) => (copy.devDependencies[jetstream] = "3.4.0"),
      `package.json's devDependency ${jetstream} 3.4.0 is outside its peer range ^3.5.0`,
    ],
    "no tooling devDependency": [
      (_, copy) => delete copy.devDependencies[tooling],
      `package.json doesn't declare devDependency ${tooling}`,
    ],
    "the tooling by a #semver: spec": [
      (_, copy) => (copy.devDependencies[tooling] = `${toolingRepo}#semver:^0.1.0`),
      `package.json declares devDependency ${tooling} ${toolingRepo}#semver:^0.1.0, not an exact release tag`,
    ],
    "the tooling by a branch": [
      (_, copy) => (copy.devDependencies[tooling] = `${toolingRepo}#main`),
      `package.json declares devDependency ${tooling} ${toolingRepo}#main, not an exact release tag`,
    ],
    "the tooling by a commit": [
      (_, copy) => (copy.devDependencies[tooling] = `${toolingRepo}#29d16c0`),
      `package.json declares devDependency ${tooling} ${toolingRepo}#29d16c0, not an exact release tag`,
    ],
    "the tooling by no ref": [
      (_, copy) => (copy.devDependencies[tooling] = toolingRepo),
      `package.json declares devDependency ${tooling} ${toolingRepo}, not an exact release tag`,
    ],
    "the tooling from the registry": [
      (_, copy) => (copy.devDependencies[tooling] = "0.1.0"),
      `package.json declares devDependency ${tooling} 0.1.0, not an exact release tag`,
    ],
    "the tooling from a fork": [
      (_, copy) => (copy.devDependencies[tooling] = "github:fork/web-tooling#v0.1.0"),
      `package.json declares devDependency ${tooling} github:fork/web-tooling#v0.1.0, not an exact release tag`,
    ],
  };
  for (const [fault, [change, problem]] of Object.entries(faults)) {
    test(`fails on ${fault}`, () => {
      const problems = faulted(change);
      assert.ok(problems.includes(problem), `expected: ${problem}\ngot: ${problems.join("\n")}`);
    });
  }
});
