// The application SDK's resumable upload client, for draft-ietf-httpbis-resumable-upload-16 at
// Upload-Draft-Interop-Version 11: DRAFT_REVISION, INTEROP_VERSION, the uploader's options and
// shape, the upload it creates or opens, sends, and cancels, and createUploader. Every operation
// resolves to a Result and never rejects; a failure is the server's problem document or one of the
// client's own problems, as the API client's are.
// See https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-resumable-upload-16
import { anonymous } from "./auth.js";
import { formatBoolean, formatDigest, formatInteger, parseComplete, parseLimit, parseOffset, } from "./fields.js";
import { Sha256 } from "./sha256.js";
import { authorizer, decode, failure, join, problem, transmit, undecodable } from "./transport.js";
/** The revision of draft-ietf-httpbis-resumable-upload the uploader implements. */
export const DRAFT_REVISION = 16;
/** The Upload-Draft-Interop-Version that draft revision DRAFT_REVISION assigns, which every
 * request to an upload carries. */
export const INTEROP_VERSION = 11;
const PIECE = 4 * 1024 * 1024;
/** Makes an uploader. Throws a RangeError when `attempts` isn't a positive integer, `delay` isn't a
 * non-negative number, or a given `chunkSize` isn't a positive integer. */
export function createUploader(options) {
    const { attempts, delay, chunkSize } = options;
    if (!Number.isInteger(attempts) || attempts < 1) {
        throw new RangeError(`attempts ${attempts} is not a positive integer`);
    }
    if (!(delay >= 0))
        throw new RangeError(`delay ${delay} is not a non-negative number`);
    if (chunkSize !== undefined && (!Number.isInteger(chunkSize) || chunkSize < 1)) {
        throw new RangeError(`chunkSize ${chunkSize} is not a positive integer`);
    }
    const base = options.base ?? "/api";
    const authorize = authorizer(options.auth ?? anonymous);
    function request(method, url, headers, signal) {
        headers.set("Upload-Draft-Interop-Version", String(INTEROP_VERSION));
        return authorize(headers, () => fetch(url, { method, headers, signal }));
    }
    function transmitted(url, headers, payload, signal, progress) {
        headers.set("Upload-Draft-Interop-Version", String(INTEROP_VERSION));
        return authorize(headers, () => transmit("PATCH", url, headers, payload, { signal, progress }));
    }
    async function create(path, file, { signal } = {}) {
        try {
            const url = join(base, path);
            const headers = new Headers({
                "Upload-Complete": formatBoolean(false),
                "Upload-Length": formatInteger(file.size),
                "Repr-Digest": formatDigest(await hash(file, signal)),
            });
            if (file.type)
                headers.set("Content-Type", file.type);
            if (file instanceof File && file.name) {
                headers.set("Content-Disposition", disposition(file.name));
            }
            for (let failures = 1;; failures++) {
                let response;
                try {
                    response = await request("POST", url, headers, signal);
                }
                catch (error) {
                    if (signal?.aborted || failures >= attempts)
                        throw error;
                    await pause(delay, signal);
                    continue;
                }
                if (response.ok)
                    return located(response, url, file);
                if (!retryable(response.status) || failures >= attempts) {
                    return { ok: false, problem: await problem(response) };
                }
                await response.body?.cancel();
                await pause(delay, signal);
            }
        }
        catch (error) {
            return { ok: false, problem: failure(error, signal) };
        }
    }
    async function located(response, url, file) {
        await response.body?.cancel();
        const named = response.headers.get("Location");
        let location;
        try {
            if (named)
                location = new URL(named, response.url || new URL(url, globalThis.location?.href));
        }
        catch { }
        if (location === undefined) {
            return undecodable(response, `the creation's ${response.status} named no valid Location`);
        }
        const offset = parseOffset(response.headers.get("Upload-Offset")) ?? 0;
        if (offset > file.size) {
            return undecodable(response, `the creation's ${response.status} named Upload-Offset ${offset}, past the file's ${file.size} bytes`);
        }
        const limit = parseLimit(response.headers.get("Upload-Limit"))?.maxAppendSize;
        return { ok: true, data: upload(location.href, file, offset, limit).handle };
    }
    async function open(location, file, { signal } = {}) {
        try {
            const url = new URL(location, globalThis.location?.href);
            return await upload(url.href, file, undefined, undefined).locate(signal);
        }
        catch (error) {
            return { ok: false, problem: failure(error, signal) };
        }
    }
    function upload(location, file, start, limit) {
        let pending = Promise.resolve();
        let offset = start ?? 0;
        let known = start !== undefined;
        let finished;
        async function append(signal, progress) {
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
            const reported = progress === undefined ? undefined : (sent) => progress(from + sent, file.size);
            let response;
            try {
                response = await transmitted(location, headers, chunk, signal, reported);
            }
            catch (error) {
                known = false;
                if (signal?.aborted)
                    throw error;
                return { kind: "failed", problem: failure(error, signal) };
            }
            if (completes(response, last)) {
                finished = await decode(response);
                return { kind: "settled", result: finished };
            }
            limit = parseLimit(response.headers.get("Upload-Limit"))?.maxAppendSize ?? limit;
            if (!response.ok) {
                const failed = { kind: "failed", problem: await problem(response) };
                if (response.status === 409) {
                    const at = parseOffset(response.headers.get("Upload-Offset"));
                    if (at !== undefined && at <= file.size)
                        offset = at;
                    else
                        known = false;
                    return failed;
                }
                if (response.status === 413 && limit !== undefined && limit < size)
                    return failed;
                if (retryable(response.status)) {
                    known = false;
                    return failed;
                }
                return { kind: "settled", result: { ok: false, problem: failed.problem } };
            }
            await response.body?.cancel();
            if (last) {
                return settled(undecodable(response, `the last append's ${response.status} left the upload open`));
            }
            const field = response.headers.get("Upload-Offset");
            const next = field === null ? from + size : parseOffset(field);
            if (next === undefined || next <= from || next > from + size) {
                return settled(undecodable(response, `the append's ${response.status} named Upload-Offset ${field}, outside ${from + 1}..${from + size}`));
            }
            offset = next;
            return { kind: "advanced" };
        }
        async function head(signal) {
            let response;
            try {
                response = await request("HEAD", location, new Headers(), signal);
            }
            catch (error) {
                if (signal?.aborted)
                    throw error;
                return { kind: "failed", problem: failure(error, signal) };
            }
            if (!response.ok) {
                const failed = await problem(response);
                if (retryable(response.status))
                    return { kind: "failed", problem: failed };
                return { kind: "settled", result: { ok: false, problem: failed } };
            }
            await response.body?.cancel();
            const completeField = response.headers.get("Upload-Complete");
            const complete = parseComplete(completeField);
            if (completeField !== null && complete === undefined) {
                return settled(undecodable(response, `the HEAD's ${response.status} named Upload-Complete ${completeField}`));
            }
            if (complete === true) {
                return settled(undecodable(response, `the HEAD's ${response.status} named the upload complete, its completion's response lost`));
            }
            const field = response.headers.get("Upload-Offset");
            const at = parseOffset(field);
            if (at === undefined || at > file.size) {
                return settled(undecodable(response, `the HEAD's ${response.status} named Upload-Offset ${field}, outside 0..${file.size}`));
            }
            limit = parseLimit(response.headers.get("Upload-Limit"))?.maxAppendSize ?? limit;
            offset = at;
            known = true;
            return { kind: "located" };
        }
        async function sent({ signal, progress }) {
            if (finished !== undefined)
                return finished;
            try {
                if (typeof XMLHttpRequest === "undefined") {
                    throw new TypeError("XMLHttpRequest is not available here; send needs a browser");
                }
                for (let failures = 0;;) {
                    const step = known ? await append(signal, progress) : await head(signal);
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
            }
            catch (error) {
                return { ok: false, problem: failure(error, signal) };
            }
        }
        async function cancelled({ signal }) {
            try {
                const response = await request("DELETE", location, new Headers(), signal);
                if (!response.ok)
                    return { ok: false, problem: await problem(response) };
                await response.body?.cancel();
                return { ok: true, data: undefined };
            }
            catch (error) {
                return { ok: false, problem: failure(error, signal) };
            }
            finally {
                known = false;
            }
        }
        function queued(run) {
            const next = pending.then(run);
            pending = next;
            return next;
        }
        const handle = Object.freeze({
            location,
            send: (options = {}) => queued(() => sent(options)),
            cancel: (options = {}) => queued(() => cancelled(options)),
        });
        async function locate(signal) {
            for (let failures = 1;; failures++) {
                const step = await head(signal);
                switch (step.kind) {
                    case "located":
                        return { ok: true, data: handle };
                    case "settled":
                        return step.result;
                    case "failed":
                        if (failures >= attempts)
                            return { ok: false, problem: step.problem };
                        await pause(delay, signal);
                }
            }
        }
        return { handle, locate };
    }
    return { create, open };
}
function settled(result) {
    return { kind: "settled", result };
}
function completes(response, last) {
    const field = response.headers.get("Upload-Complete");
    return field === null ? last && response.ok : parseComplete(field) === true;
}
async function hash(file, signal) {
    const sha = new Sha256();
    for (let at = 0; at < file.size; at += PIECE) {
        signal?.throwIfAborted();
        sha.update(new Uint8Array(await file.slice(at, at + PIECE).arrayBuffer()));
    }
    signal?.throwIfAborted();
    return sha.digest();
}
function retryable(status) {
    return status === 429 || status >= 500;
}
function pause(delay, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(signal.reason);
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
function disposition(name) {
    if (/^[\x20-\x7e]*$/.test(name)) {
        return `attachment; filename="${name.replace(/["\\]/g, "\\$&")}"`;
    }
    const encoded = [...new TextEncoder().encode(name)]
        .map((byte) => /[A-Za-z0-9!#$&+\-.^_`|~]/.test(String.fromCharCode(byte))
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
        .join("");
    return `attachment; filename*=utf-8''${encoded}`;
}
