// The resumable upload's fields as RFC 9651 Structured Fields: Integer and Boolean Items, and
// Dictionaries whose members are Integers, Booleans, or Byte Sequences, read and written; and the
// draft's own reading of them: Upload-Offset, Upload-Complete, Upload-Limit, and a Repr-Digest or
// Content-Digest's sha-256 member. A parser accepts any well-formed field, ignoring parameters,
// and returns undefined for a malformed one.
// See https://www.rfc-editor.org/rfc/rfc9651

const MAX_INTEGER = 999_999_999_999_999;

/** A Dictionary member's value: a number for an Integer, a boolean for a Boolean, a Uint8Array for
 * a Byte Sequence, and null for a well-formed member of any other type, an Inner List among them,
 * so that a key present with another type is told apart from an absent key. */
export type MemberValue = number | boolean | Uint8Array | null;

/** A Dictionary, its members in field order with each key once. */
export type Dictionary = Map<string, MemberValue>;

class Malformed extends Error {}

class Parser {
  s: string;

  constructor(field: string) {
    this.s = field.replace(/^ +| +$/g, "");
  }

  peek(): string {
    return this.s[0] ?? "";
  }

  advance(n: number) {
    this.s = this.s.slice(n);
  }

  dictionary(): Dictionary {
    const d: Dictionary = new Map();
    while (this.s !== "") {
      const key = this.key();
      let value: MemberValue = true;
      if (this.peek() === "=") {
        this.advance(1);
        value = this.itemOrInnerList();
      } else {
        this.parameters();
      }
      d.set(key, value);
      this.s = this.s.replace(/^[ \t]+/, "");
      if (this.s === "") break;
      if (this.peek() !== ",") throw new Malformed();
      this.advance(1);
      this.s = this.s.replace(/^[ \t]+/, "");
      if (this.s === "") throw new Malformed();
    }
    return d;
  }

  itemOrInnerList(): MemberValue {
    if (this.peek() !== "(") return this.item();
    this.advance(1);
    while (this.s !== "") {
      this.s = this.s.replace(/^ +/, "");
      if (this.peek() === ")") {
        this.advance(1);
        this.parameters();
        return null;
      }
      this.item();
      if (this.peek() !== " " && this.peek() !== ")") throw new Malformed();
    }
    throw new Malformed();
  }

  item(): MemberValue {
    const value = this.bareItem();
    this.parameters();
    return value;
  }

  parameters() {
    while (this.peek() === ";") {
      this.advance(1);
      this.s = this.s.replace(/^ +/, "");
      this.key();
      if (this.peek() === "=") {
        this.advance(1);
        this.bareItem();
      }
    }
  }

  key(): string {
    const match = /^[a-z*][a-z0-9_\-.*]*/.exec(this.s);
    if (!match) throw new Malformed();
    this.advance(match[0].length);
    return match[0];
  }

  bareItem(): MemberValue {
    const c = this.peek();
    if (c === "-" || isDigit(c)) return this.number();
    if (c === '"') return this.string();
    if (c === "*" || /^[A-Za-z]$/.test(c)) return this.token();
    if (c === ":") return this.byteSequence();
    if (c === "?") return this.boolean();
    if (c === "@") return this.date();
    if (c === "%") return this.displayString();
    throw new Malformed();
  }

  number(): number | null {
    let negative = false;
    if (this.peek() === "-") {
      negative = true;
      this.advance(1);
    }
    if (!isDigit(this.peek())) throw new Malformed();
    let i = 0;
    let dot = -1;
    for (; i < this.s.length; i++) {
      const c = this.s[i];
      if (c === "." && dot < 0) {
        if (i > 12) throw new Malformed();
        dot = i;
      } else if (!isDigit(c)) {
        break;
      }
      if ((dot < 0 && i + 1 > 15) || (dot >= 0 && i + 1 > 16)) throw new Malformed();
    }
    const digits = this.s.slice(0, i);
    this.advance(i);
    if (dot >= 0) {
      const fraction = digits.length - dot - 1;
      if (fraction < 1 || fraction > 3) throw new Malformed();
      return null;
    }
    const n = Number(digits);
    return negative ? -n : n;
  }

  string(): null {
    for (let i = 1; i < this.s.length; i++) {
      const c = this.s.charCodeAt(i);
      if (c === 0x5c) {
        i++;
        if (i === this.s.length || (this.s[i] !== '"' && this.s[i] !== "\\")) {
          throw new Malformed();
        }
      } else if (c === 0x22) {
        this.advance(i + 1);
        return null;
      } else if (c < 0x20 || c > 0x7e) {
        throw new Malformed();
      }
    }
    throw new Malformed();
  }

  token(): null {
    const match = /^[*A-Za-z][!#$%&'*+\-.^_`|~0-9A-Za-z:/]*/.exec(this.s);
    this.advance(match?.[0].length ?? 1);
    return null;
  }

  byteSequence(): Uint8Array {
    const end = this.s.indexOf(":", 1);
    if (end < 0) throw new Malformed();
    const bytes = fromBase64(this.s.slice(1, end));
    if (bytes === undefined) throw new Malformed();
    this.advance(end + 1);
    return bytes;
  }

  boolean(): boolean {
    const c = this.s[1];
    if (c !== "0" && c !== "1") throw new Malformed();
    this.advance(2);
    return c === "1";
  }

  date(): null {
    this.advance(1);
    const c = this.peek();
    if (c !== "-" && !isDigit(c)) throw new Malformed();
    if (this.number() === null) throw new Malformed();
    return null;
  }

  displayString(): null {
    if (this.s[1] !== '"') throw new Malformed();
    const bytes: number[] = [];
    for (let i = 2; i < this.s.length; i++) {
      const c = this.s.charCodeAt(i);
      if (c === 0x25) {
        const hex = this.s.slice(i + 1, i + 3);
        if (!/^[0-9a-f]{2}$/.test(hex)) throw new Malformed();
        bytes.push(parseInt(hex, 16));
        i += 2;
      } else if (c === 0x22) {
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
        } catch {
          throw new Malformed();
        }
        this.advance(i + 1);
        return null;
      } else if (c < 0x20 || c > 0x7e) {
        throw new Malformed();
      } else {
        bytes.push(c);
      }
    }
    throw new Malformed();
  }
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9" && c.length === 1;
}

function parse<T>(field: string, read: (parser: Parser) => T): T | undefined {
  const parser = new Parser(field);
  try {
    const value = read(parser);
    return parser.s === "" ? value : undefined;
  } catch (error) {
    if (error instanceof Malformed) return undefined;
    throw error;
  }
}

/** The field as an Integer Item; undefined when it is malformed or an Item of another type. */
export function parseInteger(field: string): number | undefined {
  const value = parse(field, (parser) => parser.item());
  return typeof value === "number" ? value : undefined;
}

/** The field as a Boolean Item; undefined when it is malformed or an Item of another type. */
export function parseBoolean(field: string): boolean | undefined {
  const value = parse(field, (parser) => parser.item());
  return typeof value === "boolean" ? value : undefined;
}

/** The field as a Dictionary; undefined when it is malformed. A key that appears more than once
 * keeps its first position and its last value; an empty field is an empty Dictionary. */
export function parseDictionary(field: string): Dictionary | undefined {
  return parse(field, (parser) => parser.dictionary());
}

/** The Integer Item n is. Throws a RangeError for an n that isn't an integer within
 * ±999,999,999,999,999. */
export function formatInteger(n: number): string {
  if (!Number.isInteger(n) || Math.abs(n) > MAX_INTEGER) {
    throw new RangeError(`${n} is not a structured field Integer`);
  }
  return String(n);
}

/** The Boolean Item b is: ?1 or ?0. */
export function formatBoolean(b: boolean): string {
  return b ? "?1" : "?0";
}

/** The Dictionary d is, a true Boolean member as its bare key; the empty string for an empty d.
 * Throws a RangeError for a key that isn't a structured field key, an Integer out of range, or a
 * null value. */
export function formatDictionary(d: Dictionary): string {
  const members: string[] = [];
  for (const [key, value] of d) {
    if (!/^[a-z*][a-z0-9_\-.*]*$/.test(key)) {
      throw new RangeError(`${JSON.stringify(key)} is not a structured field key`);
    }
    if (value === true) members.push(key);
    else if (value === false) members.push(`${key}=?0`);
    else if (typeof value === "number") members.push(`${key}=${formatInteger(value)}`);
    else if (value instanceof Uint8Array) members.push(`${key}=:${toBase64(value)}:`);
    else throw new RangeError(`member ${key} has no value a Dictionary carries`);
  }
  return members.join(", ");
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[n >>> 18] + ALPHABET[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >>> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : "=";
  }
  return out;
}

function fromBase64(text: string): Uint8Array | undefined {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return undefined;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - pad);
  for (let i = 0, at = 0; i < text.length; i += 4) {
    const digits = [...text.slice(i, i + 4)].map((c) => (c === "=" ? 0 : ALPHABET.indexOf(c)));
    const n = (digits[0] << 18) | (digits[1] << 12) | (digits[2] << 6) | digits[3];
    if (i + 4 === text.length && ((pad === 2 && n & 0xffff) || (pad === 1 && n & 0xff))) {
      return undefined;
    }
    for (const shift of [16, 8, 0]) if (at < bytes.length) bytes[at++] = (n >>> shift) & 0xff;
  }
  return bytes;
}

/** The members of an Upload-Limit the draft defines, each in its own range. */
export interface Limits {
  maxSize?: number;
  minSize?: number;
  maxAppendSize?: number;
  minAppendSize?: number;
  maxAge?: number;
}

const LIMITS: Record<string, [keyof Limits, number]> = {
  "max-size": ["maxSize", 1],
  "min-size": ["minSize", 0],
  "max-append-size": ["maxAppendSize", 1],
  "min-append-size": ["minAppendSize", 0],
  "max-age": ["maxAge", 0],
};

/** The Upload-Limit field's limits. A member the draft doesn't define is ignored. The field is
 * ignored whole, undefined, when it is absent or malformed, when a member the draft defines isn't
 * an Integer at or above its floor (1 for max-size and max-append-size, 0 for the rest), or when a
 * minimum exceeds its maximum: min-size max-size, or min-append-size max-append-size or
 * max-size. */
export function parseLimit(field: string | null): Limits | undefined {
  const d = field === null ? undefined : parseDictionary(field);
  if (d === undefined) return undefined;
  const limits: Limits = {};
  for (const [key, value] of d) {
    const known = LIMITS[key];
    if (known === undefined) continue;
    const [name, floor] = known;
    if (typeof value !== "number" || value < floor) return undefined;
    limits[name] = value;
  }
  const ordered = (low?: number, high?: number) =>
    low === undefined || high === undefined || low <= high;
  if (
    !ordered(limits.minSize, limits.maxSize) ||
    !ordered(limits.minAppendSize, limits.maxAppendSize) ||
    !ordered(limits.minAppendSize, limits.maxSize)
  ) {
    return undefined;
  }
  return limits;
}

/** The Upload-Offset field's offset: undefined when it is absent, malformed, or negative. */
export function parseOffset(field: string | null): number | undefined {
  const n = field === null ? undefined : parseInteger(field);
  return n !== undefined && n >= 0 ? n : undefined;
}

/** The Upload-Complete field's value: undefined when it is absent or malformed. */
export function parseComplete(field: string | null): boolean | undefined {
  return field === null ? undefined : parseBoolean(field);
}

/** The 32-byte SHA-256 a Repr-Digest or Content-Digest field carries as its sha-256 member;
 * undefined when the field is absent or malformed, or its sha-256 member is absent, not a Byte
 * Sequence, or not 32 bytes. Members for other algorithms are ignored. */
export function parseDigest(field: string | null): Uint8Array | undefined {
  const member = field === null ? undefined : parseDictionary(field)?.get("sha-256");
  return member instanceof Uint8Array && member.length === 32 ? member : undefined;
}

/** The Repr-Digest or Content-Digest field that carries the SHA-256 as its sha-256 member. */
export function formatDigest(sha256: Uint8Array): string {
  return formatDictionary(new Map([["sha-256", sha256]]));
}
