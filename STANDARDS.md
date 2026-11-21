<!-- Adapted from spike-html-apps-sdk (df65376): STANDARDS.md, for @standards-lab/web-app-sdk and
its hand-cut releases. -->

# web-app-sdk standards

The judgement calls the standards-reviewer applies to web-app-sdk, beyond what `mise run check`
enforces: each one line, with a pointer to the architecture page that applies where one does. What
the check enforces is never restated here. The `standard` task points them at the Web Elemental
standard once it is founded (`standards-lab/context/web-client.md`, "Toward Web Elemental").

The architecture pages that apply, in the architecture repository:

- `architecture/principles/minimal-footprint.md`: no runtime dependency, the runtime written
  here, its only peers optional, and each devDependency deliberate; a consumer installs the tag
  with no build step.
- `architecture/principles/rolling-currency.md`: every tool, package, and action pin explicit and
  at its latest, and the optional peers' range admitting their latest release.
- `architecture/principles/independent-releases.md`: the package releases on its own tags.
- `architecture/principles/downward-dependencies.md`: the SDK sits beside the components, below
  the app, and imports no layer of the stack.
- `architecture/principles/comments.md`: every comment is one of the five kinds (package
  documentation, a suppression's reason, a pin hold's reason, provenance, a reference) in
  TypeScript, JavaScript, shell, CSS, HTML, tests, and every configuration file (TOML, YAML,
  JSONC, `.gitignore`, `.prettierignore`).
- `architecture/principles/validation-first.md`: the client and the adapter check what a server
  sends, a status, a content type, a body, a cursor, before an app sees it, and a failure is a
  value, never a throw.

## Package

- The package is `@standards-lab/web-app-sdk`, the application SDK of the web client stack: its
  contracts and the runtime that implements them
  (`architecture/principles/minimal-footprint.md`).
- A new runtime need is an optional peer behind an adapter subpath of its own, never a runtime
  dependency, so an app that doesn't use the adapter never loads it
  (`architecture/principles/minimal-footprint.md`).
- A module is exported only when an app imports it, as a `.js` subpath listed by name; a helper
  of the modules, such as the event-stream parser, stays internal.
- A contract, such as the event sequence, holds for every implementation of it, and one shared
  suite proves each.
- `dist/` lives only in a release tag's tree, the pack, never on a branch.
- Releases are plain `vX.Y.Z` annotated tags on a pack commit whose one parent is main's merge
  commit, cut by hand on a green check from `package.json`'s version, each with its `CHANGELOG.md`
  section, and never changed or re-cut; the release workflow, dispatched by hand with the pushed
  tag and never on a push, only verifies and publishes it (`standards-lab/context/web-client.md`,
  "Packaging and release"; `architecture/principles/independent-releases.md`).

## Layers

- The SDK holds no view and imports no component; the app wires the SDK to its views
  (`architecture/principles/downward-dependencies.md`).
- The SDK binds no key and declares no key binding; only the app binds keys.
- A layer resolves another only through its release tag, as a consumer does: never a link, path
  alias, source condition, or project reference
  (`architecture/principles/independent-releases.md`).

## Code

- A module's or a script's header documents the public contract, what it provides and promises,
  with no reasoning, and each export carries a one-line doc comment. A doc comment on a
  non-exported symbol, an in-body comment, and a test's comment are none of the five kinds: their
  reasoning goes into names, exported docs, or a `docs/` page behind a one-line `See` reference,
  and a script's sections become named functions. A configuration file's header is at most a short
  description plus `See` lines. A lint directive carries its reason as its `--` description.
- A copied file names each source repository and commit in one provenance line per source, which
  reads `From|Adapted from <repo> (<commit>): <path>`, plus at most a short clause naming what
  changed, never why, and a third-party source's licence after a semicolon. The lines its immediate
  source carried for earlier sources stay beside that source's own. A JSON file, which takes no
  comment, has its line in `context/README.md`.
- Sources use `.ts` relative specifiers, which tsc rewrites; a handwritten `.d.ts` keeps `.js`.
- Tests are TypeScript run under Node's type stripping, erasable syntax only, type-checked by
  `tsconfig.test.json`; browser-served fixtures stay `.js`.
- The browser tier tests `dist/`, and no server transforms what it serves.
- A mise task runs one script or one command, and `check` is a depends list.
