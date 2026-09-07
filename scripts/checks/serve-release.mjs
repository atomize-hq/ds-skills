#!/usr/bin/env node
/**
 * Serve a staged release directory over HTTP so the installers can be tested
 * the way they run: curl and Invoke-WebRequest against an origin, not file://.
 *
 *   node scripts/checks/serve-release.mjs <dir> <port-file> &
 *
 * The tests point DS_SKILLS_BASE_URL at this. That override is selection only —
 * the payload digests are baked into the bootstrap and enforced regardless — so
 * a mirror can serve different bytes but cannot install them. Which is exactly
 * the negative test this server exists to make possible.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] ?? ".");
const portFile = process.argv[3];

const server = http.createServer((request, response) => {
  const name = path.basename(new URL(request.url ?? "/", "http://x").pathname);
  const file = path.join(root, name);
  if (name === "" || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  // Written last, so a reader that sees the file knows the socket is listening.
  fs.writeFileSync(portFile, `${port}\n`);
});
