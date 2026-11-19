// The application SDK's auth hook: the client asks a TokenProvider for the token each call
// carries. anonymous, the default, is here; an app supplies its own provider.
// From spike-html-apps-sdk (df65376): src/auth.ts.
/** The default provider: no token, and nothing to refresh, so every call goes anonymous. */
// Frozen, since every client that takes the default shares it.
export const anonymous = Object.freeze({
    token: async () => undefined,
    refresh: async () => undefined,
});
