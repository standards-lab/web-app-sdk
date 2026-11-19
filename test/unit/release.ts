// A release's shape: a pack of the build checked against the sources, package.json's files and
// exports, which Node itself resolves to the public modules alone, the Apache 2.0 LICENSE its
// manifest declares, and its dependencies: none at run time, the NATS adapter's packages optional
// peers, and the tooling a devDependency at its release tag. test/unit/release.test.ts runs it on
// a pnpm pack.
// Adapted from spike-html-apps-sdk (df65376): test/unit/release.ts, with the manifest's
// dependencies checked.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The members of a package.json the checks read; JSON.parse gives them as written, unchecked. An
 * export's entry is a target, a flat object of condition targets, or null; anything else is what
 * releaseProblems reports. */
export interface Manifest {
  name: string;
  license?: string;
  files?: string[];
  exports?: Record<string, string | Record<string, unknown> | null>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
}

/** root's package.json. */
export function readManifest(root: string): Manifest {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Manifest;
}

/** Every file below `dir`, relative to it with / separators, sorted. */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => statSync(join(dir, path)).isFile())
    .map((path) => path.split(sep).join("/"))
    .sort();
}

/** A key's or target's parts around its one *, or undefined when it holds none. */
function star(pattern: string): { prefix: string; suffix: string } | undefined {
  const at = pattern.indexOf("*");
  return at < 0 ? undefined : { prefix: pattern.slice(0, at), suffix: pattern.slice(at + 1) };
}

// Node's condition sets: its defaults, and with types, the condition TypeScript adds.
const conditionSets: string[][] = [[], ["--conditions=types"]];
// Each specifier in argv resolved as the package's own import: its URL, or the code of the error
// with which Node refuses it.
const resolveArgs = `console.log(JSON.stringify(process.argv.slice(1).map((specifier) => {
  try { return { url: import.meta.resolve(specifier) }; } catch (error) { return { code: error.code }; }
})));`;

/** A subpath as Node resolves it: the path it resolves to, or the code Node refuses it with. */
export type Resolution = { path: string; code?: never } | { path?: never; code: string };

/** Each subpath of the package at root as Node resolves it by self-reference under `conditions`
 * (Node's flags), in order: { path } relative to root, or { code } where Node refuses it. */
export function resolveSelf(
  root: string,
  subpaths: string[],
  conditions: string[] = [],
): Resolution[] {
  const { name } = readManifest(root);
  const specifiers = subpaths.map((subpath) => name + subpath.slice(1));
  const args = [...conditions, "--input-type=module", "-e", resolveArgs, ...specifiers];
  // The script's output: per specifier, the URL Node resolves it to or the error code it gives.
  const results = JSON.parse(
    execFileSync(process.execPath, args, { cwd: root, encoding: "utf8" }),
  ) as { url?: string; code?: string }[];
  return results.map(({ url, code }) =>
    url === undefined
      ? { code: code ?? "" }
      : { path: relative(root, fileURLToPath(url)).split(sep).join("/") },
  );
}

/** The paths, relative to root, that Node resolves each subpath of the package at root to under
 * any condition set, by self-reference, as { subpath: Set }; none where Node refuses it. */
function resolveSubpaths(root: string, subpaths: string[]): Record<string, Set<string>> {
  const resolved = Object.fromEntries(subpaths.map((subpath) => [subpath, new Set<string>()]));
  for (const conditions of conditionSets) {
    resolveSelf(root, subpaths, conditions).forEach(({ path }, i) => {
      if (path !== undefined) resolved[subpaths[i]].add(path);
    });
  }
  return resolved;
}

/** The dist/ paths a source in src/ ships as: a module as its emitted .js and .d.ts, and a
 * handwritten declaration as itself. */
export function builtFrom(source: string): string[] {
  if (source.endsWith(".d.ts")) return [`dist/${source}`];
  if (source.endsWith(".ts")) {
    const base = source.slice(0, -".ts".length);
    return [`dist/${base}.js`, `dist/${base}.d.ts`];
  }
  return [];
}

/** The files every pack carries whatever package.json's files lists. */
const always = ["LICENSE", "README.md", "package.json"];

/** The license every release declares, and the text its LICENSE opens with. */
const license = "Apache-2.0";
const licenseHeading = /^\s*Apache License\s+Version 2\.0, January 2004\s/;

/** What keeps root, a pack's package/, from carrying the license its package.json declares, one
 * line each: the declaration and the LICENSE beside package.json. */
export function licenseProblems(root: string): string[] {
  const problems: string[] = [];
  const manifest = readManifest(root);
  if (manifest.license !== license) {
    problems.push(`package.json declares license ${manifest.license}, not ${license}`);
  }
  const path = join(root, "LICENSE");
  if (!existsSync(path)) problems.push("LICENSE is missing");
  else if (!licenseHeading.test(readFileSync(path, "utf8"))) {
    problems.push("LICENSE isn't the Apache License 2.0");
  }
  return problems;
}

/** The NATS adapter's packages, the release's only peers: each optional, so an app that never
 * imports the adapter installs neither, and each by a caret range, which the repository's own
 * install of it, a devDependency at one exact version, falls within. */
const natsPackages = ["@nats-io/nats-core", "@nats-io/jetstream"];
const caretRange = /^\^\d+\.\d+\.\d+$/;
const exactVersion = /^\d+\.\d+\.\d+$/;

/** The tooling, the one devDependency from GitHub: at one release tag, never a range, a branch, a
 * commit, or a #semver: spec, which bun fails. Which version, range, and tag is package.json's, and
 * mise run currency reports each behind its latest. */
const tooling = "@standards-lab/web-tooling";
const toolingTag = /^github:standards-lab\/web-tooling#v\d+\.\d+\.\d+$/;

/** Whether the caret range, ^x.y.z, admits the version x.y.z: the same leftmost nonzero part and
 * no lower, so ^0.1.0 admits 0.1.x only. mise run currency asks it too. */
export function caretAdmits(range: string, version: string): boolean {
  const [major, minor, patch] = range.slice(1).split(".").map(Number);
  const [vMajor, vMinor, vPatch] = version.split(".").map(Number);
  const atLeast =
    vMajor > major ||
    (vMajor === major && (vMinor > minor || (vMinor === minor && vPatch >= patch)));
  if (!atLeast) return false;
  if (major > 0) return vMajor === major;
  if (minor > 0) return vMajor === 0 && vMinor === minor;
  return vMajor === 0 && vMinor === 0 && vPatch === patch;
}

/** What keeps root, a pack's package/, from declaring exactly the dependencies a release needs,
 * in the form each takes, one line each: no dependency at run time, the NATS adapter's packages as
 * optional caret-range peers and nothing else, and the tooling at its release tag. */
export function dependencyProblems(root: string): string[] {
  const problems: string[] = [];
  const manifest = readManifest(root);
  const peers = manifest.peerDependencies ?? {};
  const meta = manifest.peerDependenciesMeta ?? {};
  const dev = manifest.devDependencies ?? {};
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    problems.push(`package.json declares ${name} in dependencies, but a release has none`);
  }
  for (const name of Object.keys(peers)) {
    if (!natsPackages.includes(name)) {
      problems.push(`package.json declares peer ${name}, which no release needs`);
    }
  }
  for (const name of Object.keys(meta)) {
    if (!(name in peers)) problems.push(`peerDependenciesMeta names ${name}, which isn't a peer`);
  }
  for (const name of natsPackages) {
    const range = peers[name];
    if (range === undefined) {
      problems.push(`package.json doesn't declare peer ${name}`);
      continue;
    }
    if (!caretRange.test(range)) {
      problems.push(`package.json declares peer ${name} ${range}, not a caret range`);
    }
    if (meta[name]?.optional !== true) {
      problems.push(`package.json's peer ${name} isn't optional`);
    }
    const pin = dev[name];
    if (pin === undefined) problems.push(`package.json doesn't declare devDependency ${name}`);
    else if (!exactVersion.test(pin)) {
      problems.push(`package.json declares devDependency ${name} ${pin}, not an exact pin`);
    } else if (caretRange.test(range) && !caretAdmits(range, pin)) {
      problems.push(
        `package.json's devDependency ${name} ${pin} is outside its peer range ${range}`,
      );
    }
  }
  if (!(tooling in dev)) problems.push(`package.json doesn't declare devDependency ${tooling}`);
  else if (!toolingTag.test(dev[tooling])) {
    problems.push(
      `package.json declares devDependency ${tooling} ${dev[tooling]}, not an exact release tag`,
    );
  }
  return problems;
}

/** What keeps root, a pack's package/, from being the release its package.json declares for the
 * sources in `src` with the `publics` subpaths, one line each. A public subpath, such as
 * "./api.js", is its module's built .js and .d.ts; every other built module is internal, reached
 * by the public ones' relative imports and never through the package's name. */
export function releaseProblems(root: string, src: string, publics: string[]): string[] {
  const problems = [...licenseProblems(root), ...dependencyProblems(root)];
  const manifest = readManifest(root);
  const { exports = {}, files = [] } = manifest;
  const packed = listFiles(root);
  const built = packed.filter((path) => path.startsWith("dist/"));
  const builtSet = new Set(built);

  // The pack is the build and the files every pack carries, and nothing else.
  if (!packed.includes("README.md")) problems.push("the pack has no README.md");
  for (const path of packed) {
    if (!path.startsWith("dist/") && !always.includes(path)) {
      problems.push(`${path} is packed but isn't the build, ${always.join(", ")}`);
    }
  }

  // The build against the sources: each source's emit or copy is there, and nothing else is.
  const expected = new Set<string>();
  for (const source of listFiles(src)) {
    const outputs = builtFrom(source);
    if (outputs.length === 0) problems.push(`src/${source} isn't a .ts or .d.ts source`);
    for (const output of outputs) {
      expected.add(output);
      if (!builtSet.has(output)) problems.push(`src/${source} has no built ${output}`);
    }
  }
  for (const path of built) {
    if (!expected.has(path)) problems.push(`${path} is built from no source`);
  }

  // files ships the build: each built file lies under an entry of files.
  const shipped = (path: string) =>
    files.some(
      (entry) =>
        path === entry.replace(/\/$/, "") || path.startsWith(`${entry.replace(/\/$/, "")}/`),
    );
  for (const path of built) {
    if (!shipped(path)) problems.push(`${path} isn't under package.json's files`);
  }

  // exports lists the public subpaths, each with a types and a default condition, and nothing
  // else: no pattern, which would reach an internal module too.
  for (const subpath of publics) {
    if (!(subpath in exports)) problems.push(`exports has no "${subpath}"`);
  }
  for (const [key, entry] of Object.entries(exports)) {
    if (entry === null) continue;
    if (!publics.includes(key)) problems.push(`exports["${key}"] isn't a public subpath`);
    else if (typeof entry !== "object" || Object.keys(entry).join() !== "types,default") {
      problems.push(`exports["${key}"] isn't a types and a default condition`);
    }
  }

  // exports: every entry a target or a flat object of condition targets, or null, which excludes
  // its subpath; every public module's built file reached through an export as Node resolves it,
  // and no internal module's subpath resolved at all; every pattern key reaching a built file; and
  // every target Node resolves an export to built. The subpaths judged are the exact keys, each
  // built file's subpath through a pattern target that matches it, and each internal module's.
  const subpaths = new Set<string>();
  const origins: { key: string; subpath: string; path: string }[] = [];
  for (const [key, entry] of Object.entries(exports)) {
    if (entry === null) continue;
    const targets = typeof entry === "string" ? [entry] : Object.values(entry);
    if (
      targets.length === 0 ||
      !targets.every((target): target is string => typeof target === "string")
    ) {
      problems.push(`exports["${key}"] isn't a target or a flat object of condition targets`);
      continue;
    }
    const keyParts = star(key);
    if (keyParts === undefined) subpaths.add(key);
    for (const target of targets) {
      const parts = star(target);
      for (const path of built) {
        const file = `./${path}`;
        let subpath: string | undefined;
        if (parts === undefined) {
          if (target === file && keyParts === undefined) subpath = key;
        } else if (
          keyParts !== undefined &&
          file.length >= parts.prefix.length + parts.suffix.length &&
          file.startsWith(parts.prefix) &&
          file.endsWith(parts.suffix)
        ) {
          subpath = key.replace(
            "*",
            file.slice(parts.prefix.length, file.length - parts.suffix.length),
          );
        }
        if (subpath === undefined) continue;
        subpaths.add(subpath);
        origins.push({ key, subpath, path });
      }
    }
  }
  const publicFiles = new Set(
    publics.flatMap((subpath) => {
      const base = `dist/${subpath.slice(2, -".js".length)}`;
      return [`${base}.js`, `${base}.d.ts`];
    }),
  );
  const internals = built
    .filter((path) => path.endsWith(".js") && !publicFiles.has(path))
    .map((path) => `./${path.slice("dist/".length)}`);
  const resolved = resolveSubpaths(root, [...new Set([...subpaths, ...internals])]);
  const reached = origins.filter(({ subpath, path }) => resolved[subpath].has(path));
  for (const path of built) {
    if (publicFiles.has(path) && !reached.some((origin) => origin.path === path)) {
      problems.push(`${path} is reachable through no export`);
    }
  }
  for (const subpath of internals) {
    if (resolved[subpath].size > 0) {
      problems.push(`${subpath} is internal, but resolves through the package's name`);
    }
  }
  for (const key of Object.keys(exports)) {
    if (key.includes("*") && !reached.some((origin) => origin.key === key)) {
      problems.push(`exports["${key}"] reaches no built file`);
    }
  }
  for (const [subpath, paths] of Object.entries(resolved)) {
    for (const path of paths) {
      if (!builtSet.has(path)) {
        problems.push(`exports["${subpath}"] resolves to ./${path}, which isn't built`);
      }
    }
  }
  return problems;
}
