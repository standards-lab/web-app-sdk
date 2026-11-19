<!-- Adapted from web-components (a659353): CHANGELOG.md, for @standards-lab/web-app-sdk, with
none of spike-html-apps-sdk's versions. -->

# Changelog

All notable changes to `@standards-lab/web-app-sdk` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-19

### Added

- The application SDK, seeded by copy from spike-html-apps-sdk at df65376 (its v0.4.0 code): a
  runtime with no runtime dependency, written in TypeScript, which tsc builds into `dist/`, each
  module's `.js` with its `.d.ts`. Each public module is a `.js` subpath with a `types` and a
  `default` condition; the internal event-stream parser isn't exported.
- `./api.js`: `createClient`, whose calls resolve to a `Result` and never reject: the decoded
  data, or an RFC 9457 `Problem` with every extension member kept, or one the client made itself
  (`urn:standards-lab:problem:` network, abort, timeout, decode, and encode). `{ as: "text" }`
  gives a body's text; `stream` reads a text/event-stream response's `ServerSentEvent`s by the
  WHATWG parsing rules; `upload` sends a body over XMLHttpRequest and reports its progress.
- `./auth.js`: the `TokenProvider` hook, which puts a bearer token on each request and is asked
  once, shared by the calls in flight, to refresh on a 401; and `anonymous`, which sends none.
- `./router.js`: `createRouter`, routing on `URLPattern` and the Navigation API under its base,
  mounting an eager or lazily loaded route's element in its outlet and the error element when a
  route fails, dispatching `change`, with `start()` and `query()` returning promises.
- `./service.js`: the domain-service types, `Endpoint`, `Service`, and `ServiceFactory`, over a
  `Client`.
- `./events.js`: the event-sequence contract: `EventSequence`, read as `Delivery`s of
  `CloudEvent`s resumable from an opaque `Cursor` by `ReadOptions`, and `UnknownCursorError` for a
  start cursor the sequence never gave out.
- `./events/nats.js`: `natsSequence`, an `EventSequence` over a JetStream stream of go-messaging's
  binary-mode CloudEvents, read over NATS's WebSocket transport, resuming from a cursor with no gap
  or duplicate across a server restart and refreshing a refused token once. It is the one module
  that imports `@nats-io/nats-core` and `@nats-io/jetstream`, the package's optional peers at
  `^3.5.0`.
- The unit tier under `node --test`, the client against a loopback server and the NATS adapter
  against a pinned nats-server, one contract suite passing for an in-memory sequence and for
  `natsSequence`; and the browser tier, the router and the upload, on
  `@standards-lab/web-tooling` v0.1.0 in a pinned chrome-headless-shell.
- Releases by tag: each `v<version>` tag marks a pack commit whose tree is the pack, the build
  included, and whose one parent is main's merge commit; its GitHub release carries the tarball.

[0.1.0]: https://github.com/standards-lab/web-app-sdk/releases/tag/v0.1.0
