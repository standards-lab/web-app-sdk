// The application SDK's resumable upload client, for draft-ietf-httpbis-resumable-upload-16 at
// Upload-Draft-Interop-Version 11: DRAFT_REVISION, INTEROP_VERSION, the uploader's options and
// shape, the upload it creates, and createUploader. Every operation resolves to a Result and never
// rejects; a failure is the server's problem document or one of the client's own problems, as the
// API client's are.
// See https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-resumable-upload-16

import type { Result } from "./api.ts";
import type { TokenProvider } from "./auth.ts";
import { anonymous } from "./auth.ts";
import { formatBoolean, formatDigest, formatInteger } from "./fields.ts";
import { Sha256 } from "./sha256.ts";
import { authorizer, failure, join, problem } from "./transport.ts";

/** The revision of draft-ietf-httpbis-resumable-upload the uploader implements. */
export const DRAFT_REVISION = 16;

/** The Upload-Draft-Interop-Version that draft revision DRAFT_REVISION assigns, which every
 * request to an upload carries. */
export const INTEROP_VERSION = 11;

/** How an uploader is made: the base every path joins under ("/api" by default), as the API
 * client's does; the token provider whose bearer token every request carries (anonymous by
 * default), refreshed once on a 401 as the API client's is; `attempts`, how many requests in a row
 * may fail before an operation gives up, a positive integer; `delay`, the milliseconds the
 * uploader waits before each repeat, 0 repeating at once; and `chunkSize`, when given, the most
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

/** One upload resource an uploader created. `location` is its absolute URL, which the creation's
 * response named. */
export interface Upload {
  readonly location: string;
}

/** The uploader. `create` creates the upload resource for a file at the path, joined under the
 * base, and resolves to the Upload with nothing of the file sent yet.
 *
 * `create` hashes the whole file with SHA-256, reading it a piece at a time and never holding it
 * whole, then sends a POST with no content carrying Upload-Complete: ?0, the file's size as
 * Upload-Length, its SHA-256 as Repr-Digest's sha-256 member, its type as Content-Type when it has
 * one, its name as Content-Disposition's filename when it is a File with a name, and
 * Upload-Draft-Interop-Version. A 2xx with a Location names the upload; a 2xx without a valid one
 * is the decode problem. When no response arrives, or the response is a 429 or a 5xx, it waits the
 * delay and repeats the creation, within the attempts, and resolves to the last failure's problem
 * once they run out; any other failing response is its problem. The signal aborting, while it
 * hashes, sends, or waits, is the abort problem, or the timeout problem for AbortSignal.timeout. */
export interface Uploader {
  create(path: string, file: Blob, options?: UploadRequestOptions): Promise<Result<Upload>>;
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

  function send(
    method: string,
    url: string,
    headers: Headers,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    headers.set("Upload-Draft-Interop-Version", String(INTEROP_VERSION));
    return authorize(headers, () => fetch(url, { method, headers, signal }));
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
          response = await send("POST", url, headers, signal);
        } catch (error) {
          if (signal?.aborted || failures >= attempts) throw error;
          await pause(delay, signal);
          continue;
        }
        if (response.ok) return located(response, url);
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

  async function located(response: Response, url: string): Promise<Result<Upload>> {
    await response.body?.cancel();
    const named = response.headers.get("Location");
    let location: URL | undefined;
    try {
      if (named) location = new URL(named, response.url || new URL(url, globalThis.location?.href));
    } catch {}
    if (location === undefined) {
      return {
        ok: false,
        problem: {
          type: "urn:standards-lab:problem:decode",
          status: response.status,
          title: "Response not decodable",
          detail: `the creation's ${response.status} named no valid Location`,
        },
      };
    }
    return { ok: true, data: Object.freeze({ location: location.href }) };
  }

  return { create };
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
