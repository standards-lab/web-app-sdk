import type { Problem, Result } from "./api.ts";
import type { TokenProvider } from "./auth.ts";
/** Sends a request through `send`, with `Authorization: Bearer <token>` set on `headers` when the
 * provider has a token and removed when it doesn't. On a 401 it asks the provider to refresh and
 * sends once more with the refreshed token, or resolves to the 401 when the refresh gives none.
 * 401s that arrive while a refresh is pending share that one refresh. A provider that rejects has
 * no token. */
export type Authorizer = (headers: Headers, send: () => Promise<Response>) => Promise<Response>;
/** Makes the authorizer for `auth`, which holds one pending refresh at a time. */
export declare function authorizer(auth: TokenProvider): Authorizer;
/** The URL a path names under base: the two joined by text with one "/", whether or not the path
 * begins with one, and the query's parameters appended, an array's once per element, an undefined
 * value left out. */
export declare function join(base: string, path: string, query?: Readonly<Record<string, string | number | boolean | readonly (string | number | boolean)[] | undefined>>): string;
/** What one XMLHttpRequest send takes beyond its request: the signal that aborts it, and
 * `progress`, called with the bytes of the body sent and its total at `loadstart`, at each
 * `progress`, and at `load`. */
export interface TransmitOptions {
    signal?: AbortSignal;
    progress?: (sent: number, total: number) => void;
}
/** Sends one request over XMLHttpRequest, settling once it ends (its `loadend`): resolving to its
 * response as a Response and rejecting as fetch does, with the signal's reason when the signal
 * aborts it and with a TypeError when the network fails. */
export declare function transmit(method: string, url: string, headers: Headers, payload: XMLHttpRequestBodyInit | undefined, { signal, progress }?: TransmitOptions): Promise<Response>;
/** The error a request body JSON.stringify can't encode throws, with the stringify error's
 * message when there is one; failure makes it the encode problem. */
export declare class Unencodable extends Error {
}
/** The response's media type, lowercased and without parameters; empty when it names none. */
export declare function mediaType(response: Response): string;
/** The problem a failing response is: its application/problem+json document with every member
 * kept, `type`, `status`, and `title` filled when absent; otherwise the `about:blank` problem
 * titled with the status text, or "HTTP <status>" when that is empty. It reads or cancels the
 * body. */
export declare function problem(response: Response): Promise<Problem>;
/** The problem a request that threw is: the encode problem for an Unencodable; the timeout
 * problem when the signal aborted with a TimeoutError, the abort problem when it aborted with any
 * other reason; and otherwise the network problem, the error's message its detail. */
export declare function failure(error: unknown, signal: AbortSignal | undefined): Problem;
/** The Result a response is, as the API client resolves a call to it: a failing response its
 * problem; under `as: "text"` the body's text; otherwise the body decoded by its content type, JSON
 * (application/json or any +json type) parsed, text/* a string, any other a Blob, and no body (a
 * 204 or 205, or an empty body) undefined. A JSON body that doesn't parse is the decode problem. */
export declare function decode<T>(response: Response, as?: "text"): Promise<Result<T>>;
/** The failing Result for a response the client can't decode: the decode problem, with the
 * response's status and the detail. */
export declare function undecodable(response: Response, detail: string): {
    ok: false;
    problem: Problem;
};
