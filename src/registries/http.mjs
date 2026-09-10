import { registryError, registryUrl } from "./definition.mjs";
import { digest } from "../libraries/capture.mjs";
export const NETWORK_LIMIT = 16 * 1024 * 1024;
export function registryClient({
  fetchImpl = fetch,
  timeoutMs = 120000,
  requestMs = 20000,
} = {}) {
  const controller = new globalThis.AbortController(),
    signal = globalThis.AbortSignal.any([
      controller.signal,
      globalThis.AbortSignal.timeout(timeoutMs),
    ]);
  let total = 0;
  async function get(value) {
    const url = registryUrl(value);
    try {
      const response = await fetchImpl(url, {
        redirect: "error",
        credentials: "omit",
        headers: { Accept: "application/json, text/plain;q=0.9" },
        signal: globalThis.AbortSignal.any([
          signal,
          globalThis.AbortSignal.timeout(requestMs),
        ]),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw registryError(
          `Request returned HTTP ${response.status}; unavailable evidence is not removal`,
        );
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        total += chunk.length;
        if (size > 2 * 1024 * 1024 || total > NETWORK_LIMIT)
          throw registryError("Response or total download size exceeds limits");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      let content;
      try {
        content = new globalThis.TextDecoder("utf-8", { fatal: true }).decode(
          bytes,
        );
      } catch {
        throw registryError("Response is not valid UTF-8");
      }
      // Preserve raw UTF-8 byte identity, including a leading BOM if present.
      if (!Buffer.from(content).equals(bytes))
        throw registryError(
          "Response text cannot be represented without changing bytes",
        );
      return { url, sha256: digest(bytes), content };
    } catch (error) {
      if (error.code) throw error;
      throw registryError(
        "Request failed, redirected, or timed out; no removal inferred",
      );
    }
  }
  async function map(values, fn) {
    const out = new Array(values.length);
    let next = 0;
    const workers = Array.from(
      { length: Math.min(4, values.length) },
      async () => {
        while (next < values.length) {
          signal.throwIfAborted();
          const i = next++;
          out[i] = await fn(values[i]);
        }
      },
    );
    try {
      return await Promise.all(workers).then(() => out);
    } catch (error) {
      controller.abort();
      await Promise.allSettled(workers);
      if (error.code === "LIBRARY_EVIDENCE_INPUT") throw error;
      throw registryError("Acquisition failed or exceeded its deadline");
    }
  }
  return { get, map, close: () => controller.abort() };
}
