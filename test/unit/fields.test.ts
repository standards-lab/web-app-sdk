import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  formatBoolean,
  formatDictionary,
  formatDigest,
  formatInteger,
  parseBoolean,
  parseComplete,
  parseDictionary,
  parseDigest,
  parseInteger,
  parseLimit,
  parseOffset,
} from "../../dist/fields.js";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("an Integer Item", () => {
  test("parses, its parameters ignored and its surrounding spaces trimmed", () => {
    for (const [field, n] of [
      ["0", 0],
      ["42", 42],
      ["-7", -7],
      [" 12 ", 12],
      ["5;a=1;b", 5],
      ["999999999999999", 999_999_999_999_999],
      ["-999999999999999", -999_999_999_999_999],
      ["007", 7],
    ] as const) {
      assert.equal(parseInteger(field), n, field);
    }
  });

  test("is undefined malformed or of another type", () => {
    for (const field of [
      "",
      "1000000000000000",
      "1.5",
      "?1",
      "abc",
      '"5"',
      "5,",
      "5 6",
      "\t5",
      "-",
      "5;",
      "5;A=1",
      ":AQ==:",
    ]) {
      assert.equal(parseInteger(field), undefined, JSON.stringify(field));
    }
  });

  test("formats, refusing a number outside the range or not an integer", () => {
    assert.equal(formatInteger(0), "0");
    assert.equal(formatInteger(-12), "-12");
    assert.equal(formatInteger(999_999_999_999_999), "999999999999999");
    assert.throws(() => formatInteger(1_000_000_000_000_000), RangeError);
    assert.throws(() => formatInteger(1.5), RangeError);
    assert.throws(() => formatInteger(Number.NaN), RangeError);
  });
});

describe("a Boolean Item", () => {
  test("parses ?1 and ?0, its parameters ignored", () => {
    assert.equal(parseBoolean("?1"), true);
    assert.equal(parseBoolean("?0"), false);
    assert.equal(parseBoolean("?1;x"), true);
  });

  test("is undefined malformed or of another type", () => {
    for (const field of ["", "?", "?2", "?10", "1", "true", "?1,?0"]) {
      assert.equal(parseBoolean(field), undefined, JSON.stringify(field));
    }
  });

  test("formats", () => {
    assert.equal(formatBoolean(true), "?1");
    assert.equal(formatBoolean(false), "?0");
  });
});

describe("a Dictionary", () => {
  test("parses Integers, Booleans, and Byte Sequences, any other type null", () => {
    assert.deepEqual(
      parseDictionary(
        'a=1, b, c=?0, d=:AQID:, e="s", f=tok, g=1.5, h=(1 2), i=@1659578233, j=%"%c3%a9"',
      ),
      new Map<string, unknown>([
        ["a", 1],
        ["b", true],
        ["c", false],
        ["d", bytes(1, 2, 3)],
        ["e", null],
        ["f", null],
        ["g", null],
        ["h", null],
        ["i", null],
        ["j", null],
      ]),
    );
  });

  test("keeps a repeated key's first position and last value", () => {
    assert.deepEqual(
      [...(parseDictionary("a=1, b=2, a=3") ?? [])],
      [
        ["a", 3],
        ["b", 2],
      ],
    );
  });

  test("ignores parameters, and takes tabs around a comma", () => {
    assert.deepEqual(
      [...(parseDictionary("a=1;p=2,\tb;q") ?? [])],
      [
        ["a", 1],
        ["b", true],
      ],
    );
  });

  test("is empty for an empty field", () => {
    assert.deepEqual(parseDictionary(""), new Map());
  });

  test("is undefined malformed", () => {
    for (const field of [
      "a=1,",
      "a=1 b=2",
      "A=1",
      "1a=1",
      "a=",
      "a=:AQI:",
      "a=:AQ=:",
      "a=:AR==:",
      "a=:A!==:",
      "a=:AQID",
      'a="unterminated',
      'a="bad\\escape"',
      "a=(1 2",
      "a=(1,2)",
      "a=1.2345",
      "a=@1.5",
      'a=%"%C3"',
      'a=%"%ff"',
      "a=?",
    ]) {
      assert.equal(parseDictionary(field), undefined, JSON.stringify(field));
    }
  });

  test("formats, a true Boolean as its bare key", () => {
    assert.equal(
      formatDictionary(
        new Map<string, number | boolean | Uint8Array>([
          ["a", 1],
          ["b", true],
          ["c", false],
          ["d", bytes(1, 2, 3, 4)],
        ]),
      ),
      "a=1, b, c=?0, d=:AQIDBA==:",
    );
    assert.equal(formatDictionary(new Map()), "");
  });

  test("format refuses a key that isn't a key, or a value it can't carry", () => {
    assert.throws(() => formatDictionary(new Map([["A", 1]])), RangeError);
    assert.throws(() => formatDictionary(new Map([["a", null]])), RangeError);
    assert.throws(() => formatDictionary(new Map([["a", 2 ** 60]])), RangeError);
  });

  test("round-trips every Byte Sequence length", () => {
    for (let size = 0; size < 10; size++) {
      const value = bytes(...Array.from({ length: size }, (_, i) => (i * 97 + 13) & 255));
      const field = formatDictionary(new Map([["x", value]]));
      assert.deepEqual(parseDictionary(field)?.get("x"), value, field);
    }
  });
});

describe("Upload-Offset", () => {
  test("is a non-negative Integer", () => {
    assert.equal(parseOffset("0"), 0);
    assert.equal(parseOffset("1024"), 1024);
  });

  test("is ignored absent, malformed, or negative", () => {
    for (const field of [null, "", "-1", "1.0", "?1", "a"]) {
      assert.equal(parseOffset(field), undefined, JSON.stringify(field));
    }
  });
});

describe("Upload-Complete", () => {
  test("is a Boolean", () => {
    assert.equal(parseComplete("?1"), true);
    assert.equal(parseComplete("?0"), false);
  });

  test("is ignored absent or malformed", () => {
    for (const field of [null, "", "1", "?3"]) {
      assert.equal(parseComplete(field), undefined, JSON.stringify(field));
    }
  });
});

describe("Upload-Limit", () => {
  test("carries the members the draft defines, any other ignored", () => {
    assert.deepEqual(
      parseLimit(
        "max-size=1000, min-size=0, max-append-size=100, min-append-size=1, max-age=60, other=x",
      ),
      { maxSize: 1000, minSize: 0, maxAppendSize: 100, minAppendSize: 1, maxAge: 60 },
    );
    assert.deepEqual(parseLimit("max-append-size=1048576, max-age=3599"), {
      maxAppendSize: 1_048_576,
      maxAge: 3599,
    });
    assert.deepEqual(parseLimit(""), {});
  });

  test("is ignored whole when a member the draft defines is invalid", () => {
    for (const field of [
      "max-append-size=0",
      "max-size=0, max-append-size=10",
      "max-append-size=10, min-size=-1",
      "max-append-size=10, max-age=-1",
      "max-append-size=10, min-append-size=?1",
      "max-append-size=10, max-size=1.5",
      'max-append-size="10"',
      "max-append-size",
    ]) {
      assert.equal(parseLimit(field), undefined, field);
    }
  });

  test("is ignored whole when a minimum exceeds its maximum", () => {
    for (const field of [
      "min-size=10, max-size=9",
      "min-append-size=10, max-append-size=9",
      "min-append-size=10, max-size=9",
    ]) {
      assert.equal(parseLimit(field), undefined, field);
    }
    assert.deepEqual(parseLimit("min-size=10, max-append-size=9"), {
      minSize: 10,
      maxAppendSize: 9,
    });
  });

  test("is ignored absent or malformed", () => {
    assert.equal(parseLimit(null), undefined);
    assert.equal(parseLimit("max-append-size=10,"), undefined);
  });
});

describe("a digest", () => {
  const empty = Buffer.from("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=", "base64");

  test("formats as the sha-256 member", () => {
    assert.equal(
      formatDigest(new Uint8Array(empty)),
      "sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:",
    );
  });

  test("parses from the sha-256 member, other algorithms ignored", () => {
    assert.deepEqual(
      parseDigest("sha-512=:AQ==:, sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:"),
      new Uint8Array(empty),
    );
  });

  test("is ignored when its sha-256 member is absent, not bytes, or not 32 bytes", () => {
    for (const field of [null, "", "sha-512=:AQ==:", "sha-256=1", "sha-256=:AQ==:", "sha-256=:"]) {
      assert.equal(parseDigest(field), undefined, JSON.stringify(field));
    }
  });
});
