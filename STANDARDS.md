# web-app-sdk standards

The judgement calls the standards-reviewer applies to web-app-sdk, beyond what `mise run check`
enforces: each one line, with a pointer to the architecture page that applies where one does. What
the check enforces is never restated here. web-app-sdk is a Web Elemental member
(`architecture/standards/web-elemental/README.md`).

The architecture pages that apply, in the architecture repository:

- `architecture/principles/minimal-footprint.md`: no runtime dependency, the runtime written
  here, its only peers optional, and each devDependency deliberate; a consumer installs the tag
  with no build step.
- `architecture/principles/rolling-currency.md`: every tool, package, and action pin explicit and
  at its latest, and the optional peers' range admitting their latest release.
- `architecture/principles/independent-releases.md`: the package releases on its own tags.
- `architecture/principles/downward-dependencies.md`: the SDK sits beside the components, below
  the app, and imports no layer of the stack.
- `architecture/principles/comments.md`: the five kinds of comment.
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
- Its releases, `dist/`, how it resolves another layer, and its pins follow
  `architecture/standards/web-elemental/principles/packages-and-releases.md`.

## Layers

- The SDK holds no view and imports no component; the app wires the SDK to its views
  (`architecture/principles/downward-dependencies.md`).
- The SDK binds no key and declares no key binding; only the app binds keys.

## Code

- A module's or a script's header documents the public contract, what it provides and promises,
  with no reasoning. A script's sections become named functions. A lint directive carries its
  reason as its `--` description.
- Sources use `.ts` relative specifiers, which tsc rewrites; a handwritten `.d.ts` keeps `.js`.
- Tests are TypeScript run under Node's type stripping, erasable syntax only, type-checked by
  `tsconfig.test.json`; browser-served fixtures stay `.js`.
- The browser tier tests `dist/`, and no server transforms what it serves.
- A mise task runs one script or one command, and `check` is a depends list.
