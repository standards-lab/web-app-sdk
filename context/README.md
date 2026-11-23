# web-app-sdk context

web-app-sdk is what a web application is built with beside web-foundation and web-components,
depending on neither: routing, talking to a go-web-sdk service, authenticating, and following a
service's events. Its API client returns a `Result` whose failure is go-web-sdk's RFC 9457
problem, and its event sequence resumes by an opaque cursor, so an application survives reloads
and reconnects without its own protocol code.

It is a package under the `@standards-lab` scope, released by a plain
`vX.Y.Z` tag. Its goals live in the coordinator's roadmap (`standards-lab/roadmap/index.toml`,
v1.client.stack), and its strategy is `standards-lab/context/web-client.md`. It has no runtime
dependency; its only peers, `@nats-io/nats-core` and `@nats-io/jetstream` at `^3.5.0`, are
optional and imported by `./events/nats.js` alone.

## Provenance

The package's lineage is recorded in the workspace's
[references catalog](https://github.com/standards-lab/org/blob/main/references.md).

## Capability map

- **Router** (built): [src/router.ts](../src/router.ts).
- **API client** (built): [src/api.ts](../src/api.ts).
- **Tokens** (built): [src/auth.ts](../src/auth.ts).
- **Domain services** (built): [src/service.ts](../src/service.ts).
- **Events** (built): [src/events.ts](../src/events.ts) and
  [src/events/nats.ts](../src/events/nats.ts).
