// The NATS tier's server: the nats-server NATS_SERVER names (mise.toml's pin, which mise run
// test:unit passes), started with a generated config on the loopback address, its WebSocket
// listener without TLS, JetStream in a temporary store, and an authorization token.
// Adapted from spike-html-apps-sdk (df65376): test/unit/nats-server.ts.

import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

const patience = 5000;

/** Starts a server that accepts `token`, resolving once it is ready, to its WebSocket URL, its
 * monitoring URL, a restart on the same ports and store, and a stop that removes the store. */
export async function startServer({ token }: { token: string }) {
  const executable = process.env.NATS_SERVER ?? "";
  if (!executable) throw new Error("NATS_SERVER names no nats-server: run mise run test:unit");
  const dir = mkdtempSync(join(tmpdir(), "nats-server."));
  const config = join(dir, "nats.conf");
  const ports = { client: -1, websocket: -1, monitor: -1 };
  const write = () =>
    writeFileSync(
      config,
      [
        `listen: "127.0.0.1:${ports.client}"`,
        `http: "127.0.0.1:${ports.monitor}"`,
        `authorization { token: ${JSON.stringify(token)} }`,
        `websocket { listen: "127.0.0.1:${ports.websocket}", no_tls: true }`,
        `jetstream { store_dir: ${JSON.stringify(join(dir, "store"))} }`,
      ].join("\n"),
    );

  let child!: ChildProcessByStdio<null, null, Readable>;
  let exited!: Promise<number | null>;
  const orphan = () => child?.kill("SIGKILL");
  process.once("exit", orphan);

  async function run() {
    write();
    child = spawn(executable, ["-c", config], { stdio: ["ignore", "ignore", "pipe"] });
    exited = new Promise((resolve) => child.once("exit", resolve));
    let log = "";
    child.stderr.setEncoding("utf8");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`nats-server didn't start: ${log}`)),
        patience,
      );
      exited.then((code) => reject(new Error(`nats-server exited ${code}: ${log}`)));
      child.stderr.on("data", (chunk: string) => {
        log = (log + chunk).slice(-8000);
        if (!log.includes("Server is ready")) return;
        clearTimeout(timer);
        resolve();
      });
    });
    const port = (pattern: RegExp) => {
      const match = pattern.exec(log);
      if (!match) throw new Error(`nats-server's log names no port for ${pattern}: ${log}`);
      return Number(match[1]);
    };
    ports.client = port(/client connections on 127\.0\.0\.1:(\d+)/);
    ports.websocket = port(/websocket clients on ws:\/\/127\.0\.0\.1:(\d+)/);
    ports.monitor = port(/http monitor on 127\.0\.0\.1:(\d+)/);
  }

  async function halt() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), patience);
    await exited;
    clearTimeout(timer);
  }

  try {
    await run();
  } catch (error) {
    await halt();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }

  return {
    url: `ws://127.0.0.1:${ports.websocket}`,
    clientPort: ports.client,
    monitor: `http://127.0.0.1:${ports.monitor}`,
    async restart() {
      await halt();
      await run();
    },
    async stop() {
      process.off("exit", orphan);
      await halt();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A server startServer started. */
export type NatsServer = Awaited<ReturnType<typeof startServer>>;
