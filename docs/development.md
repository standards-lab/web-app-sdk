# Development

This page holds the reasoning behind the repository's configuration and tests. The
[README](../README.md#development) lists the tasks.

## Tools

`mise.toml` pins every tool the tasks run, and no task installs a missing one:
`task.run_auto_install` is off, and `mise run install` is the one task that reads the network.
`scripts/preflight.sh` fails a task whose tool is missing, naming that command.

- **nats-server** is the NATS adapter's test server, which `test/unit/nats-server.ts` starts per
  suite on the loopback address. mise's registry maps it to `github:nats-io/nats-server`.
- **chrome-headless-shell** is the browser tier's browser. Chrome for Testing publishes no
  checksums, so each bump takes the sha256 and size from the download by hand. mise caches a
  download by its checksum, so a version bumped without its own sha256 installs the old build; the
  preflight compares the installed browser's version with the pin and fails, naming the sha256, when
  they differ.
- **actionlint** shellchecks each workflow's `run:` block too, with the pinned shellcheck.
- `types:test` depends on `build`: the tests import the package by its name, which resolves to
  `dist/`'s declarations.

## TypeScript

`tsconfig.json` builds `src/` into `dist/`, and `mise run types` checks the same sources with
`--noEmit`. Its `lib` includes `esnext.disposable`, which declares `Symbol.asyncDispose`:
`@nats-io/nats-core`'s declarations name it, and `skipLibCheck: false` checks them. No source uses
it. `scripts/build.sh` copies a handwritten `.d.ts`, which tsc never emits, beside the emitted
files.

## pnpm

`pnpm-workspace.yaml` lists no packages: the repository is one package.

- `allowBuilds` refuses unrs-resolver's postinstall. unrs-resolver, under eslint-plugin-import-x and
  eslint-import-resolver-typescript, fetches its native binding when the optional dependency
  holding it is missing; pnpm installs that dependency.
- `minimumReleaseAge: 0` turns off pnpm's default wait of a day before it installs a release. The
  currency task moves each pin to its latest release, and that release's notes are read before the
  bump lands, a review that stands in for the age gate. With the wait on, a frozen install of a
  lockfile that pins a release under a day old fails.

## Currency

`scripts/currency.sh` reads mise's outdated report at the error log level: mise warns on every run
that a GitHub release has no assets. A `github:` devDependency, the tooling, is pinned to its
repository's release tag, which the registry doesn't hold, so it is compared with that
repository's latest release. typescript is held to the newest version typescript-eslint's peer
range accepts. An optional peer's caret range must admit its package's latest release, so an app
can install it beside the SDK, by the release test's own rule, `caretAdmits`.

## Lint

`eslint.config.js` lints every `.js` and `.ts` file outside `dist/`, the build, which is
gitignored. The suite and the scripts run on Node; the fixtures a test page loads, `test/`'s
`.js`, run in the browser.

Every suppression carries its reason: eslint-comments' `require-description` fails an ESLint
directive without one, and `ban-ts-comment` allows a TypeScript directive only with a description.

The layer's import rules:

- The layer is an element by its directory, matched from the root (`partialMatch: false`), with a
  second pattern for a file in a directory whose name starts with a dot, which micromatch's `**`
  never enters, so `./.well-known/` and `./..x/` stay in the layer. An adapter is a file of its
  layer with a category of its own.
- The rule's default is disallow, and it checks every origin (a package is external) and local
  files no element holds: an import passes only when a policy names its target. An adapter's
  policies follow the layer's: the first allows its packages from it, and the second refuses an
  import of it from anywhere, overriding the layer's allow. The adapter's packages are optional
  peer dependencies, so a module that doesn't import the adapter loads without them, and nothing
  imports an adapter: an app imports it by its subpath.
- A declaration file (a handwritten `.d.ts`) has no runtime, so an import that resolves to one
  passes only as a type import, `import type` or `export type`, which tsc erases: the last policy
  refuses any other kind, and as the last whose selector matches it overrides the allow before it.
  The dependency's kind is the declaration's, so `import { type X }` is a value import here, as it
  is to `verbatimModuleSyntax`, which keeps it as `import {}` and so loads the file.
  `checkInternals` has the rule judge an import within the layer too, which the layer's policy
  allows.
- The rule judges the file an import resolves to, never the specifier's text, and `no-unresolved`
  fails a specifier that names no file, so no import passes by naming none.
- `no-extraneous-dependencies` judges an import against `package.json`'s dependencies, which hold
  none, in every import form (`includeTypes`); a devDependency ships nothing. It passes the
  package's own name (eslint-plugin-import-x 4.18 passes a self-import in a package whose manifest
  has an exports field, as Node resolves one), so the layer table alone refuses that.
  `no-relative-packages` refuses a relative path into another package's files.

`test/unit/layers.test.ts` lints `test/unit/layers-tree.ts`'s tree, one tree so each case is judged
beside the others, as the package's files are, and passes only when ESLint flags exactly the files
that break a rule, each with exactly the rules its case names.

## Format

Prettier formats the code and the JSON only: its default run would also rewrite the Markdown, the
YAML, and `pnpm-lock.yaml`. `.prettierignore` ignores every file, then lets every directory and the
code and JSON files back in. Prettier also skips what `.gitignore` lists.

## Tests

The tiers test the package as a consumer imports it: by its name, through `package.json`'s exports,
over the `dist/` that `mise run build` writes. The event-stream parser is internal, so its suite
imports the built module by its path in `dist/`.

The tests are TypeScript that `node --test` runs under Node's type stripping, so
`tsconfig.test.json`'s `erasableSyntaxOnly` holds them to syntax the stripping erases. They import
the package by its name, which resolves by self-reference to `dist/`, as Node resolves it:
`nodenext`, with Node's own types. The test support modules, such as the sample documents service
and the in-memory sequence, are test code the package never exports.

- **API client.** A loopback `node:http` server per test writes each kind of body and failure the
  client decodes; its event streams are written in chunks, split mid-line, mid-field, and inside a
  CRLF. An empty status message is written to the socket raw, since Node fills one in. An endless
  stream's tests carry a timeout, so a defect that leaves one unended fails rather than stalls.
  Node has no XMLHttpRequest, so the upload's own cases run in the browser tier, against
  `test/browser/support/upload.ts`'s routes; its 16 MB body, read slowly, is past what the loopback
  socket's buffers take at once, so the browser reports progress several times.
- **Router.** The browser tier drives `test/fixtures/router.html` with real clicks and history
  traversals through the DevTools Protocol. The server sends the shell page for every path with no
  extension, as an app's server does for each deep link. The browser's own reload never reaches
  the router's navigate listener; a script's does, and the router leaves it to the browser too.
- **Event sequences.** `test/unit/sequence-contract.ts` is the contract any `EventSequence` runs.
  Every test has a timeout, so a read that hangs fails rather than stalls, and an append waits
  briefly so the read it races is waiting when it lands. `test/unit/memory-sequence.ts` is the
  reference implementation: its generator's body runs on the first `next()`, so an unknown cursor
  rejects the iteration.
- **NATS.** `test/unit/nats-server.ts` starts the pinned nats-server on free ports it picks (port
  -1); a restart keeps them, so a client reconnects to the same URL. Its process management
  follows web-tooling's `launch()`. The suite publishes events as go-messaging's `nats/v0.2.0`
  broker does, over go-core v0.10.0's `event.Encode`, and checks the package's other subpaths load
  in a scratch `node_modules/` with no `@nats-io` packages, a copy rather than a link, which would
  resolve from the repository.
- **Declarations.** The check's own tsc, mise's TypeScript-Go pin, refuses runtime code in a
  declaration file. `skipLibCheck: false` is the guard: with it on, tsc skips every `.d.ts`. Every
  error tsc reports must be one the case expects, so an error outside the scratch tree, a config tsc
  can't read, say, fails rather than passes a case that expects none.
- **Release.** `test/unit/release.test.ts` packs the build with `pnpm pack` and checks it, as it
  stands and in scratch copies with one fault each: the pack is the build and the files every pack
  carries; `exports` lists the public subpaths, each with a `types` and a `default` condition and
  no pattern, which would reach an internal module too; and the manifest has no build script, which
  npm runs to prepare a git dependency.

## Workflows

The release workflow runs from main's copy, dispatched by hand with the tag, as the
[README](../README.md#release) gives it. Its release action releases the tag its `ref` names, not
the dispatching ref, main: it runs `gh release create` on that tag with no target, so the release
is for the tag the workflow fetched and checked.
