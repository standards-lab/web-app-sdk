// The application SDK's auth hook: the client asks a TokenProvider for the token each call
// carries. anonymous, the default, is here; an app supplies its own provider.
// From spike-html-apps-sdk (df65376): src/auth.ts.

/** Where the client's bearer token comes from. `token` is the current token, undefined when there
 * is none (the call goes without Authorization); `refresh` obtains a new one after a 401, and the
 * client retries that call once with it, or returns the 401's problem when it is undefined. */
export interface TokenProvider {
  token(): Promise<string | undefined>;
  refresh(): Promise<string | undefined>;
}

/** The default provider: no token, and nothing to refresh, so every call goes anonymous. */
// Frozen, since every client that takes the default shares it.
export const anonymous: TokenProvider = Object.freeze({
  token: async () => undefined,
  refresh: async () => undefined,
});
