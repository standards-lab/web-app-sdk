// The SDK's internal transport, which the API client and the uploader share: the authorizer that
// sends a request with the provider's bearer token and once more after a 401 with the refreshed
// one; a path joined under a base; the XMLHttpRequest send that reports a body's progress and
// resolves to a Response; the problems made from a failing response and from a request that
// failed; and the Result a response decodes to.
/** Makes the authorizer for `auth`, which holds one pending refresh at a time. */
export function authorizer(auth) {
    let pendingRefresh;
    function refresh() {
        pendingRefresh ??= settle(auth.refresh()).finally(() => {
            pendingRefresh = undefined;
        });
        return pendingRefresh;
    }
    return async (headers, send) => {
        const authorized = (token) => {
            if (token === undefined)
                headers.delete("Authorization");
            else
                headers.set("Authorization", `Bearer ${token}`);
            return send();
        };
        let response = await authorized(await settle(auth.token()));
        if (response.status === 401) {
            const token = await refresh();
            if (token !== undefined) {
                await response.body?.cancel();
                response = await authorized(token);
            }
        }
        return response;
    };
}
async function settle(token) {
    try {
        return await token;
    }
    catch {
        return undefined;
    }
}
/** The URL a path names under base: the two joined by text with one "/", whether or not the path
 * begins with one, and the query's parameters appended, an array's once per element, an undefined
 * value left out. */
export function join(base, path, query) {
    let url = `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query ?? {})) {
        if (value === undefined)
            continue;
        for (const each of Array.isArray(value) ? value : [value])
            params.append(name, String(each));
    }
    if (params.size > 0)
        url += `${url.includes("?") ? "&" : "?"}${params}`;
    return url;
}
/** Sends one request over XMLHttpRequest, settling once it ends (its `loadend`): resolving to its
 * response as a Response and rejecting as fetch does, with the signal's reason when the signal
 * aborts it and with a TypeError when the network fails. */
export function transmit(method, url, headers, payload, { signal, progress } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(signal.reason);
        const xhr = new XMLHttpRequest();
        xhr.open(method, url);
        xhr.responseType = "blob";
        headers.forEach((value, name) => xhr.setRequestHeader(name, value));
        if (progress !== undefined) {
            const report = (event) => progress(event.loaded, event.total);
            for (const type of ["loadstart", "progress", "load"]) {
                xhr.upload.addEventListener(type, report);
            }
        }
        const abort = () => xhr.abort();
        signal?.addEventListener("abort", abort, { once: true });
        let settle = () => reject(new TypeError(`${method} ${url} failed`));
        xhr.addEventListener("load", () => {
            settle = () => {
                try {
                    resolve(response(xhr));
                }
                catch (error) {
                    reject(error);
                }
            };
        });
        xhr.addEventListener("abort", () => {
            settle = () => reject(signal?.reason);
        });
        xhr.addEventListener("loadend", () => {
            signal?.removeEventListener("abort", abort);
            settle();
        });
        xhr.send(payload ?? null);
    });
}
function response(xhr) {
    const headers = new Headers();
    for (const line of xhr.getAllResponseHeaders().trim().split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon > 0)
            headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    const empty = [204, 205, 304].includes(xhr.status);
    return new Response(empty ? null : xhr.response, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers,
    });
}
/** The error a request body JSON.stringify can't encode throws, with the stringify error's
 * message when there is one; failure makes it the encode problem. */
export class Unencodable extends Error {
}
/** The response's media type, lowercased and without parameters; empty when it names none. */
export function mediaType(response) {
    return (response.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
}
/** The problem a failing response is: its application/problem+json document with every member
 * kept, `type`, `status`, and `title` filled when absent; otherwise the `about:blank` problem
 * titled with the status text, or "HTTP <status>" when that is empty. It reads or cancels the
 * body. */
export async function problem(response) {
    const fallback = `HTTP ${response.status}`;
    if (mediaType(response) === "application/problem+json") {
        let document;
        try {
            document = JSON.parse(await response.text());
        }
        catch { }
        if (typeof document === "object" && document !== null && !Array.isArray(document)) {
            const members = document;
            return {
                ...members,
                type: typeof members.type === "string" ? members.type : "about:blank",
                status: typeof members.status === "number" ? members.status : response.status,
                title: typeof members.title === "string" && members.title ? members.title : fallback,
            };
        }
    }
    else {
        await response.body?.cancel();
    }
    return { type: "about:blank", status: response.status, title: response.statusText || fallback };
}
/** The problem a request that threw is: the encode problem for an Unencodable; the timeout
 * problem when the signal aborted with a TimeoutError, the abort problem when it aborted with any
 * other reason; and otherwise the network problem, the error's message its detail. */
export function failure(error, signal) {
    if (error instanceof Unencodable) {
        const problem = {
            type: "urn:standards-lab:problem:encode",
            status: 0,
            title: "Request not encodable",
        };
        if (error.message)
            problem.detail = error.message;
        return problem;
    }
    if (signal?.aborted) {
        const reason = signal.reason;
        if (typeof reason === "object" &&
            reason !== null &&
            "name" in reason &&
            reason.name === "TimeoutError") {
            return { type: "urn:standards-lab:problem:timeout", status: 0, title: "Request timed out" };
        }
        return { type: "urn:standards-lab:problem:abort", status: 0, title: "Request aborted" };
    }
    return {
        type: "urn:standards-lab:problem:network",
        status: 0,
        title: "Network error",
        detail: error instanceof Error ? error.message : String(error),
    };
}
function isJSON(type) {
    return type === "application/json" || type.endsWith("+json");
}
/** The Result a response is, as the API client resolves a call to it: a failing response its
 * problem; under `as: "text"` the body's text; otherwise the body decoded by its content type, JSON
 * (application/json or any +json type) parsed, text/* a string, any other a Blob, and no body (a
 * 204 or 205, or an empty body) undefined. A JSON body that doesn't parse is the decode problem. */
export async function decode(response, as) {
    if (!response.ok)
        return { ok: false, problem: await problem(response) };
    if (as === "text")
        return { ok: true, data: (await response.text()) };
    const type = mediaType(response);
    const blob = await response.blob();
    if (response.status === 204 || response.status === 205 || blob.size === 0) {
        return { ok: true, data: undefined };
    }
    if (isJSON(type)) {
        const text = await blob.text();
        try {
            return { ok: true, data: JSON.parse(text) };
        }
        catch (error) {
            return undecodable(response, error instanceof Error ? error.message : String(error));
        }
    }
    if (type.startsWith("text/"))
        return { ok: true, data: (await blob.text()) };
    return { ok: true, data: blob };
}
/** The failing Result for a response the client can't decode: the decode problem, with the
 * response's status and the detail. */
export function undecodable(response, detail) {
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
