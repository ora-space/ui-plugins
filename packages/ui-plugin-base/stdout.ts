/**
 * Sends every console method to stderr before any plugin code can run.
 *
 * The SDK does the same when `run()` starts, but activation happens before
 * that, and stdout is the binary protocol channel: a single `console.log` in
 * `onActivate` would be read by the host as a corrupt frame and take the whole
 * plugin down.
 */
export function protectProtocolStdout(): void {
  const encoder = new TextEncoder();
  const write = (level: string, values: unknown[]) => {
    const rendered = values
      .map((value) => (typeof value === "string" ? value : Deno.inspect(value)))
      .join(" ");
    Deno.stderr.writeSync(encoder.encode(`[plugin:${level}] ${rendered}\n`));
  };
  console.debug = (...values: unknown[]) => write("debug", values);
  console.info = (...values: unknown[]) => write("info", values);
  console.log = (...values: unknown[]) => write("log", values);
  console.warn = (...values: unknown[]) => write("warn", values);
  console.error = (...values: unknown[]) => write("error", values);
}
