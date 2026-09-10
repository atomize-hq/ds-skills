import { statusError } from "./status.mjs";
export function githubClient(config, env = process.env) {
  const apiHeaders = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = env[config.tokenEnv];
  if (token) apiHeaders.Authorization = `Bearer ${token}`;
  async function fetchBounded(url, headers, limit, redirect = "error") {
    try {
      const response = await fetch(url, {
        headers,
        redirect,
        signal: globalThis.AbortSignal.timeout(30000),
      });
      if (response.status === 302 && redirect === "manual") {
        await response.body?.cancel();
        return { location: response.headers.get("location") };
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw statusError(`GitHub request returned HTTP ${response.status}`);
      }
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > limit)
          throw statusError("GitHub response exceeds its size limit");
        chunks.push(chunk);
      }
      return { bytes: Buffer.concat(chunks) };
    } catch (error) {
      if (error.code === "CHROMATIC_INPUT") throw error;
      throw statusError("GitHub request failed or timed out");
    }
  }
  return {
    async json(endpoint) {
      const { bytes } = await fetchBounded(
        `${config.apiBase}${endpoint}`,
        apiHeaders,
        4 * 1024 * 1024,
      );
      try {
        return JSON.parse(bytes.toString("utf8"));
      } catch {
        throw statusError("GitHub returned invalid JSON");
      }
    },
    async archive(artifactId) {
      const endpoint = `${config.apiBase}/repos/${config.repository}/actions/artifacts/${artifactId}/zip`;
      const first = await fetchBounded(
        endpoint,
        apiHeaders,
        10 * 1024 * 1024,
        "manual",
      );
      if (first.bytes) return first.bytes;
      let destination;
      try {
        destination = new URL(first.location);
      } catch {
        throw statusError("GitHub artifact redirect is invalid");
      }
      const base = new URL(config.apiBase);
      const local =
        base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) &&
        destination.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname);
      if (
        (destination.protocol !== "https:" && !local) ||
        destination.username ||
        destination.password
      )
        throw statusError("GitHub artifact redirect is unsafe");
      // Never forward API credentials to the signed object-storage URL, even on the same origin.
      return (await fetchBounded(destination.href, {}, 10 * 1024 * 1024)).bytes;
    },
  };
}
