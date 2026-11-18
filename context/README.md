# web-app-sdk context

web-app-sdk is what a web application is built with above web-foundation: routing, talking to a
go-web-sdk service, authenticating, and following a service's events. Its API client returns a
`Result` whose failure is go-web-sdk's RFC 9457 problem, and its event sequence resumes by an
opaque cursor, so an application survives reloads and reconnects without its own protocol code.

It is a package under the `@standards-lab` scope, starting at v0.1.0 and released by a plain
`vX.Y.Z` tag. Its goals live in the coordinator's roadmap (`standards-lab/context/roadmap.toml`,
v1.client.stack), and its strategy is `standards-lab/context/web-client.md`. It is seeded by copy
from spike-html-apps-sdk, with a provenance line on every copied file; the spike is archived and never a
dependency.

## Capability map

- **Router**: routes on URLPattern and the Navigation API, over views, modules, elements, and domains.
- **API client**: requests with upload progress and streamed responses, returning a `Result`.
- **Tokens**: the token provider the API client and the event adapter use.
- **Domain services**: the pattern an application's domain logic follows.
- **Events**: a CloudEvents sequence resumable by cursor, with a NATS-over-WebSocket adapter whose `@nats-io` packages are optional peers.
