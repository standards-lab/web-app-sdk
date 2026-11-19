# web-app-sdk context

web-app-sdk is what a web application is built with beside web-foundation and web-components,
depending on neither: routing, talking to a go-web-sdk service, authenticating, and following a
service's events. Its API client returns a `Result` whose failure is go-web-sdk's RFC 9457
problem, and its event sequence resumes by an opaque cursor, so an application survives reloads
and reconnects without its own protocol code.

It is a package under the `@standards-lab` scope, released by a plain
`vX.Y.Z` tag. Its goals live in the coordinator's roadmap (`standards-lab/context/roadmap.toml`,
v1.client.stack), and its strategy is `standards-lab/context/web-client.md`. It has no runtime
dependency; its only peers, `@nats-io/nats-core` and `@nats-io/jetstream` at `^3.5.0`, are
optional and imported by `./events/nats.js` alone.

## Provenance

The package is seeded by copy from spike-html-apps-sdk at df65376, its v0.4.0 code with pnpm's
`minimumReleaseAge: 0`. The spike is archived and never a dependency. Each copied file that takes
comments names its source in a provenance line; the workflows and CHANGELOG.md name theirs,
web-components' at a659353. The files with no line have their provenance here:

- `package.json` is adapted from spike-html-apps-sdk (df65376): package.json. It is renamed
  `@standards-lab/web-app-sdk` at 0.1.0, takes its optional `@nats-io/nats-core` and
  `@nats-io/jetstream` peers at `^3.5.0` (their devDependencies at 3.5.0), and replaces the
  spike's tooling devDependency with web-tooling's v0.1.0 tag; its other pins are web-components'.
- `.prettierrc.json` is from spike-html-apps-sdk (df65376): .prettierrc.json.
- `LICENSE` is from spike-html-apps-sdk (df65376): LICENSE, unchanged.
- `pnpm-lock.yaml` is generated, not copied.
- `CLAUDE.md`, `.claude/`, and this directory are marathon's working files, written here.

## Capability map

- **Router**: routes on URLPattern and the Navigation API under a base, mounting each route's
  element, eager or lazily loaded, and an error element.
- **API client**: requests with upload progress and streamed responses, returning a `Result`
  whose failure is an RFC 9457 problem.
- **Tokens**: the token provider the API client and the event adapter use.
- **Domain services**: the pattern an application's domain logic follows.
- **Events**: a CloudEvents sequence resumable by cursor, with a NATS-over-WebSocket adapter
  whose `@nats-io` packages are optional peers.
