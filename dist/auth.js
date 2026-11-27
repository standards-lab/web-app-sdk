// The application SDK's auth hook: the client asks a TokenProvider for the token each call
// carries. anonymous, the default, is here; an app supplies its own provider.
/** The default provider, frozen and shared by every client that takes it: no token, and nothing
 * to refresh, so every call goes anonymous. */
export const anonymous = Object.freeze({
    token: async () => undefined,
    refresh: async () => undefined,
});
