import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import type { Result } from "@standards-lab/web-app-sdk/api.js";
import { launch, type Browser, type Page } from "@standards-lab/web-tooling/browser.js";
import { serve, type Server } from "@standards-lab/web-tooling/server.js";

import { routes } from "./support/upload.ts";

let server: Server;
let browser: Browser;
let page: Page;

before(async () => {
  server = await serve({ root: join(import.meta.dirname, "../.."), handler: routes().handler });
  browser = await launch();
  page = await browser.open(`${server.origin}/test/fixtures/upload.html`);
});
after(async () => {
  await browser?.close();
  await server?.stop();
});

const LARGE = 16 * 1024 * 1024;

interface Spec {
  route: string;
  kind?: "blob" | "file" | "form" | "bigint";
  size: number;
  token?: string;
  fresh?: string;
  method?: "POST" | "PUT";
  abort?: "progress" | number;
}

interface Echo {
  method: string;
  type: string;
  authorization: string | null;
  size: number;
  text: string | null;
}

interface Uploaded {
  result: Result<Echo>;
  progress: [number, number][];
  refreshes: number;
}

const upload = (spec: Spec): Promise<Uploaded> => page.evaluate(`upload(${JSON.stringify(spec)})`);

function dataOf<T>(result: Result<T>): T {
  assert.ok(result.ok, JSON.stringify(result.ok ? undefined : result.problem));
  return result.data;
}

function oneSend(progress: [number, number][], total: number) {
  assert.deepEqual(progress[0], [0, total]);
  assert.deepEqual(progress.at(-1), [total, total]);
  for (let at = 1; at < progress.length; at++) {
    assert.equal(progress[at][1], total);
    assert.ok(progress[at][0] >= progress[at - 1][0], `progress went back: ${progress}`);
  }
  return progress.filter(([sent]) => sent > 0 && sent < total).length;
}

describe("the upload's progress", () => {
  test("goes from 0 to the total, never back, through the bytes sent between", async () => {
    const { result, progress } = await upload({ route: "echo", size: LARGE });
    assert.equal(result.ok, true);
    assert.equal(result.data.size, LARGE);
    assert.ok(oneSend(progress, LARGE) >= 2, `too few progress calls: ${progress}`);
  });
});

describe("the upload's request", () => {
  test("is a POST by default, its Blob sent as it is with its type", async () => {
    const { result } = await upload({ route: "echo", size: 1000 });
    assert.deepEqual(dataOf(result), {
      method: "POST",
      type: "application/octet-stream",
      authorization: null,
      size: 1000,
      text: "a".repeat(1000),
    });
  });

  test("is a PUT when asked, a File sent as it is", async () => {
    const { result } = await upload({ route: "echo", kind: "file", size: 10, method: "PUT" });
    assert.equal(dataOf(result).method, "PUT");
    assert.equal(dataOf(result).size, 10);
  });

  test("sends a FormData as multipart/form-data, its parts and progress whole", async () => {
    const { result, progress } = await upload({ route: "echo", kind: "form", size: 10 });
    assert.match(dataOf(result).type, /^multipart\/form-data; boundary=/);
    assert.match(dataOf(result).text ?? "", /name="note"\r\n\r\nhello\r\n/);
    assert.match(dataOf(result).text ?? "", /name="file"; filename="upload.txt"\r\n/);
    oneSend(progress, dataOf(result).size);
  });

  test("carries Authorization: Bearer <token> when the provider gives one", async () => {
    const { result } = await upload({ route: "echo", size: 10, token: "abc" });
    assert.equal(dataOf(result).authorization, "Bearer abc");
  });
});

describe("the upload's Result", () => {
  test("JSON is parsed", async () => {
    const { result } = await upload({ route: "echo", size: 10 });
    assert.equal(dataOf(result).size, 10);
  });

  test("text/* is a string", async () => {
    assert.deepEqual((await upload({ route: "text", size: 10 })).result, {
      ok: true,
      data: "received 10",
    });
  });

  test("any other type is a Blob", async () => {
    assert.deepEqual((await upload({ route: "bytes", size: 10 })).result, {
      ok: true,
      data: { blob: { type: "application/octet-stream", size: 3, text: "abc" } },
    });
  });

  test("no body is undefined", async () => {
    assert.deepEqual((await upload({ route: "empty", size: 10 })).result, { ok: true });
  });

  test("a 2xx body that doesn't decode is the decode problem", async () => {
    const { result } = await upload({ route: "malformed", size: 10 });
    assert.equal(result.ok, false);
    assert.equal(result.problem.type, "urn:standards-lab:problem:decode");
    assert.equal(result.problem.status, 200);
  });

  test("a problem document is the problem", async () => {
    assert.deepEqual((await upload({ route: "problem", size: 10 })).result, {
      ok: false,
      problem: {
        type: "urn:lab:too-large",
        status: 413,
        title: "Upload too large",
        detail: "10 bytes",
      },
    });
  });

  test("any other failing response is about:blank, titled with its status text", async () => {
    assert.deepEqual((await upload({ route: "failure", size: 10 })).result, {
      ok: false,
      problem: { type: "about:blank", status: 503, title: "Service Unavailable" },
    });
  });
});

describe("the upload's 401", () => {
  test("refreshes and retries once with the new token, its progress starting again", async () => {
    const size = 1024 * 1024;
    const { result, progress, refreshes } = await upload({
      route: "auth",
      size,
      token: "stale",
      fresh: "fresh",
    });
    assert.deepEqual(result, { ok: true, data: { authorized: true, size } });
    assert.equal(refreshes, 1);
    const restart = progress.findLastIndex(([sent]) => sent === 0);
    assert.ok(restart > 0, `progress never started again: ${progress}`);
    oneSend(progress.slice(0, restart), size);
    oneSend(progress.slice(restart), size);
  });

  test("returns the 401's problem when the refresh gives no token", async () => {
    const { result, refreshes } = await upload({ route: "auth", size: 10, token: "stale" });
    assert.deepEqual(result, {
      ok: false,
      problem: { type: "about:blank", status: 401, title: "Unauthorized" },
    });
    assert.equal(refreshes, 1);
  });
});

describe("the problems the upload makes itself", () => {
  test("a body JSON.stringify can't encode is the encode problem, nothing sent", async () => {
    const { result, progress } = await upload({ route: "echo", kind: "bigint", size: 10 });
    assert.equal(result.ok, false);
    const { detail, ...problem } = result.problem;
    assert.deepEqual(problem, {
      type: "urn:standards-lab:problem:encode",
      status: 0,
      title: "Request not encodable",
    });
    assert.match(detail ?? "", /BigInt/);
    assert.deepEqual(progress, []);
  });

  test("the caller's signal aborting mid-body is the abort problem", async () => {
    const { result, progress } = await upload({ route: "echo", size: LARGE, abort: "progress" });
    assert.deepEqual(result, {
      ok: false,
      problem: { type: "urn:standards-lab:problem:abort", status: 0, title: "Request aborted" },
    });
    const [[sent]] = progress.slice(-1);
    assert.ok(sent < LARGE, `the body was sent whole: ${progress}`);
  });

  test("an AbortSignal.timeout firing is the timeout problem", async () => {
    assert.deepEqual((await upload({ route: "hang", size: 10, abort: 100 })).result, {
      ok: false,
      problem: { type: "urn:standards-lab:problem:timeout", status: 0, title: "Request timed out" },
    });
  });

  test("the socket destroyed mid-body is the network problem", async () => {
    const { result } = await upload({ route: "drop", size: LARGE });
    assert.deepEqual(result, {
      ok: false,
      problem: {
        type: "urn:standards-lab:problem:network",
        status: 0,
        title: "Network error",
        detail: "POST /upload/drop failed",
      },
    });
  });
});
