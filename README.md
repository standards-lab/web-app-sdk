# web-app-sdk

The application SDK of the standards-lab web client stack: the API client and its Result and
Problem types, the token hook, the router, the domain-service pattern, the event sequence with its
NATS adapter, and the resumable upload client. It is a runtime with no runtime dependency, written in TypeScript and shipped as
ES modules with their type declarations, and is released by git tag. It depends on no other layer
of the stack.

## Install

Each release is a tag, `v<version>`, of
[standards-lab/web-app-sdk](https://github.com/standards-lab/web-app-sdk), whose tree is the
package as `pnpm pack` builds it: `package.json`, this README, the LICENSE, and `dist/`, the build.
The build lives only in the tag's tree, so the tag installs with no build step, and its manifest
has no scripts. Install it by its tag:

```
pnpm add github:standards-lab/web-app-sdk#v0.2.0
bun add github:standards-lab/web-app-sdk#v0.2.0
npm install --allow-git=root github:standards-lab/web-app-sdk#v0.2.0
```

npm 12 refuses git dependencies unless `--allow-git` allows them; `root` allows the ones the
project itself declares. An app that reads a NATS stream installs the optional peers beside it:

```
pnpm add @nats-io/nats-core@^3.5.0 @nats-io/jetstream@^3.5.0
```

Each GitHub release also carries the tarball.

## Use

The package is `@standards-lab/web-app-sdk`. It exports the seven subpaths below, each a `.js`
name with a `types` and a `default` condition; its internal modules, such as the event-stream
parser and the uploader's SHA-256, aren't importable:

```ts
import { createClient } from "@standards-lab/web-app-sdk/api.js";
import { createRouter } from "@standards-lab/web-app-sdk/router.js";
import type { Service } from "@standards-lab/web-app-sdk/service.js";
import { natsSequence } from "@standards-lab/web-app-sdk/events/nats.js";
import { createUploader } from "@standards-lab/web-app-sdk/upload.js";
```

- `./api.js`: the API client, `createClient` and `Client`. Its calls (`get`, `post`, `put`,
  `patch`, `delete`) take a request's `query`, `headers`, and `signal`, and resolve to a `Result`
  and never reject: the decoded data, or an RFC 9457 `Problem` with every extension member the
  server sent, or one the client made itself (`ClientProblemType`:
  `urn:standards-lab:problem:` network, abort, timeout, decode, and encode). A success's data is
  decoded by its content type: JSON parsed, `text/*` a string, any other a `Blob`. Given
  `{ as: "text" }` (`TextOptions`), a call's data is instead the body's text, typed `string`,
  whatever its content type: a JSON body exactly as stored, its whitespace and key order kept,
  even when it doesn't parse; a failure is its `Problem` as without it. `stream` reads a
  text/event-stream response's `ServerSentEvent`s by the WHATWG parsing rules; `upload` sends a
  body over XMLHttpRequest and reports its progress. A `TokenProvider` puts a bearer token on each
  request and is asked once to refresh on a 401, the 401s that arrive meanwhile sharing that one
  refresh. `Page` is a page of a list.
- `./auth.js`: the `TokenProvider` hook and the `anonymous` default, which sends no token.
- `./router.js`: the router, `createRouter` and `Router`, with `Routes`, `Loader`, and `Match`. It
  mounts each route's element in its outlet, loading its module on the first visit, and the
  `error` option's element when a route fails; it dispatches `change`, `start()` resolves once the
  first route is mounted, and `query()` resolves once `current.query` updates. Its base is the
  `base` option, else the document's `<base href>`, else `/`.
- `./service.js`: the domain-service pattern, `Service`, `Endpoint`, and `ServiceFactory`, as
  types: an app's domains tier writes each service as a stateless object over a `Client`, checked
  with `satisfies Service`.
- `./events.js`: the event-sequence contract, `EventSequence`, read with `ReadOptions` as
  `Delivery`s of `CloudEvent`s, each with the opaque `Cursor` a later read resumes after; and
  `UnknownCursorError`, the one error a read rejects with for a start cursor the sequence never
  gave out, so an app tells a cursor to forget from a failure to retry.
- `./events/nats.js`: `natsSequence`, an `EventSequence` over a JetStream stream of the
  binary-mode CloudEvents go-messaging's NATS broker publishes, read over NATS's WebSocket
  transport. It resumes from a cursor with no gap or duplicate, across a server restart too, and
  asks its `TokenProvider` once to refresh a token the server refuses.
- `./upload.js`: the resumable upload client, `createUploader`, `Uploader`, and `Upload`, for
  [draft-ietf-httpbis-resumable-upload-16](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-resumable-upload-16)
  (`DRAFT_REVISION`) at interop version 11 (`INTEROP_VERSION`), as go-web-sdk's upload handler
  serves it: `create` and `open`, and an `Upload`'s `send` and `cancel`, each resolve to a
  `Result` and never reject.

`./events/nats.js` imports `@nats-io/nats-core` and `@nats-io/jetstream` (`^3.5.0`), the package's
optional peer dependencies: install them only to use that subpath. No other subpath imports them.

`createUploader` takes the API client's `base` and `auth`, `attempts`, how many requests in a row
may fail before an operation gives up, and `delay`, the milliseconds before each repeat. `send`
appends the file in chunks, resuming from the server's offset after a failure, and resolves to the
completing response, decoded as the API client's calls are. An app keeps the upload's `Location`
so that, after a reload, `open` resumes it with the same file, which the user picks again:

```ts
const uploader = createUploader({ attempts: 5, delay: 1000 });
const saved = sessionStorage.getItem("upload");
const upload = saved ? await uploader.open(saved, file) : await uploader.create("/files", file);
if (upload.ok) {
  sessionStorage.setItem("upload", upload.data.location);
  const sent = await upload.data.send<StoredFile>({ progress: (sent, total) => show(sent, total) });
  if (sent.ok) sessionStorage.removeItem("upload");
}
```

`progress` counts the bytes sent, so it drops back to the server's offset after an append fails.
`cancel` deletes the upload; an aborted `send` leaves it to resume.

A server on another origin must expose `Location`, `Upload-Offset`, `Upload-Limit`, and
`Upload-Complete` in `Access-Control-Expose-Headers`. go-web-sdk's handler sets no CORS headers,
so an app on the handler's origin needs nothing.

## Browser support

The runtime targets the browser. The browser floor is Safari 26.2, Firefox 147, and Chromium, set
by the Navigation API, which the router needs with `URLPattern`. `upload` and an
`Upload`'s `send` need `XMLHttpRequest`; where there is none, as on Node, they resolve to the
network problem. The SDK imports no CSS module
script, so a page may also load a release from jsDelivr `/gh/` through an import map in every
browser. The browser tier runs Chromium alone; Firefox and WebKit are untested.

## Development

Tasks run through [mise](https://mise.jdx.dev):

```
mise run install    # the pinned tools, node_modules with the tooling at its tag, and test/server's Go module; reads the network
mise run check      # lint, lint-context, lint-references, types, build, and both test tiers; reads no network
mise run build      # src/ into dist/
mise run currency   # report every pin behind its latest: tools, packages, actions, the tooling's tag, the peer ranges, test/server's Go module, and the upload draft
```

The check runs two test tiers on the build. The unit tier runs under `node --test`: the client
against a loopback server, the event-stream parser, the event-sequence contract suite for an
in-memory sequence and for `natsSequence` against the pinned nats-server, tsc's refusal of runtime
code in a declaration file, the layer's import rules, and a pack of the build. The browser tier
runs the router and the upload in the pinned `chrome-headless-shell`, on the driver and server of
[web-tooling](https://github.com/standards-lab/web-tooling), a devDependency at its release tag,
and the uploader against `test/server`, a Go server over go-web-sdk's upload handler: mise pins
Go, and `mise run install` downloads the server's module.

The check lints with ESLint, Prettier, shellcheck, actionlint, gofmt and go vet on `test/server`,
and marathon's lint-context and lint-references. CI runs `mise run install` and the check on each
pull request to main and each push to it.

[docs/development.md](https://github.com/standards-lab/web-app-sdk/blob/main/docs/development.md)
holds the reasoning behind the configuration and the tests, and
[docs/internals.md](https://github.com/standards-lab/web-app-sdk/blob/main/docs/internals.md)
behind the runtime's implementation.

## Release

A release is an annotated `v<version>` tag on a pack commit: a commit, on no branch, whose tree is
the pack, the build included, and whose one parent is main's merge commit. The version is the one
`package.json` gives and `CHANGELOG.md` has a section for. A person cuts the tag by hand once the
check is green on the merge commit, from a clean checkout with the pins installed:

```
git fetch origin && git switch --detach origin/main
mise run check
tag=v$(node -p 'require("./package.json").version')
scratch=$(mktemp -d)
pnpm pack --pack-destination "$scratch"
tar -xzf "$scratch"/*.tgz -C "$scratch"
# The pack's package/ as a tree, through an index of its own, so the checkout's index and
# .gitignore (which ignores dist/) play no part; --force keeps any other ignore rule from
# dropping a file.
GIT_INDEX_FILE="$scratch/index" git --work-tree="$scratch/package" add --all --force .
tree=$(GIT_INDEX_FILE="$scratch/index" git write-tree)
commit=$(git commit-tree "$tree" -p HEAD -m "web-app-sdk $tag")
git tag -a "$tag" -m "web-app-sdk $tag" "$commit"
git push origin "refs/tags/$tag"
gh workflow run release.yml -f tag="$tag"
```

The release workflow is dispatched by hand with the tag, not run by the push: GitHub reads a tag
push's workflows from the tagged tree, and the pack commit's tree holds only the pack, so the
workflow runs from main's copy. It checks that the tag's commit has one parent, a merge commit on
main, whose `package.json` version the tag names; runs the check on that parent; packs it and holds
the tag's tree to the pack, file for file; and creates the GitHub release from the version's
`CHANGELOG.md` section, with the tarball attached.

## Provenance

The package's lineage is in the workspace's [references catalog](https://github.com/standards-lab/org/blob/main/references.md).

## License

[Apache License 2.0](LICENSE).
