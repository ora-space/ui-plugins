import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { FakeStorage, StorageFault } from "../storage.ts";

const text = (value: string) => new TextEncoder().encode(value);

Deno.test("list derives directories from file paths", () => {
  const storage = new FakeStorage();
  storage.put("downloads/a.zip", text("PK"));
  storage.put("downloads/nested/b.txt", text("b"));
  storage.put("index.json", text("{}"));
  assertEquals(storage.handle("ora/storage/list", { path: "" }), {
    entries: [
      { name: "downloads", kind: "directory", size_bytes: 0 },
      { name: "index.json", kind: "file", size_bytes: 2 },
    ],
  });
  assertEquals(storage.handle("ora/storage/list", { path: "downloads" }), {
    entries: [
      { name: "a.zip", kind: "file", size_bytes: 2 },
      { name: "nested", kind: "directory", size_bytes: 0 },
    ],
  });
});

Deno.test("read returns base64 and records the logical path", () => {
  const storage = new FakeStorage();
  storage.put("downloads/a.zip", new Uint8Array([1, 2, 3]));
  assertEquals(
    storage.handle("ora/storage/read", { path: "downloads/a.zip" }),
    { bytes_base64: "AQID" },
  );
  assertEquals(storage.reads, ["downloads/a.zip"]);
});

Deno.test("write then remove round-trips through the fake", () => {
  const storage = new FakeStorage();
  storage.handle("ora/storage/write", {
    path: "state/index.json",
    bytes_base64: "e30=",
  });
  assertEquals(storage.get("state/index.json"), text("{}"));
  storage.handle("ora/storage/remove", { path: "state" });
  assertEquals(storage.get("state/index.json"), undefined);
});

Deno.test("missing files and directories are not_found", () => {
  const storage = new FakeStorage();
  const read = assertThrows(
    () => storage.handle("ora/storage/read", { path: "downloads/x.zip" }),
    StorageFault,
  );
  const list = assertThrows(
    () => storage.handle("ora/storage/list", { path: "downloads" }),
    StorageFault,
  );
  assertEquals([read.kind, read.code, list.kind], [
    "not_found",
    -32004,
    "not_found",
  ]);
});

Deno.test("absolute, escaping, and host-owned paths are invalid_path", () => {
  const storage = new FakeStorage();
  for (const path of ["/etc/passwd", "../x", "a/../b", "web-profile/x"]) {
    const fault = assertThrows(
      () => storage.handle("ora/storage/read", { path }),
      StorageFault,
    );
    assertEquals([path, fault.kind], [path, "invalid_path"]);
  }
});

Deno.test("a missing path param is invalid_params", () => {
  const fault = assertThrows(
    () => new FakeStorage().handle("ora/storage/list", {}),
    StorageFault,
  );
  assertEquals([fault.kind, fault.code], ["invalid_params", -32602]);
});
