/** A Dictionary member's value: a number for an Integer, a boolean for a Boolean, a Uint8Array for
 * a Byte Sequence, and null for a well-formed member of any other type, an Inner List among them,
 * so that a key present with another type is told apart from an absent key. */
export type MemberValue = number | boolean | Uint8Array | null;
/** A Dictionary, its members in field order with each key once. */
export type Dictionary = Map<string, MemberValue>;
/** The field as an Integer Item; undefined when it is malformed or an Item of another type. */
export declare function parseInteger(field: string): number | undefined;
/** The field as a Boolean Item; undefined when it is malformed or an Item of another type. */
export declare function parseBoolean(field: string): boolean | undefined;
/** The field as a Dictionary; undefined when it is malformed. A key that appears more than once
 * keeps its first position and its last value; an empty field is an empty Dictionary. */
export declare function parseDictionary(field: string): Dictionary | undefined;
/** The Integer Item n is. Throws a RangeError for an n that isn't an integer within
 * ±999,999,999,999,999. */
export declare function formatInteger(n: number): string;
/** The Boolean Item b is: ?1 or ?0. */
export declare function formatBoolean(b: boolean): string;
/** The Dictionary d is, a true Boolean member as its bare key; the empty string for an empty d.
 * Throws a RangeError for a key that isn't a structured field key, an Integer out of range, or a
 * null value. */
export declare function formatDictionary(d: Dictionary): string;
/** The members of an Upload-Limit the draft defines, each in its own range. */
export interface Limits {
    maxSize?: number;
    minSize?: number;
    maxAppendSize?: number;
    minAppendSize?: number;
    maxAge?: number;
}
/** The Upload-Limit field's limits. A member the draft doesn't define is ignored. The field is
 * ignored whole, undefined, when it is absent or malformed, when a member the draft defines isn't
 * an Integer at or above its floor (1 for max-size and max-append-size, 0 for the rest), or when a
 * minimum exceeds its maximum: min-size max-size, or min-append-size max-append-size or
 * max-size. */
export declare function parseLimit(field: string | null): Limits | undefined;
/** The Upload-Offset field's offset: undefined when it is absent, malformed, or negative. */
export declare function parseOffset(field: string | null): number | undefined;
/** The Upload-Complete field's value: undefined when it is absent or malformed. */
export declare function parseComplete(field: string | null): boolean | undefined;
/** The 32-byte SHA-256 a Repr-Digest or Content-Digest field carries as its sha-256 member;
 * undefined when the field is absent or malformed, or its sha-256 member is absent, not a Byte
 * Sequence, or not 32 bytes. Members for other algorithms are ignored. */
export declare function parseDigest(field: string | null): Uint8Array | undefined;
/** The Repr-Digest or Content-Digest field that carries the SHA-256 as its sha-256 member. */
export declare function formatDigest(sha256: Uint8Array): string;
