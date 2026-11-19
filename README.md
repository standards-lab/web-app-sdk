<!-- Adapted from spike-html-apps-sdk (df65376): README.md, for @standards-lab/web-app-sdk. -->

# web-app-sdk

The application SDK of the web client stack: the API client and its Result and Problem types, the
token hook, and the domain-service pattern. It is a runtime with no runtime dependency, written in
TypeScript and shipped as ES modules with their declarations.

## Use

The package is `@standards-lab/web-app-sdk`. It exports the subpaths below, each a `.js` name
with a `types` and a `default` condition; its internal modules, such as the event-stream parser,
aren't importable:

```ts
import { createClient } from "@standards-lab/web-app-sdk/api.js";
import type { Service } from "@standards-lab/web-app-sdk/service.js";
```

- `./api.js`: the API client, `createClient` and `Client`. Its calls (`get`, `post`, `put`,
  `patch`, `delete`) take a request's `query`, `headers`, and `signal`, and resolve to a `Result`
  and never reject: the decoded data, or an RFC 9457 `Problem` with every extension member the
  server sent, or one the client made itself (`ClientProblemType`: network, abort, timeout,
  decode, and encode). A success's data is decoded by its content type: JSON parsed, `text/*` a
  string, any other a `Blob`. Given `{ as: "text" }` (`TextOptions`), a call's data is instead the
  body's text, typed `string`, whatever its content type; a failure is its `Problem` as without
  it. `stream` reads a text/event-stream response's `ServerSentEvent`s; `upload` sends a body over
  XMLHttpRequest and reports its progress. A `TokenProvider` puts a bearer token on each request
  and is asked once to refresh on a 401. `Page` is a page of a list.
- `./auth.js`: the `TokenProvider` hook and the `anonymous` default, which sends no token.
- `./service.js`: the domain-service pattern, `Service`, `Endpoint`, and `ServiceFactory`, as
  types: an app's domains tier writes each service as a stateless object over a `Client`, checked
  with `satisfies Service`.

The runtime targets the browser. `upload` needs `XMLHttpRequest`; where there is none, as on Node,
it resolves to the network problem.

## Development

Tasks run through [mise](https://mise.jdx.dev):

```
mise run install    # the pinned tools and node_modules; reads the network
mise run check      # lint, types, build, and the unit tier; reads no network
mise run build      # src/ into dist/
mise run currency   # report every tool, package, action pin, and tooling tag behind its latest
```

The unit tier runs under `node --test`: the client against a loopback server, the event-stream
parser, tsc's refusal of runtime code in a declaration file, the layer's import rules, and a pack
of the build.

## License

[Apache License 2.0](LICENSE).
