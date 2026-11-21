// From spike-html-apps-sdk (df65376): test/fixtures/router-app.js.

import { createRouter } from "@standards-lab/web-app-sdk/router.js";

for (const tag of ["x-home", "x-about", "x-user", "x-not-found", "x-error"]) {
  customElements.define(tag, class extends HTMLElement {});
}

window.loads = 0;

const routes = {
  "": "x-home",
  about: "x-about",
  "users/:user": "x-user",
  "users/me": "x-about",
  lazy: () => {
    window.loads += 1;
    return import("/test/fixtures/router-lazy.js").then((module) => module.tag);
  },
  broken: () => Promise.reject(new Error("the broken route's loader failed")),
  ghost: async () => "x-ghost",
};

const links = {
  home: "",
  about: "about",
  user: "users/42",
  me: "users/me",
  lazy: "lazy",
  broken: "broken",
  ghost: "ghost",
  nowhere: "nowhere",
};

const outlet = document.getElementById("outlet");

window.setup = ({ base, baseElement, prefix = "/", notFound = false, error = false } = {}) => {
  if (baseElement !== undefined) {
    const element = document.createElement("base");
    element.href = baseElement;
    document.head.prepend(element);
  }
  const nav = document.getElementById("links");
  nav.replaceChildren(
    ...Object.entries(links).map(([id, path]) => {
      const link = document.createElement("a");
      link.id = id;
      link.href = prefix + path;
      link.textContent = id;
      return link;
    }),
  );
  const extra = [
    ["outside", "/outside/page"],
    ["fragment", "#section"],
    ["download", `${prefix}file`],
  ];
  for (const [id, href] of extra) {
    const link = document.createElement("a");
    link.id = id;
    link.href = href;
    link.textContent = id;
    if (id === "download") link.download = "file.txt";
    nav.append(link);
  }
  document.getElementById("post").action = `${prefix}posted`;

  window.router = createRouter(routes, {
    outlet,
    base,
    notFound: notFound ? "x-not-found" : undefined,
    error: error ? "x-error" : undefined,
  });
  window.changes = [];
  window.router.addEventListener("change", () => window.changes.push(window.snapshot()));
  window.navigateErrors = [];
  navigation.addEventListener("navigateerror", (event) =>
    window.navigateErrors.push(event.error.message),
  );
  window.navigates = [];
  navigation.addEventListener("navigate", (event) => window.navigates.push(event.navigationType));
};

window.snapshot = () => {
  const { current: match } = window.router;
  const current = match === undefined ? "undefined" : { ...match, query: match.query.toString() };
  return {
    url: location.pathname + location.search + location.hash,
    outlet: outlet.innerHTML,
    current,
  };
};

window.nextChange = () =>
  new Promise((resolve) => {
    window.router.addEventListener("change", () => resolve(window.snapshot()), { once: true });
  });

window.settle = (promise) =>
  promise.then(
    () => "resolved",
    (error) => `rejected: ${error.message}`,
  );
