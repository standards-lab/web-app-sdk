// The browser tier's upload server: test/server's Go module, built with the go on PATH (mise.toml's
// pin, under mise run test:browser) from the module cache alone, and started on a free loopback
// port over the repository's files. Its controls are test/server/main.go's.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { freePort, start } from "@standards-lab/web-tooling/process.js";

const root = join(import.meta.dirname, "../../..");

/** A fault the server's switch fires once, on the first upload request it applies to. */
export type Fault = "unavailable" | "lose-created" | "drop-append" | "reject-complete";

/** One upload request the server received, each header under its lowercase name. */
export interface Received {
  method: string;
  path: string;
  headers: Record<string, string>;
}

/** An upload's state as the server holds it, digest and sha256 in hex. */
export interface State {
  offset: number;
  length: number;
  complete: boolean;
  mediaType: string;
  name: string;
  digest: string;
  size: number;
  sha256: string;
}

/** Builds and starts the server, resolving once it answers, to its origin, its controls, and a
 * stop that ends it and removes its build. */
export async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), "upload-server."));
  try {
    const binary = join(dir, "server");
    execFileSync("go", ["build", "-o", binary, "."], {
      cwd: join(root, "test/server"),
      env: { ...process.env, GOWORK: "off", GOPROXY: "off", GOFLAGS: "-mod=readonly" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const server = await start(binary, ["-root", root, "-addr", `127.0.0.1:${port}`], {
      ready: `${origin}/control/ready`,
    });

    async function control(method: string, path: string, body?: object) {
      const response = await fetch(`${origin}/control${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`${method} /control${path}: ${response.status} ${await response.text()}`);
      }
      return response;
    }

    return {
      origin,
      /** Arms the fault, sets the token every upload request must carry, and sets the handler's
       * max-append-size; none clears each, the max-append-size back to the server's default. */
      async configure({
        fault,
        token,
        limit,
      }: { fault?: Fault; token?: string; limit?: number } = {}) {
        await control("PUT", "", { fault: fault ?? "", token: token ?? "", limit: limit ?? 0 });
      },
      /** The upload requests since the last call. */
      async requests(): Promise<Received[]> {
        return (await control("GET", "/requests")).json() as Promise<Received[]>;
      },
      /** The state of the upload at the location, undefined when the server has none. */
      async state(location: string): Promise<State | undefined> {
        const id = new URL(location).pathname.replace(/^\/uploads\//, "");
        const response = await control("GET", `/uploads/${encodeURIComponent(id)}`);
        if (response.status === 404) return undefined;
        return response.json() as Promise<State>;
      },
      async stop() {
        await server.stop();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** A server startServer started. */
export type UploadServer = Awaited<ReturnType<typeof startServer>>;
