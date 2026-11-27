// The application SDK's router, on URLPattern and the Navigation API: it matches each navigation
// under its base against the route table and mounts the route's element in its outlet.
/** Makes a router over `routes`. */
export function createRouter(routes, options) {
    return new AppRouter(routes, options);
}
const preloaded = Symbol("preloaded");
function baseOf(option) {
    const element = document.querySelector("base");
    const path = option ?? (element?.hasAttribute("href") ? new URL(element.href).pathname : undefined) ?? "/";
    return path.endsWith("/") ? path : `${path}/`;
}
const literal = (text) => text.replace(/[\\:*?+(){}]/g, "\\$&");
async function defined(entry) {
    const tag = typeof entry === "string" ? entry : await entry();
    if (!customElements.get(tag))
        throw new Error(`<${tag}> is not a defined custom element`);
    return tag;
}
class AppRouter extends EventTarget {
    #outlet;
    #base;
    #notFound;
    #error;
    #table;
    #current;
    #mountedPath;
    #started = false;
    #turn = 0;
    constructor(routes, options) {
        super();
        this.#outlet = options.outlet;
        this.#base = baseOf(options.base);
        this.#notFound = options.notFound;
        this.#error = options.error;
        this.#table = Object.entries(routes).map(([pattern, entry]) => ({
            pattern,
            entry,
            matcher: new URLPattern({ pathname: literal(this.#base) + pattern.replace(/^\/+/, "") }),
        }));
    }
    get current() {
        return this.#current;
    }
    async start() {
        if (this.#started)
            return;
        this.#started = true;
        navigation.addEventListener("navigate", this.#onNavigate);
        const turn = ++this.#turn;
        try {
            const mount = await this.#prepare(new URL(location.href));
            if (turn === this.#turn)
                this.#commit(mount, location.pathname);
        }
        catch (error) {
            if (turn === this.#turn)
                await this.#fail(turn);
            throw error;
        }
    }
    stop() {
        this.#started = false;
        navigation.removeEventListener("navigate", this.#onNavigate);
    }
    async navigate(path, options = {}) {
        if (!this.#started)
            throw new Error("the router isn't started: call start() first");
        const url = new URL(path.replace(/^\/+/, ""), new URL(this.#base, location.origin));
        const info = url.pathname === this.#mountedPath ? undefined : { [preloaded]: await this.#prepare(url) };
        const history = options.replace ? "replace" : "push";
        await navigation.navigate(url.href, { history, info }).finished;
    }
    async query(changes, options = {}) {
        if (!this.#started)
            throw new Error("the router isn't started: call start() first");
        const url = new URL(location.href);
        for (const [name, value] of Object.entries(changes)) {
            if (value === undefined)
                url.searchParams.delete(name);
            else
                url.searchParams.set(name, value);
        }
        const history = options.replace === false ? "push" : "replace";
        await navigation.navigate(url.href, { history }).finished;
    }
    #onNavigate = (event) => {
        const url = new URL(event.destination.url);
        if (!event.canIntercept ||
            event.hashChange ||
            event.downloadRequest !== null ||
            event.formData !== null ||
            event.navigationType === "reload" ||
            url.origin !== location.origin ||
            !url.pathname.startsWith(this.#base)) {
            return;
        }
        const turn = ++this.#turn;
        if (url.pathname === this.#mountedPath) {
            event.intercept({
                focusReset: "manual",
                scroll: "manual",
                handler: async () => {
                    if (turn !== this.#turn)
                        return;
                    if (this.#current)
                        this.#current = { ...this.#current, query: url.searchParams };
                    this.dispatchEvent(new Event("change"));
                },
            });
            return;
        }
        const info = event.info;
        event.intercept({
            handler: async () => {
                try {
                    const mount = info?.[preloaded] ?? (await this.#prepare(url));
                    if (turn === this.#turn)
                        this.#commit(mount, url.pathname);
                }
                catch (error) {
                    if (turn === this.#turn)
                        await this.#fail(turn);
                    throw error;
                }
            },
        });
    };
    async #prepare(url) {
        const { pathname, searchParams: query } = url;
        const route = pathname.startsWith(this.#base)
            ? this.#table.find(({ matcher }) => matcher.test({ pathname }))
            : undefined;
        if (!route) {
            const element = this.#notFound ? document.createElement(await defined(this.#notFound)) : null;
            return { match: undefined, element };
        }
        const groups = route.matcher.exec({ pathname })?.pathname.groups ?? {};
        const params = {};
        for (const [name, value] of Object.entries(groups)) {
            if (value !== undefined && !/^\d+$/.test(name))
                params[name] = value;
        }
        const tag = await defined(route.entry);
        const element = document.createElement(tag);
        for (const [name, value] of Object.entries(params))
            element.setAttribute(name, value);
        return { match: { pattern: route.pattern, tag, params, query }, element };
    }
    #commit({ match, element }, path) {
        this.#outlet.replaceChildren(...(element ? [element] : []));
        this.#current = match;
        this.#mountedPath = path;
        this.dispatchEvent(new Event("change"));
    }
    async #fail(turn) {
        let element = null;
        if (this.#error) {
            try {
                element = document.createElement(await defined(this.#error));
            }
            catch { }
        }
        if (turn !== this.#turn)
            return;
        this.#outlet.replaceChildren(...(element ? [element] : []));
        this.#current = undefined;
        this.#mountedPath = undefined;
        this.dispatchEvent(new Event("change"));
    }
}
