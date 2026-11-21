// An in-memory EventSequence, the contract's reference implementation: events appended to an array,
// each read a generator over it that waits for the next append.
// From spike-html-apps-sdk (df65376): test/unit/memory-sequence.ts.

import { UnknownCursorError } from "@standards-lab/web-app-sdk/events.js";
import type {
  CloudEvent,
  Cursor,
  Delivery,
  EventSequence,
  ReadOptions,
} from "@standards-lab/web-app-sdk/events.js";

/** How the sequence is made: `keep`, the most events it keeps, the oldest discarded past it; every
 * event when absent. */
export interface MemoryOptions {
  keep?: number;
}

/** An in-memory sequence holding `events`, in order, and the append that adds one, waking every
 * read that waits. Its cursor is an event's position, from 1, as a decimal string: one never given
 * out (not a position, or past the last event appended) is unknown, and fails the read with an
 * UnknownCursorError. */
export function memorySequence(events: readonly CloudEvent[] = [], options: MemoryOptions = {}) {
  const kept: CloudEvent[] = [];
  let first = 1;
  const waiting = new Set<() => void>();

  async function append(event: CloudEvent): Promise<void> {
    kept.push(event);
    if (options.keep !== undefined && kept.length > options.keep) {
      kept.shift();
      first += 1;
    }
    for (const wake of waiting) wake();
  }

  function appended(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        waiting.delete(wake);
        signal?.removeEventListener("abort", wake);
        resolve();
      };
      waiting.add(wake);
      signal?.addEventListener("abort", wake);
    });
  }

  async function* read({ after, types, signal }: ReadOptions = {}): AsyncGenerator<Delivery> {
    let next = first;
    if (after !== undefined) {
      const position = /^[1-9]\d*$/.test(after) ? Number(after) : 0;
      if (position === 0 || position >= first + kept.length) {
        throw new UnknownCursorError(after);
      }
      next = position + 1;
    }
    while (!signal?.aborted) {
      next = Math.max(next, first);
      if (next >= first + kept.length) {
        await appended(signal);
        continue;
      }
      const event = kept[next - first];
      const cursor = String(next) as Cursor;
      next += 1;
      if (!types?.length || types.includes(event.type)) yield { event, cursor };
    }
  }

  for (const event of events) void append(event);
  const sequence = { read } satisfies EventSequence;
  return { sequence, append };
}
