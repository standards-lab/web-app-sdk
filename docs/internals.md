# Internals

This page holds the reasoning behind the runtime's implementation, beside the contract its doc
comments state. The [README](../README.md#use) lists what each subpath exports.

## API client

`src/api.ts` sends a call and a stream over fetch and an upload over XMLHttpRequest, whose progress
fetch doesn't report. The code the uploader shares with it is in the internal `src/transport.ts`:
the token's authorizer, the path join, the XMLHttpRequest send, the problems, and the decoding of
a response. Every request goes through the authorizer, which sends it with the provider's token
and, after a 401, once more with the refreshed token. The client holds the refresh pending,
and every 401 that arrives meanwhile awaits it rather than starting its own. A provider that
rejects is treated as having no token, so the client never rejects for it.

- **Paths.** A path joins the base by text, with one `/`, because URL resolution drops the base's
  path for a path that begins with `/`.
- **Bodies.** A FormData, Blob, ArrayBuffer or view, or URLSearchParams body is sent as it is; any
  other is sent as JSON. `JSON.stringify`'s type claims a string, but it gives `undefined` for a
  function or a symbol, so both that and a throw become the encode problem, before anything is
  sent; it is the problem even under a signal that has since aborted.
- **Upload.** One send of an upload resolves to its response as a `Response`, so it decodes, and
  makes its problem, as fetch's does, and rejects as fetch does: with the signal's reason when the
  signal aborts it, and with a TypeError when the network fails. `loadstart` reports 0 as each
  send starts, a retry's too, and `load` the total once the whole body is sent. A listener on
  `xhr.upload` makes a cross-origin upload preflighted.
- **Streams.** However a stream's loop ends, a break or a throw in it included, its body is
  cancelled. A body read to its end, or one that failed, has nothing left to cancel, and a cancel
  that rejects has no caller to tell, so its rejection is dropped.
- **Problems.** A failing response's problem document keeps every member; a document that doesn't
  parse becomes the `about:blank` problem. `AbortSignal.timeout` aborts with a DOMException named
  `TimeoutError`, which becomes the timeout problem; any other reason is the caller's abort.

## Router

`src/router.ts` intercepts navigations through the Navigation API's navigate event and matches them
with URLPattern, with no matcher of its own.

- **Base.** The base escapes into each pattern so URLPattern reads each of its characters as
  itself.
- **Turns.** Each mount takes the next turn and commits only while it is the latest, so a slow
  loader never overwrites a later navigation's element.
- **Query changes.** The router keeps the pathname whose element is mounted: a navigation that
  keeps it changes only the query, so the element, focus, and scroll stay. It is undefined before
  the first mount and after a failed one, so either mounts.
- **navigate().** `navigate()` loads the route before it navigates and passes the loaded element in
  the navigation's info, so its navigate event mounts that rather than loading it again. Unstarted,
  nothing would intercept the navigation, and the browser would load the page, so it throws.
- **Left to the browser.** A reload reloads the page, which starts its router again; a download, a
  fragment-only change, and a form post are the browser's too.
- **Failures.** When an intercepted navigation's route fails, the URL is already committed: the
  error element stands in for the route, and the rejection fails the navigation (navigateerror).
  The error element failing too leaves the outlet empty.
- **Params.** Only named groups become params: an unnamed group's key is its index, never an
  attribute's name, and an optional group that didn't match is undefined.

## Uploader

`src/upload.ts` implements draft-ietf-httpbis-resumable-upload-16 at interop version 11, the
revision go-web-sdk v0.19.0's upload handler serves; `DRAFT_REVISION` names it so `mise run
currency` can tell when the draft moves on. Each upload is an `Upload` whose state is the server's
offset, whether that offset is known, the max-append-size the server last announced, and the
completion's Result once one arrives.

- **SHA-256.** The creation carries the whole file's SHA-256 as Repr-Digest, and each append its
  chunk's as Content-Digest. `src/sha256.ts` is the SDK's own, fed a piece at a time: SubtleCrypto's
  `digest` takes the whole input at once, so a large file would be held in memory whole, and it
  exists only in a secure context, where an app on plain HTTP has none. A library for it would be
  the SDK's one runtime dependency. `create` reads the file in 4 MiB `Blob.slice` pieces.
- **Fields.** The draft's headers are RFC 9651 Structured Fields: Upload-Offset and Upload-Length
  Integers, Upload-Complete a Boolean, Upload-Limit a Dictionary of Integers, and the digests
  Dictionaries of Byte Sequences. `src/fields.ts` reads and writes the types the draft uses and
  nothing else. A field that doesn't parse reads as absent, as the draft has a receiver ignore it;
  an Upload-Limit with an invalid defined member, or a minimum above its maximum, is ignored whole
  rather than read in part.
- **Retries.** An append that gets no response, a 429, or a 5xx leaves the offset unknown: the
  server may have committed some of it. The next try reads the offset with a HEAD and resumes from
  there, so nothing is sent twice and nothing skipped. A 409 names the offset in its Upload-Offset,
  which the next append starts from, and a HEAD reads it when it doesn't. A 413 whose Upload-Limit
  shrinks the max-append-size below the chunk resends a smaller one. Each failure that advances
  nothing counts against `attempts`, and an append the server commits starts the count again, so a
  long upload over a flaky network goes on while it makes progress and gives up only when it
  stops. `delay` is waited before each repeat. Any other failing status is final: the server has
  told the client the request is wrong, and repeating it would be wrong again.
- **One request in flight.** An `Upload` queues its sends and cancels and runs one at a time, so
  no two appends race for the same offset and no HEAD reads an offset an append in flight is
  moving.
- **Completion.** The response that completes the upload is remembered, and a later `send`
  resolves to it without a request: go-web-sdk's handler deletes an upload once it completes, so a
  HEAD would only answer 404. A HEAD that says the upload is complete means its completion's
  response was lost, which the client can't recover, so it is the decode problem.
- **Progress.** `progress` reports the server's offset plus what has gone of the append in flight,
  the bytes sent rather than the bytes committed, so the bar moves during a chunk. After an append
  that fails, the next report drops back to the offset the server holds.
- **XMLHttpRequest.** Appends go over XMLHttpRequest, not fetch: fetch reports no upload progress,
  and a streamed request body, which could count its own bytes, needs HTTP/2 and half-duplex
  support a server may not give. fetch also never shows an informational response, so the draft's
  104 (Upload Resumption Supported) interim responses are invisible to either API; the client
  relies on the final response's headers alone. The creation, the HEAD, and the DELETE carry no
  content and go over fetch.
- **Open.** `open` sends no whole-file digest: the server checks the creation's Repr-Digest when
  the upload completes, so a different file fails there with the server's problem, rather than the
  client hashing the whole file again before it resumes.

## Event-stream parser

`src/eventstream.ts` is written here so the SDK takes no dependency for it. Its decoder keeps the
BOM (`ignoreBOM`), so the parser strips it itself, only at the stream's start, as the standard
says. A chunk that ends with CR leaves the parser waiting to drop an LF that begins the next, the
end of that CRLF. Any field the format doesn't name is ignored.

## NATS adapter

`src/events/nats.ts` reads go-core v0.10.0's binary content mode: the context attributes ride as
`ce-*` headers, `datacontenttype` in `content-type`, and any other `ce-*` header is an extension.
Data decodes with a fatal TextDecoder, so a byte sequence that isn't the charset's fails rather
than decoding as U+FFFD.

The reads share one connection; a failed open is forgotten, so the next read tries again. The
token the connection presents is read on every connect, and refreshed once when the server refuses
it. When the connection closes other than by `close()`, every read fails, and the next read
reconnects.

A cursor past the stream's last sequence is one the adapter never wrote. One at or below it is
accepted whether or not the stream still keeps its message: the server starts the consumer at the
oldest kept. Only a read with a cursor pays for the stream info request. A read checks its signal
and `close()` again once its consumer is made, since either may have ended it meanwhile.
