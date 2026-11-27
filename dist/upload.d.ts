import type { Result } from "./api.ts";
import type { TokenProvider } from "./auth.ts";
/** The revision of draft-ietf-httpbis-resumable-upload the uploader implements. */
export declare const DRAFT_REVISION = 16;
/** The Upload-Draft-Interop-Version that draft revision DRAFT_REVISION assigns, which every
 * request to an upload carries. */
export declare const INTEROP_VERSION = 11;
/** How an uploader is made: the base every path joins under ("/api" by default), as the API
 * client's does; the token provider whose bearer token every request carries (anonymous by
 * default), refreshed once on a 401 as the API client's is; `attempts`, how many requests in a row
 * may fail to advance an operation before it gives up, a positive integer; `delay`, the
 * milliseconds the uploader waits before each repeat, 0 repeating at once; and `chunkSize`, when
 * given, the most bytes one append carries, a positive integer. */
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
/** Makes an uploader. Throws a RangeError when `attempts` isn't a positive integer, `delay` isn't a
 * non-negative number, or a given `chunkSize` isn't a positive integer. */
export declare function createUploader(options: UploaderOptions): Uploader;
