import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateReleaseRecord, platformKey, releaseError } from "./record.mjs";

export function releaseBaseUrl(record) {
  return `https://github.com/${record.repository}/releases/download/${record.release}`;
}
/** Verified bootstrap bytes are written/executed only after matching the reviewed pin. */
export async function acquireRelease({
  record,
  prefix,
  platform = process.platform,
  arch = process.arch,
  baseUrl,
  fetchBytes = downloadBytes,
  run = executeBootstrap,
}) {
  validateReleaseRecord(record);
  platformKey(platform, arch);
  if (typeof prefix !== "string" || !prefix.length)
    throw releaseError("RELEASE_PREFIX", "An installation prefix is required");
  const bootstrap =
    platform === "win32" ? record.bootstrapPowershell : record.bootstrap;
  const base = baseUrl ?? releaseBaseUrl(record);
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    throw releaseError("RELEASE_MIRROR", "Invalid release mirror URL");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw releaseError(
      "RELEASE_MIRROR",
      "Release mirror must be an unauthenticated HTTP(S) base URL without query or fragment",
    );
  const url = `${base.replace(/\/$/, "")}/${bootstrap.asset}`;
  const bytes = await fetchBytes(url);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== bootstrap.sha256)
    throw releaseError(
      "RELEASE_BOOTSTRAP_DIGEST",
      `Bootstrap differs from the reviewed digest. Expected ${bootstrap.sha256}; received ${digest}. Nothing was executed or installed.`,
    );
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-acquire-"));
  const file = path.join(work, bootstrap.asset);
  try {
    fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o700 });
    await run({ file, prefix: path.resolve(prefix), platform, baseUrl: base });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return { asset: bootstrap.asset, url, digest };
}
async function downloadBytes(url) {
  let response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: globalThis.AbortSignal.timeout(60000),
    });
  } catch (error) {
    throw releaseError(
      "RELEASE_DOWNLOAD",
      `Cannot download bootstrap: ${error.message}`,
    );
  }
  if (!response.ok)
    throw releaseError(
      "RELEASE_DOWNLOAD",
      `Cannot download ${url}: HTTP ${response.status}`,
    );
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw releaseError(
      "RELEASE_DOWNLOAD",
      `Cannot read bootstrap response: ${error.message}`,
    );
  }
}
function executeBootstrap({ file, prefix, platform, baseUrl }) {
  const command = platform === "win32" ? "powershell" : "bash";
  const args =
    platform === "win32"
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file]
      : [file];
  // The selected mirror must also reach the verified bootstrap. It still enforces
  // its baked archive digests; this option changes transport, never authority.
  try {
    execFileSync(command, args, {
      env: {
        ...process.env,
        DS_SKILLS_PREFIX: prefix,
        DS_SKILLS_BASE_URL: baseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw releaseError(
      "RELEASE_INSTALL_FAILED",
      `Verified bootstrap failed: ${error.stderr?.toString().trim() || error.message}`,
    );
  }
}
