// The application SDK's API client: the problem, the result, the page, the server-sent event, the
// client's options and shape, and createClient. Every call resolves to a Result and never
// rejects; a stream's events, read after it resolves, are the one place an error is thrown.
import { anonymous } from "./auth.js";
import { EventStreamParser } from "./eventstream.js";
import { authorizer, decode, failure, join, mediaType, problem, transmit, undecodable, Unencodable, } from "./transport.js";
/** The error a stream's events throw when the network fails after the stream resolved, its
 * `problem` the network problem a call would have resolved to. It is the one error the client
 * throws; the caller's signal ends the events quietly instead. */
export class StreamError extends Error {
    problem;
    constructor(problem) {
        super(problem.detail === undefined ? problem.title : `${problem.title}: ${problem.detail}`);
        this.name = "StreamError";
        this.problem = problem;
    }
}
/** Makes a client. */
export function createClient(options = {}) {
    const base = options.base ?? "/api";
    const authorize = authorizer(options.auth ?? anonymous);
    async function respond(path, body, request, send, accept) {
        const url = join(base, path, request.query);
        const headers = new Headers(request.headers);
        if (accept !== undefined)
            headers.set("Accept", accept);
        const payload = encode(body, headers);
        return authorize(headers, () => send(url, headers, payload));
    }
    function fetched(method, path, body, request, accept) {
        const send = (url, headers, payload) => fetch(url, { method, headers, body: payload, signal: request.signal });
        return respond(path, body, request, send, accept);
    }
    async function call(method, path, body, request = {}) {
        try {
            return await decode(await fetched(method, path, body, request), request.as);
        }
        catch (error) {
            return { ok: false, problem: failure(error, request.signal) };
        }
    }
    async function stream(path, body, request = {}) {
        const method = body === undefined ? "GET" : "POST";
        try {
            const response = await fetched(method, path, body, request, "text/event-stream");
            if (!response.ok)
                return { ok: false, problem: await problem(response) };
            const type = mediaType(response);
            if (type !== "text/event-stream" || response.body === null) {
                await response.body?.cancel();
                return undecodable(response, `${type || "no content type"} is not text/event-stream`);
            }
            return { ok: true, data: events(response.body, request.signal) };
        }
        catch (error) {
            return { ok: false, problem: failure(error, request.signal) };
        }
    }
    async function upload(path, body, request = {}) {
        try {
            if (typeof XMLHttpRequest === "undefined") {
                throw new TypeError("XMLHttpRequest is not available here; upload needs a browser");
            }
            const method = request.method ?? "POST";
            const send = (url, headers, payload) => transmit(method, url, headers, payload, request);
            return await decode(await respond(path, body, request, send));
        }
        catch (error) {
            return { ok: false, problem: failure(error, request.signal) };
        }
    }
    return {
        get: (path, options) => call("GET", path, undefined, options),
        post: (path, body, options) => call("POST", path, body, options),
        put: (path, body, options) => call("PUT", path, body, options),
        patch: (path, body, options) => call("PATCH", path, body, options),
        delete: (path, options) => call("DELETE", path, undefined, options),
        stream: (path, body, options) => stream(path, body, options),
        upload: (path, body, options) => upload(path, body, options),
    };
}
async function* events(body, signal) {
    const reader = body.getReader();
    const parser = new EventStreamParser();
    try {
        for (;;) {
            let chunk;
            try {
                chunk = await reader.read();
            }
            catch (error) {
                if (signal?.aborted)
                    return;
                throw new StreamError(failure(error, undefined));
            }
            if (chunk.done)
                break;
            yield* parser.push(chunk.value);
        }
        yield* parser.end();
    }
    finally {
        await reader.cancel().catch(() => { });
    }
}
function encode(body, headers) {
    if (body === undefined)
        return undefined;
    if (body instanceof FormData ||
        body instanceof Blob ||
        body instanceof ArrayBuffer ||
        ArrayBuffer.isView(body) ||
        body instanceof URLSearchParams) {
        return body;
    }
    let json;
    try {
        json = JSON.stringify(body);
    }
    catch (error) {
        throw new Unencodable(error instanceof Error ? error.message : String(error));
    }
    if (json === undefined)
        throw new Unencodable();
    headers.set("Content-Type", "application/json");
    return json;
}
