import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { SurfaceSessionRegistry } from "../session.ts";

const a = { surfaceId: "market", instanceId: 1, generation: 1 };
const b = { surfaceId: "market", instanceId: 2, generation: 1 };

/** A task that records when it ran and resolves when the test releases it. */
function gate(log: string[], label: string) {
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const task = async () => {
    log.push(`${label}:start`);
    await blocked;
    log.push(`${label}:end`);
  };
  return { task, release };
}

Deno.test("tasks on one session run in wire order", async () => {
  const registry = new SurfaceSessionRegistry();
  const log: string[] = [];
  const open = gate(log, "open");
  const opened = registry.opened(a, open.task);
  const ran = registry.run(a, () => {
    log.push("download");
  });
  const closed = registry.closed(a, () => {
    log.push("close");
  });
  await Promise.resolve();
  assertEquals(log, ["open:start"]);
  open.release();
  await Promise.all([opened, ran, closed]);
  assertEquals(log, ["open:start", "open:end", "download", "close"]);
});

Deno.test("different sessions run concurrently", async () => {
  const registry = new SurfaceSessionRegistry();
  const log: string[] = [];
  const openA = gate(log, "a");
  const opened = registry.opened(a, openA.task);
  await registry.opened(b, () => {
    log.push("b");
  });
  assertEquals(log, ["a:start", "b"]);
  openA.release();
  await opened;
});

Deno.test("unknown sessions run immediately without a record", async () => {
  const registry = new SurfaceSessionRegistry();
  const log: string[] = [];
  await registry.run(a, () => {
    log.push("orphan-download");
  });
  // A later open must not be queued behind anything the orphan created.
  const open = gate(log, "open");
  const opened = registry.opened(a, open.task);
  await Promise.resolve();
  assertEquals(log, ["orphan-download", "open:start"]);
  open.release();
  await opened;
});

Deno.test("a failing handler does not poison the chain", async () => {
  const registry = new SurfaceSessionRegistry();
  const log: string[] = [];
  const opened = registry.opened(a, () => {
    throw new Error("boom");
  });
  await assertRejects(() => opened, Error, "boom");
  await registry.run(a, () => {
    log.push("after-failure");
  });
  assertEquals(log, ["after-failure"]);
});

Deno.test("closed sessions are forgotten and late work runs directly", async () => {
  const registry = new SurfaceSessionRegistry();
  const log: string[] = [];
  const close = gate(log, "close");
  await registry.opened(a, () => {});
  const closed = registry.closed(a, close.task);
  await registry.run(a, () => {
    log.push("late-download");
  });
  assertEquals(log, ["close:start", "late-download"]);
  close.release();
  await closed;
});

Deno.test("drain waits for every queued task", async () => {
  const registry = new SurfaceSessionRegistry();
  const log: string[] = [];
  const open = gate(log, "open");
  const opened = registry.opened(a, open.task);
  void registry.run(a, () => {
    log.push("download");
  });
  const drained = registry.drain();
  open.release();
  await drained;
  await opened;
  assertEquals(log, ["open:start", "open:end", "download"]);
});
