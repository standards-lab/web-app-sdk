import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

import { Sha256 } from "../../dist/sha256.js";

const encoder = new TextEncoder();

function hex(...pieces: Uint8Array[]): string {
  const sha = new Sha256();
  for (const piece of pieces) sha.update(piece);
  return Buffer.from(sha.digest()).toString("hex");
}

function bytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + (i >> 8)) & 255;
  return out;
}

describe("Sha256", () => {
  test("matches FIPS 180-4's examples", () => {
    assert.equal(
      hex(encoder.encode("abc")),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assert.equal(
      hex(encoder.encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  test("matches the NIST test vectors' empty, 896-bit, and million-a messages", () => {
    assert.equal(hex(), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(
      hex(
        encoder.encode(
          "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
        ),
      ),
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    );
    assert.equal(
      hex(new Uint8Array(1_000_000).fill(0x61)),
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  test("is node:crypto's for every length across the padding's boundaries", () => {
    for (let size = 0; size <= 200; size++) {
      const data = bytes(size);
      assert.equal(hex(data), createHash("sha256").update(data).digest("hex"), `${size} bytes`);
    }
  });

  test("is the same however the bytes are split", () => {
    const data = bytes(1000);
    const whole = hex(data);
    for (const piece of [1, 3, 63, 64, 65, 127, 500]) {
      const pieces = [];
      for (let at = 0; at < data.length; at += piece) pieces.push(data.subarray(at, at + piece));
      assert.equal(hex(...pieces), whole, `in pieces of ${piece}`);
    }
    assert.equal(hex(new Uint8Array(0), data, new Uint8Array(0)), whole);
  });

  test("is done once it digests", () => {
    const sha = new Sha256();
    sha.digest();
    assert.throws(() => sha.update(new Uint8Array(1)));
    assert.throws(() => sha.digest());
  });
});
