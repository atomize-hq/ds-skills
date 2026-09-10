import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
const [launcher, root] = process.argv.slice(2);
const child = spawn(
  process.execPath,
  [
    launcher,
    "figma",
    "serve",
    "--config",
    "config.json",
    "--artifact",
    "artifact.json",
    "--port",
    "0",
  ],
  {
    cwd: path.dirname(root),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  },
);
let out = "",
  err = "",
  ended = false;
child.stdout.on("data", (chunk) => {
  out += chunk;
});
child.stderr.on("data", (chunk) => {
  err += chunk;
});
child.on("exit", () => {
  ended = true;
});
try {
  let url;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !ended) {
    const match = err.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+[^\s]*/);
    if (match) {
      url = match[0];
      break;
    }
    await delay(25);
  }
  if (!url || ended)
    throw new Error(
      `Server did not stream readiness while alive: ${out}\n${err}`,
    );
  const expected = JSON.parse(
    fs.readFileSync(path.join(root, "artifact.json")),
  );
  const response = await fetch(url, {
    signal: globalThis.AbortSignal.timeout(5000),
  });
  const observed = await response.json();
  if (!response.ok || JSON.stringify(observed) !== JSON.stringify(expected))
    throw new Error(`Served artifact mismatch: ${url}`);
} finally {
  if (!ended) {
    const exit = once(child, "exit");
    if (process.platform === "win32") child.kill();
    else process.kill(-child.pid, "SIGTERM");
    await exit;
  }
}
