// The module the router fixture's lazy route loads: it defines its element on its first import.
// From spike-html-apps-sdk (df65376): test/fixtures/router-lazy.js.

export const tag = "x-lazy";

customElements.define(tag, class extends HTMLElement {});
