import { assertEquals } from "jsr:@std/assert@1";
import { decodeFrames, encodeFrame, type FrameJson } from "../frames.ts";

Deno.test("frames survive arbitrary fragmentation", async () => {
  const messages: FrameJson[] = [
    { jsonrpc: "2.0", method: "ora/register", params: { methods: [] } },
    { jsonrpc: "2.0", id: 1, result: { payload: { count: 1 } } },
  ];
  const encoded = messages.map(encodeFrame);
  const total = encoded.reduce((sum, frame) => sum + frame.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const frame of encoded) {
    bytes.set(frame, offset);
    offset += frame.byteLength;
  }
  // Split in the middle of the first length prefix and of the second payload.
  const chunks = [
    bytes.slice(0, 2),
    bytes.slice(2, total - 7),
    bytes.slice(total - 7),
  ];
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const decoded = [];
  for await (const message of decodeFrames(readable)) decoded.push(message);
  assertEquals(decoded, messages);
});
