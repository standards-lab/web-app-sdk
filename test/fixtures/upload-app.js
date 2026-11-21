// From spike-html-apps-sdk (df65376): test/fixtures/upload-app.js.

import { createClient } from "@standards-lab/web-app-sdk/api.js";

function body(kind, size) {
  const bytes = new Uint8Array(size).fill(97);
  switch (kind) {
    case "bigint":
      return { size: BigInt(size) };
    case "file":
      return new File([bytes], "upload.bin", { type: "application/octet-stream" });
    case "form": {
      const form = new FormData();
      form.append("note", "hello");
      form.append("file", new File([bytes], "upload.txt", { type: "text/plain" }));
      return form;
    }
    default:
      return new Blob([bytes], { type: "application/octet-stream" });
  }
}

function provider(token, fresh) {
  const p = {
    refreshes: 0,
    token: async () => token,
    refresh: async () => {
      p.refreshes++;
      token = fresh;
      return fresh;
    },
  };
  return p;
}

async function plain(result) {
  if (!result.ok || !(result.data instanceof Blob)) return result;
  const { type, size } = result.data;
  return { ok: true, data: { blob: { type, size, text: await result.data.text() } } };
}

window.upload = async ({ route, kind = "blob", size, token, fresh, method, abort }) => {
  const auth = token === undefined && fresh === undefined ? undefined : provider(token, fresh);
  const client = createClient({ base: "/upload", auth });
  const controller = new AbortController();
  const signal = typeof abort === "number" ? AbortSignal.timeout(abort) : controller.signal;
  const progress = [];
  const result = await client.upload(route, body(kind, size), {
    method,
    signal,
    progress: (sent, total) => {
      progress.push([sent, total]);
      if (abort === "progress" && sent > 0) controller.abort();
    },
  });
  return { result: await plain(result), progress, refreshes: auth?.refreshes ?? 0 };
};
