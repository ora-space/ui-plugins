/**
 * Host-side codec for Ora's binary JSON-RPC frame envelope.
 *
 * This is a standalone reimplementation, not an import from the plugin SDK:
 * the test driver plays the host's side of the protocol, and the host does not
 * depend on the SDK it is exercising. Layout: 4-byte big-endian length, one
 * type byte (0x01 = JSON-RPC), then UTF-8 JSON.
 */

/** Wire-level JSON, mirroring the SDK type without importing it. */
export type FrameJson =
  | null
  | boolean
  | number
  | string
  | FrameJson[]
  | { [key: string]: FrameJson };

const JSON_RPC_FRAME_TYPE = 0x01;
const MAX_FRAME_LENGTH = 16 * 1024 * 1024;

/** Encodes one JSON value into a frame the plugin SDK will accept. */
export function encodeFrame(message: FrameJson): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(message));
  const length = payload.byteLength + 1;
  if (length > MAX_FRAME_LENGTH) {
    throw new Error(`Plugin frame exceeds ${MAX_FRAME_LENGTH} bytes`);
  }

  const frame = new Uint8Array(length + 4);
  new DataView(frame.buffer).setUint32(0, length, false);
  frame[4] = JSON_RPC_FRAME_TYPE;
  frame.set(payload, 5);
  return frame;
}

/** Decodes arbitrarily fragmented bytes into complete JSON-RPC messages. */
export async function* decodeFrames(
  readable: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  let buffer = new Uint8Array();
  for await (const chunk of readable) {
    const combined = new Uint8Array(buffer.byteLength + chunk.byteLength);
    combined.set(buffer);
    combined.set(chunk, buffer.byteLength);
    buffer = combined;

    while (buffer.byteLength >= 4) {
      const length = new DataView(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength,
      ).getUint32(0, false);
      if (length < 1 || length > MAX_FRAME_LENGTH) {
        throw new Error(`Invalid plugin frame length ${length}`);
      }
      if (buffer.byteLength < length + 4) {
        break;
      }
      if (buffer[4] !== JSON_RPC_FRAME_TYPE) {
        throw new Error(`Unsupported plugin frame type ${buffer[4]}`);
      }

      const payload = buffer.slice(5, length + 4);
      buffer = buffer.slice(length + 4);
      yield JSON.parse(new TextDecoder().decode(payload));
    }
  }

  if (buffer.byteLength !== 0) {
    throw new Error("Plugin protocol stream ended inside a frame");
  }
}
