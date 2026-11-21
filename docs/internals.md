# Internals

This page holds the reasoning behind the runtime's implementation, beside the contract its doc
comments state. The [README](../README.md#use) lists what each subpath exports.

## API client

`src/api.ts` sends a call and a stream over fetch and an upload over XMLHttpRequest, whose progress
fetch doesn't report. Every request goes through one function that sends it with the provider's
token and, after a 401, once more with the refreshed token. The client holds the refresh pending,
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
