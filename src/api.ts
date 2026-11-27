// The application SDK's API client: the problem, the result, the page, the server-sent event, the
// client's options and shape, and createClient. Every call resolves to a Result and never
// rejects; a stream's events, read after it resolves, are the one place an error is thrown.

import type { TokenProvider } from "./auth.ts";
import { anonymous } from "./auth.ts";
import { EventStreamParser } from "./eventstream.ts";
import {
  authorizer,
  failure,
  join,
  mediaType,
  problem,
  transmit,
  Unencodable,
} from "./transport.ts";

/** An RFC 9457 problem document, as go-web-sdk's Problem writes it, with `title` always present:
 * go-web-sdk's Write defaults it to the status phrase, but omits it for a status outside net/http's
 * table, where the client fills it. `detail` and `instance` are omitted when empty, and
 * `request_id` is present when the server's request carried a correlation id. */
export interface Problem {
  /** A URI naming the problem's kind: "about:blank" for a status with no further meaning, or one
   * of the ClientProblemType URIs for a problem the client made itself. */
  type: string;
  /** The HTTP status; 0 for a problem the client made itself with no response behind it, and the
   * response's status for a 2xx body that didn't decode. */
  status: number;
  title: string;
  detail?: string;
  instance?: string;
  request_id?: string;
  /** Extension members: go-web-sdk merges a Problem's Extras in at the document's top level, and
   * the client keeps every member the document carries. */
  [member: string]: unknown;
}

/** The type of a problem the client makes itself, each with a fixed title. With no response behind
 * it, status 0: the request body isn't encodable as JSON, JSON.stringify throwing on it (a BigInt,
 * a cycle) or giving nothing (a function, a symbol), and nothing is sent ("Request not encodable",
 * with the error's message as its detail when there is one); the request failed in flight (fetch
 * rejected; "Network error"); the caller's signal aborted the call ("Request aborted"); or the
 * signal's timeout (AbortSignal.timeout) fired ("Request timed out"). With the response's status:
 * a 2xx body didn't decode as its content type claims, or a stream's 2xx response isn't
 * text/event-stream ("Response not decodable"). A failing response that isn't a problem document
 * becomes an "about:blank" problem titled with the response's status text, or "HTTP <status>"
 * when that text is empty; a problem document with no title is titled "HTTP <status>". */
export type ClientProblemType =
  | "urn:standards-lab:problem:network"
  | "urn:standards-lab:problem:abort"
  | "urn:standards-lab:problem:timeout"
  | "urn:standards-lab:problem:decode"
  | "urn:standards-lab:problem:encode";

/** One event of a text/event-stream response, as the WHATWG HTML standard parses it: its type,
 * "message" when the stream names none; its data, its data lines joined with "\n"; and the last
 * event id the stream set, when one is set, carried from an earlier event as an EventSource's
 * lastEventId is. A `retry` field is parsed and dropped: the client makes no reconnection. */
export interface ServerSentEvent {
  type: string;
  data: string;
  id?: string;
}

/** The error a stream's events throw when the network fails after the stream resolved, its
 * `problem` the network problem a call would have resolved to. It is the one error the client
 * throws; the caller's signal ends the events quietly instead. */
export class StreamError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail === undefined ? problem.title : `${problem.title}: ${problem.detail}`);
    this.name = "StreamError";
    this.problem = problem;
  }
}

/** A call's outcome: the decoded body, or the problem that stopped it. A body decodes by its content
 * type: JSON (application/json or any +json type) parsed, text/* a string, any other a Blob, and no
 * body (a 204 or 205, or an empty body) undefined. Under TextOptions a body is its text instead,
 * whatever its type, and no body the empty string. */
export type Result<T> = { ok: true; data: T } | { ok: false; problem: Problem };

/** go-web-sdk's paginated read envelope, the whole response body. `page` is the 1-based number of
 * a read addressed by number and `total` the row count when the read counted one; both are absent
 * under a cursor. `next`, when present, is the cursor that continues from this page; `more` with
 * no `next` is a further page reachable only by number. */
export interface Page<T> {
  items: T[];
  page?: number;
  size: number;
  total?: number;
  more: boolean;
  next?: string;
}

/** A call's options: the signal that aborts it, the query parameters set on its URL, and the
 * headers added to its request. A query value is set as its string; an array sets its name once per
 * element, in order; an undefined value is left out. The client sets Authorization itself, over any
 * header of that name here, Content-Type when it sends the body as JSON, and Accept on a stream. */
export interface RequestOptions {
  signal?: AbortSignal;
  query?: Readonly<
    Record<string, string | number | boolean | readonly (string | number | boolean)[] | undefined>
  >;
  headers?: Readonly<Record<string, string>>;
}

/** A call's options with `as: "text"`, which reads a successful body as its text, decoded as UTF-8
 * as Response.text() decodes it, whatever its content type: a JSON body's exact text, its
 * whitespace and key order as stored, rather than its parsed value, and a JSON type's body that
 * doesn't parse is its text, not the decode problem. No body is the empty string. A failing
 * response is its Problem, as without the option. A call given these options takes no type
 * argument: its data is a string. */
export interface TextOptions extends RequestOptions {
  as: "text";
}

/** An upload's options: a call's, the method, POST by default or PUT, and `progress`, called with
 * the bytes of the body sent and its total as the body goes out: at 0 when each send starts, a
 * retry's included, then as bytes are sent, and at the total once the whole body is sent. The
 * total is 0 when the browser can't compute it. A `progress` callback makes a cross-origin upload a
 * preflighted request. */
export interface UploadOptions extends RequestOptions {
  method?: "POST" | "PUT";
  progress?: (sent: number, total: number) => void;
}

/** How a client is made: the base every path joins under ("/api" by default), and the token
 * provider whose token each call carries (anonymous by default). The base may be an absolute URL,
 * on another origin. A path joins the base with one "/" whether or not it begins with one: under
 * "/api", "documents/5" and "/documents/5" both give "/api/documents/5", where URL resolution would
 * drop "/api" for the second. */
export interface ClientOptions {
  base?: string;
  auth?: TokenProvider;
}

/** The API client. Each method sends the path, joined under the base, with
 * `Authorization: Bearer <token>` when the provider has a token and none when it doesn't. On a 401
 * it asks the provider to refresh and retries once with the refreshed token, or returns the 401's
 * problem when the refresh gives none; 401s that arrive while a refresh is pending share that one
 * refresh. A FormData, Blob, ArrayBuffer or view, or URLSearchParams body is sent as it is; any
 * other body is sent as JSON.
 *
 * `get`, `post`, `put`, `patch`, and `delete` each read a successful body as text under
 * TextOptions, and decode it by its content type otherwise.
 *
 * `stream` sends a POST with the body when it is given one and a GET when it isn't, with
 * `Accept: text/event-stream`, and resolves when the response's headers arrive, before its first
 * event: to the problem, as any call's, or to the events, read as they arrive. A 2xx response that
 * isn't text/event-stream is the decode problem. The caller's signal ends the events quietly; the
 * network failing throws a StreamError; and leaving the loop early cancels the response.
 *
 * `upload` sends the body over XMLHttpRequest, as any call's body is sent, reporting its progress,
 * and resolves as any call does, its data decoded and its problems made the same way. Where there
 * is no XMLHttpRequest (on Node, say) it resolves to the network problem. */
export interface Client {
  get(path: string, options: TextOptions): Promise<Result<string>>;
  get<T>(path: string, options?: RequestOptions): Promise<Result<T>>;
  post(path: string, body: unknown, options: TextOptions): Promise<Result<string>>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<Result<T>>;
  put(path: string, body: unknown, options: TextOptions): Promise<Result<string>>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<Result<T>>;
  patch(path: string, body: unknown, options: TextOptions): Promise<Result<string>>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<Result<T>>;
  delete(path: string, options: TextOptions): Promise<Result<string>>;
  delete<T>(path: string, options?: RequestOptions): Promise<Result<T>>;
  stream(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<Result<AsyncIterable<ServerSentEvent>>>;
  upload<T>(path: string, body: unknown, options?: UploadOptions): Promise<Result<T>>;
}

/** Makes a client. */
export function createClient(options: ClientOptions = {}): Client {
  const base = options.base ?? "/api";
  const authorize = authorizer(options.auth ?? anonymous);

  async function respond(
    path: string,
    body: unknown,
    request: RequestOptions,
    send: (
      url: string,
      headers: Headers,
      payload: XMLHttpRequestBodyInit | undefined,
    ) => Promise<Response>,
    accept?: string,
  ): Promise<Response> {
    const url = join(base, path, request.query);
    const headers = new Headers(request.headers);
    if (accept !== undefined) headers.set("Accept", accept);
    const payload = encode(body, headers);
    return authorize(headers, () => send(url, headers, payload));
  }

  function fetched(
    method: string,
    path: string,
    body: unknown,
    request: RequestOptions,
    accept?: string,
  ): Promise<Response> {
    const send = (url: string, headers: Headers, payload: BodyInit | undefined) =>
      fetch(url, { method, headers, body: payload, signal: request.signal });
    return respond(path, body, request, send, accept);
  }

  async function call<T>(
    method: string,
    path: string,
    body: unknown,
    request: Partial<TextOptions> = {},
  ): Promise<Result<T>> {
    try {
      return await decode<T>(await fetched(method, path, body, request), request.as);
    } catch (error) {
      return { ok: false, problem: failure(error, request.signal) };
    }
  }

  async function stream(
    path: string,
    body: unknown,
    request: RequestOptions = {},
  ): Promise<Result<AsyncIterable<ServerSentEvent>>> {
    const method = body === undefined ? "GET" : "POST";
    try {
      const response = await fetched(method, path, body, request, "text/event-stream");
      if (!response.ok) return { ok: false, problem: await problem(response) };
      const type = mediaType(response);
      if (type !== "text/event-stream" || response.body === null) {
        await response.body?.cancel();
        return {
          ok: false,
          problem: {
            type: "urn:standards-lab:problem:decode",
            status: response.status,
            title: "Response not decodable",
            detail: `${type || "no content type"} is not text/event-stream`,
          },
        };
      }
      return { ok: true, data: events(response.body, request.signal) };
    } catch (error) {
      return { ok: false, problem: failure(error, request.signal) };
    }
  }

  async function upload<T>(
    path: string,
    body: unknown,
    request: UploadOptions = {},
  ): Promise<Result<T>> {
    try {
      if (typeof XMLHttpRequest === "undefined") {
        throw new TypeError("XMLHttpRequest is not available here; upload needs a browser");
      }
      const method = request.method ?? "POST";
      const send = (url: string, headers: Headers, payload: XMLHttpRequestBodyInit | undefined) =>
        transmit(method, url, headers, payload, request);
      return await decode<T>(await respond(path, body, request, send));
    } catch (error) {
      return { ok: false, problem: failure(error, request.signal) };
    }
  }

  return {
    get: <T>(path: string, options?: Partial<TextOptions>) =>
      call<T>("GET", path, undefined, options),
    post: <T>(path: string, body?: unknown, options?: Partial<TextOptions>) =>
      call<T>("POST", path, body, options),
    put: <T>(path: string, body?: unknown, options?: Partial<TextOptions>) =>
      call<T>("PUT", path, body, options),
    patch: <T>(path: string, body?: unknown, options?: Partial<TextOptions>) =>
      call<T>("PATCH", path, body, options),
    delete: <T>(path: string, options?: Partial<TextOptions>) =>
      call<T>("DELETE", path, undefined, options),
    stream: (path, body, options) => stream(path, body, options),
    upload: (path, body, options) => upload(path, body, options),
  };
}

async function* events(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncGenerator<ServerSentEvent, void, undefined> {
  const reader = body.getReader();
  const parser = new EventStreamParser();
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal?.aborted) return;
        throw new StreamError(failure(error, undefined));
      }
      if (chunk.done) break;
      yield* parser.push(chunk.value);
    }
    yield* parser.end();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function encode(body: unknown, headers: Headers): XMLHttpRequestBodyInit | undefined {
  if (body === undefined) return undefined;
  if (
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof URLSearchParams
  ) {
    return body as XMLHttpRequestBodyInit;
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(body);
  } catch (error) {
    throw new Unencodable(error instanceof Error ? error.message : String(error));
  }
  if (json === undefined) throw new Unencodable();
  headers.set("Content-Type", "application/json");
  return json;
}

function isJSON(type: string): boolean {
  return type === "application/json" || type.endsWith("+json");
}

async function decode<T>(response: Response, as?: "text"): Promise<Result<T>> {
  if (!response.ok) return { ok: false, problem: await problem(response) };
  if (as === "text") return { ok: true, data: (await response.text()) as T };
  const type = mediaType(response);
  const blob = await response.blob();
  if (response.status === 204 || response.status === 205 || blob.size === 0) {
    return { ok: true, data: undefined as T };
  }
  if (isJSON(type)) {
    const text = await blob.text();
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch (error) {
      return {
        ok: false,
        problem: {
          type: "urn:standards-lab:problem:decode",
          status: response.status,
          title: "Response not decodable",
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
  if (type.startsWith("text/")) return { ok: true, data: (await blob.text()) as T };
  return { ok: true, data: blob as T };
}
