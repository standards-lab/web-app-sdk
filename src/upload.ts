// The application SDK's resumable upload client, for draft-ietf-httpbis-resumable-upload-16 at
// Upload-Draft-Interop-Version 11: DRAFT_REVISION, INTEROP_VERSION, the uploader's options and
// shape, the upload it creates or opens, sends, and cancels, and createUploader. Every operation resolves to
// a Result and never rejects; a failure is the server's problem document or one of the client's
// own problems, as the API client's are.
// See https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-resumable-upload-16

import type { Problem, Result } from "./api.ts";
import type { TokenProvider } from "./auth.ts";
import { anonymous } from "./auth.ts";
import {
  formatBoolean,
  formatDigest,
  formatInteger,
  parseComplete,
  parseLimit,
  parseOffset,
} from "./fields.ts";
import { Sha256 } from "./sha256.ts";
import { authorizer, decode, failure, join, problem, transmit } from "./transport.ts";

/** The revision of draft-ietf-httpbis-resumable-upload the uploader implements. */
export const DRAFT_REVISION = 16;

/** The Upload-Draft-Interop-Version that draft revision DRAFT_REVISION assigns, which every
 * request to an upload carries. */
export const INTEROP_VERSION = 11;

/** How an uploader is made: the base every path joins under ("/api" by default), as the API
 * client's does; the token provider whose bearer token every request carries (anonymous by
 * default), refreshed once on a 401 as the API client's is; `attempts`, how many requests in a row
 * may fail to advance an operation before it gives up, a positive integer; `delay`, the
 * milliseconds the uploader waits before each repeat, 0 repeating at once; and `chunkSize`, when given, the most
 * bytes one append carries, a positive integer. */
export interface UploaderOptions {
  base?: string;
  auth?: TokenProvider;
  attempts: number;
  delay: number;
  chunkSize?: number;
}

/** An operation's options: the signal that aborts it. */
export interface UploadRequestOptions {
  signal?: AbortSignal;
}

/** A send's options: an operation's, and `progress`, called with the bytes sent of the file and the
 * file's size as each append's content goes out: at each append's start, as its bytes are sent,
 * and once all of them are sent. The bytes sent are the server's offset and what has gone of the
 * append in flight, so after an append that fails a later report drops back to the server's
 * offset. Hashing a chunk reports nothing. */
export interface SendOptions extends UploadRequestOptions {
  progress?: (sent: number, total: number) => void;
}

/** One upload resource an uploader created. `location` is its absolute URL, which the creation's
 * response named.
 *
 * `send` appends the rest of the file from the server's offset, the offset the Upload holds, one
 * append at a time. Each append is a PATCH of a chunk no larger than the max-append-size the server
 * last announced in an Upload-Limit nor the uploader's `chunkSize`, with Content-Type
 * application/partial-upload, Upload-Offset, the chunk's SHA-256 as Content-Digest's sha-256
 * member, Upload-Complete: ?1 on the last and ?0 on the rest, Upload-Draft-Interop-Version, and the
 * bearer token as `create`'s requests carry it. Each response that carries a valid Upload-Limit
 * announces its max-append-size. A 2xx to an append that doesn't complete moves the offset to its
 * Upload-Offset, or past the chunk when it carries none. An Upload-Offset that isn't past the
 * offset or is past the chunk's end, or a 2xx to the last append that doesn't complete the upload,
 * is the decode problem.
 *
 * After an append that gets no response, a 429, or a 5xx, `send` reads the server's offset with a
 * HEAD, carrying Upload-Draft-Interop-Version and the bearer token, and resumes from it; a 409
 * resumes from the Upload-Offset it carries, or from a HEAD when it carries no valid one; a 413
 * whose Upload-Limit announces a max-append-size below the chunk resends a smaller one. A HEAD that
 * gets no response, a 429, or a 5xx is repeated. Each of these failures counts against the
 * uploader's `attempts`, an append the server commits starts the count again, and `send` waits the
 * uploader's `delay` before each repeat. When the attempts run out, `send` resolves to the last
 * failure's problem and leaves the upload on the server, and a later `send` resumes it from a
 * HEAD. A HEAD's 2xx whose Upload-Offset is absent, malformed, or past the file's size, whose
 * Upload-Complete is malformed, or whose Upload-Complete is ?1, the completion's response lost, is
 * the decode problem. Any other failing response to a HEAD is its problem, a 404 among them when
 * the server no longer has the upload.
 *
 * The response that completes the upload, one whose Upload-Complete is ?1 or a 2xx without
 * Upload-Complete to the last append, resolves as the API client's calls do: its body decoded by
 * its content type, or its problem when its status is a 4xx or 5xx, which nothing repeats. A later
 * `send` resolves to that same Result and sends nothing. Any other failing response to an append
 * is its problem, and the offset stays where the server last confirmed it, for a later send to
 * continue from. Where there is no XMLHttpRequest it resolves to the network problem. The signal
 * aborting, while it reads, hashes, sends, or waits, is the abort problem, or the timeout problem
 * for AbortSignal.timeout, and a later `send` resumes from a HEAD.
 *
 * `cancel` sends a DELETE of the upload, carrying Upload-Draft-Interop-Version and the bearer
 * token, and resolves to undefined on a 2xx and to the response's problem otherwise; a later `send`
 * reads the offset with a HEAD, a 404 problem once the upload is deleted. The signal aborting the
 * DELETE is the abort problem, or the timeout problem for AbortSignal.timeout, and the upload stays
 * as the server holds it.
 *
 * The Upload sends one request at a time: a send or cancel made while another runs starts once that
 * one settles, and no HEAD goes out while another of its requests is in flight. */
export interface Upload {
  readonly location: string;
  send<T>(options?: SendOptions): Promise<Result<T>>;
  cancel(options?: UploadRequestOptions): Promise<Result<undefined>>;
}

/** The uploader. `create` creates the upload resource for a file at the path, joined under the
 * base, and resolves to the Upload with nothing of the file sent yet, at the 201's Upload-Offset or
 * 0 when it carries no valid one, and with the max-append-size its valid Upload-Limit announces.
 * `open` resolves to the Upload of a resource an earlier `create` made, at the server's offset.
 *
 * `create` hashes the whole file with SHA-256, reading it a piece at a time and never holding it
 * whole, then sends a POST with no content carrying Upload-Complete: ?0, the file's size as
 * Upload-Length, its SHA-256 as Repr-Digest's sha-256 member, its type as Content-Type when it has
 * one, its name as Content-Disposition's filename when it is a File with a name, and
 * Upload-Draft-Interop-Version. A 2xx with a Location names the upload; a 2xx without a valid one,
 * or with an Upload-Offset past the file's size, is the decode problem. When no response arrives,
 * or the response is a 429 or a 5xx, it waits the delay and repeats the creation, within the
 * attempts, and resolves to the last failure's problem once they run out; any other failing
 * response is its problem. The signal aborting, while it hashes, sends, or waits, is the abort
 * problem, or the timeout problem for AbortSignal.timeout.
 *
 * `open` takes the upload's location, which a relative URL names against the page as `create`'s
 * Location does, and the file the creation was for, which the app kept, and reads the server's
 * offset with a HEAD as `send` does, carrying Upload-Draft-Interop-Version and the bearer token.
 * It sends no digest of the whole file; the server checks the creation's Repr-Digest when the
 * upload completes, and a file other than the creation's fails the completion with the server's
 * problem. A HEAD that gets no response, a 429, or a 5xx is repeated, within the attempts
 * and after the delay, and `open` resolves to the last failure's problem once they run out. A 2xx
 * resolves to the Upload at its Upload-Offset, with the max-append-size its valid Upload-Limit
 * announces, and is the decode problem when its Upload-Offset is absent, malformed, or past the
 * file's size, or its Upload-Complete is malformed or ?1. Any other failing response is its
 * problem, the 404 problem when the server no longer has the upload. A location that isn't a URL
 * is the network problem. The signal aborting, while it sends or waits, is the abort problem, or
 * the timeout problem for AbortSignal.timeout. */
export interface Uploader {
  create(path: string, file: Blob, options?: UploadRequestOptions): Promise<Result<Upload>>;
  open(location: string, file: Blob, options?: UploadRequestOptions): Promise<Result<Upload>>;
}

const PIECE = 4 * 1024 * 1024;

/** Makes an uploader. Throws a RangeError when `attempts` isn't a positive integer, `delay` isn't a
 * non-negative number, or a given `chunkSize` isn't a positive integer. */
export function createUploader(options: UploaderOptions): Uploader {
  const { attempts, delay, chunkSize } = options;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(`attempts ${attempts} is not a positive integer`);
  }
  if (!(delay >= 0)) throw new RangeError(`delay ${delay} is not a non-negative number`);
  if (chunkSize !== undefined && (!Number.isInteger(chunkSize) || chunkSize < 1)) {
    throw new RangeError(`chunkSize ${chunkSize} is not a positive integer`);
  }
  const base = options.base ?? "/api";
  const authorize = authorizer(options.auth ?? anonymous);

  function request(
    method: string,
    url: string,
    headers: Headers,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    headers.set("Upload-Draft-Interop-Version", String(INTEROP_VERSION));
    return authorize(headers, () => fetch(url, { method, headers, signal }));
  }

  function transmitted(
    url: string,
    headers: Headers,
    payload: Uint8Array<ArrayBuffer>,
    signal: AbortSignal | undefined,
    progress: ((sent: number, total: number) => void) | undefined,
  ): Promise<Response> {
    headers.set("Upload-Draft-Interop-Version", String(INTEROP_VERSION));
    return authorize(headers, () => transmit("PATCH", url, headers, payload, { signal, progress }));
  }

  async function create(
    path: string,
    file: Blob,
    { signal }: UploadRequestOptions = {},
  ): Promise<Result<Upload>> {
    try {
      const url = join(base, path);
      const headers = new Headers({
        "Upload-Complete": formatBoolean(false),
        "Upload-Length": formatInteger(file.size),
        "Repr-Digest": formatDigest(await hash(file, signal)),
      });
      if (file.type) headers.set("Content-Type", file.type);
      if (file instanceof File && file.name) {
        headers.set("Content-Disposition", disposition(file.name));
      }
      for (let failures = 1; ; failures++) {
        let response: Response;
        try {
          response = await request("POST", url, headers, signal);
        } catch (error) {
          if (signal?.aborted || failures >= attempts) throw error;
          await pause(delay, signal);
          continue;
        }
        if (response.ok) return located(response, url, file);
        if (!retryable(response.status) || failures >= attempts) {
          return { ok: false, problem: await problem(response) };
        }
        await response.body?.cancel();
        await pause(delay, signal);
      }
    } catch (error) {
      return { ok: false, problem: failure(error, signal) };
    }
  }

  async function located(response: Response, url: string, file: Blob): Promise<Result<Upload>> {
    await response.body?.cancel();
    const named = response.headers.get("Location");
    let location: URL | undefined;
    try {
      if (named) location = new URL(named, response.url || new URL(url, globalThis.location?.href));
    } catch {}
    if (location === undefined) {
      return undecodable(response, `the creation's ${response.status} named no valid Location`);
    }
    const offset = parseOffset(response.headers.get("Upload-Offset")) ?? 0;
    if (offset > file.size) {
      return undecodable(
        response,
        `the creation's ${response.status} named Upload-Offset ${offset}, past the file's ${file.size} bytes`,
      );
    }
    const limit = parseLimit(response.headers.get("Upload-Limit"))?.maxAppendSize;
    return { ok: true, data: upload(location.href, file, offset, limit).handle };
  }

  async function open(
    location: string,
    file: Blob,
    { signal }: UploadRequestOptions = {},
  ): Promise<Result<Upload>> {
    try {
      const url = new URL(location, globalThis.location?.href);
      return await upload(url.href, file, undefined, undefined).locate(signal);
    } catch (error) {
      return { ok: false, problem: failure(error, signal) };
    }
  }

  function upload(
    location: string,
    file: Blob,
    start: number | undefined,
    limit: number | undefined,
  ): { handle: Upload; locate: (signal: AbortSignal | undefined) => Promise<Result<Upload>> } {
    let pending: Promise<unknown> = Promise.resolve();
    let offset = start ?? 0;
    let known = start !== undefined;
    let finished: Result<unknown> | undefined;

    async function append<T>(
      signal: AbortSignal | undefined,
      progress: ((sent: number, total: number) => void) | undefined,
    ): Promise<Step<T>> {
      const from = offset;
      const size = Math.min(file.size - from, limit ?? Infinity, chunkSize ?? Infinity);
      const last = from + size === file.size;
      const chunk = new Uint8Array(await file.slice(from, from + size).arrayBuffer());
      signal?.throwIfAborted();
      const sha = new Sha256();
      sha.update(chunk);
      const headers = new Headers({
        "Content-Type": "application/partial-upload",
        "Upload-Offset": formatInteger(from),
        "Upload-Complete": formatBoolean(last),
        "Content-Digest": formatDigest(sha.digest()),
      });
      const reported =
        progress === undefined ? undefined : (sent: number) => progress(from + sent, file.size);
      let response: Response;
      try {
        response = await transmitted(location, headers, chunk, signal, reported);
      } catch (error) {
        known = false;
        if (signal?.aborted) throw error;
        return { kind: "failed", problem: failure(error, signal) };
      }
      if (completes(response, last)) {
        finished = await decode<T>(response);
        return { kind: "settled", result: finished as Result<T> };
      }
      limit = parseLimit(response.headers.get("Upload-Limit"))?.maxAppendSize ?? limit;
      if (!response.ok) {
        const failed: Step<T> = { kind: "failed", problem: await problem(response) };
        if (response.status === 409) {
          const at = parseOffset(response.headers.get("Upload-Offset"));
          if (at !== undefined && at <= file.size) offset = at;
          else known = false;
          return failed;
        }
        if (response.status === 413 && limit !== undefined && limit < size) return failed;
        if (retryable(response.status)) {
          known = false;
          return failed;
        }
        return { kind: "settled", result: { ok: false, problem: failed.problem } };
      }
      await response.body?.cancel();
      if (last) {
        return settled(
          undecodable(response, `the last append's ${response.status} left the upload open`),
        );
      }
      const field = response.headers.get("Upload-Offset");
      const next = field === null ? from + size : parseOffset(field);
      if (next === undefined || next <= from || next > from + size) {
        return settled(
          undecodable(
            response,
            `the append's ${response.status} named Upload-Offset ${field}, outside ${from + 1}..${from + size}`,
          ),
        );
      }
      offset = next;
      return { kind: "advanced" };
    }

    async function head<T>(signal: AbortSignal | undefined): Promise<Step<T>> {
      let response: Response;
      try {
        response = await request("HEAD", location, new Headers(), signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        return { kind: "failed", problem: failure(error, signal) };
      }
      if (!response.ok) {
        const failed = await problem(response);
        if (retryable(response.status)) return { kind: "failed", problem: failed };
        return { kind: "settled", result: { ok: false, problem: failed } };
      }
      await response.body?.cancel();
      const completeField = response.headers.get("Upload-Complete");
      const complete = parseComplete(completeField);
      if (completeField !== null && complete === undefined) {
        return settled(
          undecodable(
            response,
            `the HEAD's ${response.status} named Upload-Complete ${completeField}`,
          ),
        );
      }
      if (complete === true) {
        return settled(
          undecodable(
            response,
            `the HEAD's ${response.status} named the upload complete, its completion's response lost`,
          ),
        );
      }
      const field = response.headers.get("Upload-Offset");
      const at = parseOffset(field);
      if (at === undefined || at > file.size) {
        return settled(
          undecodable(
            response,
            `the HEAD's ${response.status} named Upload-Offset ${field}, outside 0..${file.size}`,
          ),
        );
      }
      limit = parseLimit(response.headers.get("Upload-Limit"))?.maxAppendSize ?? limit;
      offset = at;
      known = true;
      return { kind: "located" };
    }

    async function sent<T>({ signal, progress }: SendOptions): Promise<Result<T>> {
      if (finished !== undefined) return finished as Result<T>;
      try {
        if (typeof XMLHttpRequest === "undefined") {
          throw new TypeError("XMLHttpRequest is not available here; send needs a browser");
        }
        for (let failures = 0; ;) {
          const step = known ? await append<T>(signal, progress) : await head<T>(signal);
          switch (step.kind) {
            case "settled":
              return step.result;
            case "advanced":
              failures = 0;
              break;
            case "failed":
              if (++failures >= attempts) {
                known = false;
                return { ok: false, problem: step.problem };
              }
              await pause(delay, signal);
          }
        }
      } catch (error) {
        return { ok: false, problem: failure(error, signal) };
      }
    }

    async function cancelled({ signal }: UploadRequestOptions): Promise<Result<undefined>> {
      try {
        const response = await request("DELETE", location, new Headers(), signal);
        if (!response.ok) return { ok: false, problem: await problem(response) };
        await response.body?.cancel();
        return { ok: true, data: undefined };
      } catch (error) {
        return { ok: false, problem: failure(error, signal) };
      } finally {
        known = false;
      }
    }

    function queued<R>(run: () => Promise<R>): Promise<R> {
      const next = pending.then(run);
      pending = next;
      return next;
    }

    const handle: Upload = Object.freeze({
      location,
      send: <T>(options: SendOptions = {}) => queued(() => sent<T>(options)),
      cancel: (options: UploadRequestOptions = {}) => queued(() => cancelled(options)),
    });

    async function locate(signal: AbortSignal | undefined): Promise<Result<Upload>> {
      for (let failures = 1; ; failures++) {
        const step = await head<Upload>(signal);
        switch (step.kind) {
          case "located":
            return { ok: true, data: handle };
          case "settled":
            return step.result;
          case "failed":
            if (failures >= attempts) return { ok: false, problem: step.problem };
            await pause(delay, signal);
        }
      }
    }

    return { handle, locate };
  }

  return { create, open };
}

type Step<T> =
  | { kind: "settled"; result: Result<T> }
  | { kind: "advanced" }
  | { kind: "located" }
  | { kind: "failed"; problem: Problem };

function settled<T>(result: Result<T>): Step<T> {
  return { kind: "settled", result };
}

function undecodable(response: Response, detail: string): { ok: false; problem: Problem } {
  return {
    ok: false,
    problem: {
      type: "urn:standards-lab:problem:decode",
      status: response.status,
      title: "Response not decodable",
      detail,
    },
  };
}

function completes(response: Response, last: boolean): boolean {
  const field = response.headers.get("Upload-Complete");
  return field === null ? last && response.ok : parseComplete(field) === true;
}

async function hash(file: Blob, signal: AbortSignal | undefined): Promise<Uint8Array> {
  const sha = new Sha256();
  for (let at = 0; at < file.size; at += PIECE) {
    signal?.throwIfAborted();
    sha.update(new Uint8Array(await file.slice(at, at + PIECE).arrayBuffer()));
  }
  signal?.throwIfAborted();
  return sha.digest();
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function pause(delay: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function disposition(name: string): string {
  if (/^[\x20-\x7e]*$/.test(name)) {
    return `attachment; filename="${name.replace(/["\\]/g, "\\$&")}"`;
  }
  const encoded = [...new TextEncoder().encode(name)]
    .map((byte) =>
      /[A-Za-z0-9!#$&+\-.^_`|~]/.test(String.fromCharCode(byte))
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`,
    )
    .join("");
  return `attachment; filename*=utf-8''${encoded}`;
}
