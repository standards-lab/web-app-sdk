import {
  createUploader,
  DRAFT_REVISION,
  INTEROP_VERSION,
} from "@standards-lab/web-app-sdk/upload.js";
import { Sha256 } from "/dist/sha256.js";

function bytes(size) {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + (i >> 8)) & 255;
  return out;
}

function file(kind, size, name, type) {
  if (kind === "blob") return new Blob([bytes(size)], { type });
  return new File([bytes(size)], name, { type });
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

const hex = (digest) =>
  [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

window.constants = { DRAFT_REVISION, INTEROP_VERSION };

window.create = async ({
  path = "uploads",
  kind = "file",
  size,
  name = "report.bin",
  type = "application/octet-stream",
  token,
  fresh,
  attempts = 1,
  delay = 0,
  abort,
}) => {
  const auth = token === undefined && fresh === undefined ? undefined : provider(token, fresh);
  const uploader = createUploader({ base: "/", auth, attempts, delay });
  const signal =
    abort === "before"
      ? AbortSignal.abort()
      : typeof abort === "number"
        ? AbortSignal.timeout(abort)
        : undefined;
  const slices = [];
  const slice = Blob.prototype.slice;
  Blob.prototype.slice = function (...args) {
    const piece = slice.apply(this, args);
    slices.push(piece.size);
    return piece;
  };
  try {
    const result = await uploader.create(path, file(kind, size, name, type), { signal });
    const plain = result.ok ? { ok: true, data: { location: result.data.location } } : result;
    return { result: plain, refreshes: auth?.refreshes ?? 0, slices };
  } finally {
    Blob.prototype.slice = slice;
  }
};

window.head = async (location) => {
  const response = await fetch(location, {
    method: "HEAD",
    headers: { "Upload-Draft-Interop-Version": String(INTEROP_VERSION) },
  });
  return {
    status: response.status,
    offset: response.headers.get("Upload-Offset"),
    length: response.headers.get("Upload-Length"),
  };
};

window.digests = async (sizes) => {
  const out = [];
  for (const size of sizes) {
    const data = bytes(size);
    const whole = new Sha256();
    whole.update(data);
    const pieces = new Sha256();
    for (let at = 0; at < size; at += 1000) pieces.update(data.subarray(at, at + 1000));
    out.push({
      size,
      whole: hex(whole.digest()),
      pieces: hex(pieces.digest()),
      subtle: hex(await crypto.subtle.digest("SHA-256", data)),
    });
  }
  return out;
};
