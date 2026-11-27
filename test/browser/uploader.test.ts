import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";

import type { Result } from "@standards-lab/web-app-sdk/api.js";
import { launch, type Browser, type Page } from "@standards-lab/web-tooling/browser.js";

import { startServer, type UploadServer } from "./support/server.ts";

let server: UploadServer;
let browser: Browser;
let page: Page;

before(async () => {
  server = await startServer();
  browser = await launch();
  page = await browser.open(`${server.origin}/test/fixtures/uploader.html`);
});
beforeEach(async () => {
  await server.configure();
  await server.requests();
});
after(async () => {
  await browser?.close();
  await server?.stop();
});

interface Spec {
  path?: string;
  kind?: "file" | "blob";
  size: number;
  name?: string;
  type?: string;
  token?: string;
  fresh?: string;
  attempts?: number;
  delay?: number;
  abort?: "before" | number;
}

interface Created {
  result: Result<{ location: string }>;
  refreshes: number;
  slices: number[];
}

const create = (spec: Spec): Promise<Created> => page.evaluate(`create(${JSON.stringify(spec)})`);

function bytes(size: number): Buffer {
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + (i >> 8)) & 255;
  return out;
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest();

function located(result: Result<{ location: string }>): string {
  assert.ok(result.ok, JSON.stringify(result.ok ? undefined : result.problem));
  return result.data.location;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

describe("the upload module", () => {
  test("names draft revision 16 and interop version 11", async () => {
    assert.deepEqual(await page.evaluate("constants"), { DRAFT_REVISION: 16, INTEROP_VERSION: 11 });
  });
});

describe("the SHA-256", () => {
  test("is crypto.subtle's on the same bytes, fed whole or in pieces", async () => {
    const sizes = [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 4097, 1024 * 1024 + 3];
    const digests: { size: number; whole: string; pieces: string; subtle: string }[] =
      await page.evaluate(`digests(${JSON.stringify(sizes)})`);
    for (const { size, whole, pieces, subtle } of digests) {
      assert.equal(whole, subtle, `${size} bytes whole`);
      assert.equal(pieces, subtle, `${size} bytes in pieces`);
      assert.equal(subtle, sha256(bytes(size)).toString("hex"), `${size} bytes`);
    }
  });
});

describe("create", () => {
  test("sends a creating POST with no content and the file's fields", async () => {
    const size = 5000;
    located((await create({ size, name: "report.pdf", type: "application/pdf" })).result);
    const [request, ...rest] = await server.requests();
    assert.deepEqual(rest, []);
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/uploads");
    const { headers } = request;
    assert.equal(headers["content-length"], "0");
    assert.equal(headers["upload-complete"], "?0");
    assert.equal(headers["upload-length"], "5000");
    assert.equal(headers["repr-digest"], `sha-256=:${sha256(bytes(size)).toString("base64")}:`);
    assert.equal(headers["content-type"], "application/pdf");
    assert.equal(headers["content-disposition"], 'attachment; filename="report.pdf"');
    assert.equal(headers["upload-draft-interop-version"], "11");
    assert.equal(headers.authorization, undefined);
  });

  test("resolves to the upload the 201's Location names, at offset 0", async () => {
    const size = 5000;
    const location = located((await create({ size, name: "report.pdf" })).result);
    assert.match(location, new RegExp(`^${server.origin}/uploads/${UUID}$`));
    assert.deepEqual(await server.state(location), {
      offset: 0,
      length: size,
      complete: false,
      mediaType: "application/octet-stream",
      name: "report.pdf",
      digest: sha256(bytes(size)).toString("hex"),
      size: 0,
      sha256: sha256(Buffer.alloc(0)).toString("hex"),
    });
    assert.deepEqual(await page.evaluate(`head(${JSON.stringify(location)})`), {
      status: 204,
      offset: "0",
      length: String(size),
    });
  });

  test("hashes the file a piece at a time, never whole", async () => {
    const size = 9 * 1024 * 1024 + 5;
    const { result, slices } = await create({ size });
    const location = located(result);
    assert.ok(slices.length >= 3, `too few pieces: ${slices}`);
    assert.ok(Math.max(...slices) < size, `a piece was the whole file: ${slices}`);
    assert.equal(
      slices.reduce((sum, piece) => sum + piece, 0),
      size,
    );
    assert.equal((await server.state(location))?.digest, sha256(bytes(size)).toString("hex"));
  });

  test("creates an empty file's upload", async () => {
    const location = located((await create({ size: 0 })).result);
    const state = await server.state(location);
    assert.equal(state?.length, 0);
    assert.equal(state?.digest, sha256(Buffer.alloc(0)).toString("hex"));
  });

  test("names a non-ASCII file in Content-Disposition's filename*", async () => {
    const name = "résumé 2026 €.txt";
    const location = located((await create({ size: 10, name })).result);
    const [request] = await server.requests();
    assert.equal(
      request.headers["content-disposition"],
      "attachment; filename*=utf-8''r%C3%A9sum%C3%A9%202026%20%E2%82%AC.txt",
    );
    assert.equal((await server.state(location))?.name, name);
  });

  test("quotes a name's quote and backslash", async () => {
    const name = 'a "b" \\c.txt';
    const location = located((await create({ size: 10, name })).result);
    assert.equal((await server.state(location))?.name, name);
  });

  test("sends no Content-Disposition for a Blob, which has no name", async () => {
    located((await create({ kind: "blob", size: 10 })).result);
    const [request] = await server.requests();
    assert.equal(request.headers["content-disposition"], undefined);
  });

  test("a server's problem is its problem document, every member kept", async () => {
    assert.deepEqual((await create({ size: 10, type: "" })).result, {
      ok: false,
      problem: {
        type: "about:blank",
        title: "Unsupported Media Type",
        status: 415,
        detail: "upload: the creation requires the file's Content-Type",
        instance: "/uploads",
      },
    });
    const [request, ...rest] = await server.requests();
    assert.equal(request.headers["content-type"], undefined);
    assert.deepEqual(rest, []);
  });
});

describe("create's requests", () => {
  test("carry the provider's bearer token", async () => {
    await server.configure({ token: "abc" });
    located((await create({ size: 10, token: "abc" })).result);
    const [request] = await server.requests();
    assert.equal(request.headers.authorization, "Bearer abc");
  });

  test("on a 401, refresh once and repeat with the new token", async () => {
    await server.configure({ token: "fresh" });
    const { result, refreshes } = await create({ size: 10, token: "stale", fresh: "fresh" });
    located(result);
    assert.equal(refreshes, 1);
    const requests = await server.requests();
    assert.deepEqual(
      requests.map(({ method, headers }) => [method, headers.authorization]),
      [
        ["POST", "Bearer stale"],
        ["POST", "Bearer fresh"],
      ],
    );
    assert.ok(requests.every(({ headers }) => headers["upload-draft-interop-version"] === "11"));
  });

  test("resolve to the 401's problem when the refresh gives no token", async () => {
    await server.configure({ token: "fresh" });
    const { result, refreshes } = await create({ size: 10, token: "stale" });
    assert.deepEqual(result, {
      ok: false,
      problem: { type: "about:blank", status: 401, title: "Unauthorized" },
    });
    assert.equal(refreshes, 1);
  });
});

describe("create's repeat", () => {
  test("repeats a creation answered 503, within its attempts", async () => {
    await server.configure({ fault: "unavailable" });
    located((await create({ size: 10, attempts: 2, delay: 10 })).result);
    assert.deepEqual(
      (await server.requests()).map(({ method }) => method),
      ["POST", "POST"],
    );
  });

  test("resolves to the 503's problem once its attempts run out", async () => {
    await server.configure({ fault: "unavailable" });
    assert.deepEqual((await create({ size: 10, attempts: 1 })).result, {
      ok: false,
      problem: { type: "about:blank", status: 503, title: "Service Unavailable" },
    });
  });

  test("repeats a creation whose response never arrives", async () => {
    await server.configure({ fault: "lose-created" });
    const location = located((await create({ size: 10, attempts: 2 })).result);
    assert.equal((await server.requests()).length, 2);
    assert.equal((await server.state(location))?.offset, 0);
  });

  test("resolves to the network problem when no response arrives within its attempts", async () => {
    await server.configure({ fault: "lose-created" });
    const { result } = await create({ size: 10, attempts: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.problem.type, "urn:standards-lab:problem:network");
    assert.equal(result.problem.status, 0);
  });
});

describe("create's signal", () => {
  test("aborted before it starts is the abort problem, nothing sent", async () => {
    assert.deepEqual((await create({ size: 10, abort: "before" })).result, {
      ok: false,
      problem: { type: "urn:standards-lab:problem:abort", status: 0, title: "Request aborted" },
    });
    assert.deepEqual(await server.requests(), []);
  });

  test("timing out while it waits to repeat is the timeout problem", async () => {
    await server.configure({ fault: "unavailable" });
    const { result } = await create({ size: 10, attempts: 2, delay: 5000, abort: 200 });
    assert.deepEqual(result, {
      ok: false,
      problem: { type: "urn:standards-lab:problem:timeout", status: 0, title: "Request timed out" },
    });
  });
});

const MiB = 1024 * 1024;

interface Prepared {
  size: number;
  chunkSize?: number;
  token?: string;
  fresh?: string;
  attempts?: number;
}

interface Completed {
  id: string;
  mediaType: string;
  digest: string;
  name: string;
  length: number;
}

interface Sent {
  results: Result<Completed>[];
  progress: [number, number][][];
  most: number;
  refreshes: number;
}

async function prepare(spec: Prepared): Promise<string> {
  const location = located(await page.evaluate(`prepare(${JSON.stringify(spec)})`));
  await server.requests();
  return location;
}

const send = (spec: { sends?: number; overlap?: boolean; abort?: "before" | "progress" } = {}) =>
  page.evaluate(`send(${JSON.stringify(spec)})`) as Promise<Sent>;

function completed(result: Result<Completed>, location: string, size: number) {
  assert.ok(result.ok, JSON.stringify(result.ok ? undefined : result.problem));
  assert.deepEqual(result.data, {
    id: new URL(location).pathname.replace(/^\/uploads\//, ""),
    mediaType: "application/octet-stream",
    digest: sha256(bytes(size)).toString("hex"),
    name: "report.bin",
    length: size,
  });
}

async function held(location: string, size: number) {
  const state = await server.state(location);
  assert.equal(state?.complete, true);
  assert.equal(state?.size, size);
  assert.equal(state?.sha256, sha256(bytes(size)).toString("hex"));
  assert.equal(state?.sha256, state?.digest);
}

async function appends(location: string, chunks: number[]) {
  const requests = await server.requests();
  const file = bytes(chunks.reduce((sum, chunk) => sum + chunk, 0));
  assert.equal(requests.length, chunks.length);
  let from = 0;
  for (const [i, { method, path, headers }] of requests.entries()) {
    const chunk = file.subarray(from, from + chunks[i]);
    assert.equal(method, "PATCH");
    assert.equal(path, new URL(location).pathname);
    assert.equal(headers["content-type"], "application/partial-upload");
    assert.equal(headers["content-length"], String(chunks[i]));
    assert.equal(headers["upload-offset"], String(from));
    assert.equal(headers["upload-complete"], i === chunks.length - 1 ? "?1" : "?0");
    assert.equal(headers["content-digest"], `sha-256=:${sha256(chunk).toString("base64")}:`);
    assert.equal(headers["upload-draft-interop-version"], "11");
    from += chunks[i];
  }
}

function rising(progress: [number, number][], from: number, total: number) {
  assert.deepEqual(progress[0], [from, total]);
  assert.deepEqual(progress.at(-1), [total, total]);
  for (let at = 1; at < progress.length; at++) {
    assert.equal(progress[at][1], total);
    assert.ok(progress[at][0] >= progress[at - 1][0], `progress went back: ${progress}`);
  }
}

describe("send", () => {
  test("sends a 16 MB file in chunks of chunkSize, each PATCH its chunk's", async () => {
    await server.configure({ limit: 8 * MiB });
    const size = 16 * MiB;
    const location = await prepare({ size, chunkSize: 5 * MiB });
    const { results, most } = await send();
    completed(results[0], location, size);
    await appends(location, [5 * MiB, 5 * MiB, 5 * MiB, MiB]);
    await held(location, size);
    assert.equal(most, 1);
  });

  test("bounds each chunk by a smaller max-append-size the creation announced", async () => {
    const size = 3 * MiB + MiB / 2;
    const location = await prepare({ size, chunkSize: 3 * MiB });
    completed((await send()).results[0], location, size);
    await appends(location, [MiB, MiB, MiB, MiB / 2]);
    await held(location, size);
  });

  test("without a chunkSize, sends chunks of the announced max-append-size", async () => {
    await server.configure({ limit: 2 * MiB });
    const size = 5 * MiB;
    const location = await prepare({ size });
    completed((await send()).results[0], location, size);
    await appends(location, [2 * MiB, 2 * MiB, MiB]);
  });

  test("completes an empty file with one PATCH carrying no content", async () => {
    const location = await prepare({ size: 0 });
    completed((await send()).results[0], location, 0);
    await appends(location, [0]);
    await held(location, 0);
  });

  test("reports progress from the server's offset to the total, never back", async () => {
    const size = 4 * MiB;
    await prepare({ size });
    const { progress } = await send();
    rising(progress[0], 0, size);
    for (const from of [0, MiB, 2 * MiB, 3 * MiB]) {
      assert.ok(
        progress[0].some(([sent]) => sent === from),
        `no report at the append from ${from}: ${progress[0]}`,
      );
    }
  });

  test("resolves to a completion's 4xx problem, sent once", async () => {
    const location = await prepare({ size: 1000, attempts: 3 });
    await server.configure({ fault: "reject-complete" });
    const { results } = await send();
    assert.deepEqual(results[0], {
      ok: false,
      problem: {
        type: "about:blank",
        status: 422,
        title: "Unprocessable Entity",
        detail: "the test server rejects the file",
        instance: new URL(location).pathname,
      },
    });
    await appends(location, [1000]);
  });

  test("carries the provider's token, refreshed once on a 401", async () => {
    await prepare({ size: 1000, token: "stale", fresh: "fresh" });
    await server.configure({ token: "fresh" });
    const { results, refreshes } = await send();
    assert.equal(results[0].ok, true);
    assert.equal(refreshes, 1);
    assert.deepEqual(
      (await server.requests()).map(({ method, headers }) => [method, headers.authorization]),
      [
        ["PATCH", "Bearer stale"],
        ["PATCH", "Bearer fresh"],
      ],
    );
  });
});

describe("send after an append fails", () => {
  test("is its problem, and a later send continues from the server's offset", async () => {
    const size = 3 * MiB;
    const location = await prepare({ size });
    await server.configure({ fault: "unavailable" });
    const { results, progress } = await send({ sends: 2 });
    assert.deepEqual(results[0], {
      ok: false,
      problem: { type: "about:blank", status: 503, title: "Service Unavailable" },
    });
    completed(results[1], location, size);
    rising(progress[1], 0, size);
    await held(location, size);
  });

  test("runs sends made at once one after another, never overlapping", async () => {
    const size = 3 * MiB;
    const location = await prepare({ size });
    await server.configure({ fault: "unavailable" });
    const { results, most } = await send({ sends: 2, overlap: true });
    assert.equal(results[0].ok, false);
    completed(results[1], location, size);
    assert.equal(most, 1);
  });
});

describe("send's signal", () => {
  test("aborted before it starts is the abort problem, nothing sent", async () => {
    await prepare({ size: 1000 });
    const { results } = await send({ abort: "before" });
    assert.deepEqual(results[0], {
      ok: false,
      problem: { type: "urn:standards-lab:problem:abort", status: 0, title: "Request aborted" },
    });
    assert.deepEqual(await server.requests(), []);
  });

  test("aborted while an append is in flight is the abort problem", async () => {
    await prepare({ size: 3 * MiB });
    const { results } = await send({ abort: "progress" });
    assert.deepEqual(results[0], {
      ok: false,
      problem: { type: "urn:standards-lab:problem:abort", status: 0, title: "Request aborted" },
    });
  });
});
