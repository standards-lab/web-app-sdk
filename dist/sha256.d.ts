/** A SHA-256 in progress: `update` feeds it bytes, in as many pieces as the caller has, and
 * `digest` returns the 32-byte hash of every byte fed. A Sha256 is done once `digest` returns;
 * `update` or `digest` after it throws. */
export declare class Sha256 {
    #private;
    /** Feeds the bytes. */
    update(bytes: Uint8Array): void;
    /** The hash of every byte fed. */
    digest(): Uint8Array;
}
