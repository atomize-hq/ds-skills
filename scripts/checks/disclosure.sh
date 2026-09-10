#!/usr/bin/env bash
# Release-owner checks: private identifiers remain in an external local list.
# Node reads physical inputs directly so traversal/read errors cannot pass as
# grep/find no-match results. No test file or binary content is exempted.
set -euo pipefail
exec node --input-type=module - "$@" <<'JS'
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let identifiersFile;
if (args[0] === "--identifiers-file") {
  args.shift();
  identifiersFile = args.shift();
  if (!identifiersFile) invalid("--identifiers-file requires a local file");
}
if (args.length !== 2) invalid("usage: disclosure.sh [--identifiers-file <local-file>] <staged-tree> <label>");
const [tree, label] = args;
const fail = (message) => { console.error(`${label}: ${message}`); process.exit(1); };
function invalid(message) { console.error(`disclosure: ${message}`); process.exit(2); }

try {
  const rootStat = fs.lstatSync(tree);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) invalid("staged tree must be a physical directory");
  let identifiers = [];
  if (identifiersFile !== undefined) {
    const stat = fs.lstatSync(identifiersFile);
    if (!stat.isFile() || stat.isSymbolicLink()) invalid("identifier list must be a physical regular file");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(identifiersFile));
    if (!text.endsWith("\n") || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) invalid("identifier list must contain LF-terminated UTF-8 literals without control characters");
    identifiers = text.slice(0, -1).split("\n");
    if (identifiers.some((value) => !value || value.trim() !== value)) invalid("identifier list contains empty or padded literals");
    identifiers = identifiers.map((value) => value.toLowerCase());
  }
  const files = [];
  const walk = (directory) => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) invalid("staged symlinks are not supported");
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files.push({
        relative: path.relative(tree, file).split(path.sep).join("/"),
        text: fs.readFileSync(file).toString("utf8"),
      });
      else invalid("staged entry is not a regular file or directory");
    }
  };
  // Read every entry before evaluating content, so unreadable input cannot
  // produce a claim about a partially inspected tree.
  walk(tree);
  const retired = /code[ _-]?connect|pilot|CT-11B|figma:connect:/i;
  for (const { relative, text } of files) {
    if (/figma:\/\/file\/[A-Za-z0-9]{18,}/.test(text)) fail("embeds a real Figma file key");
    const instruction = /^(skills|templates|schemas)\//.test(relative);
    const fixture = /(?:^|\/)(?:__fixtures__|fixtures)\/.*\.json$/.test(relative);
    // Validator expressions and their narrow negative source tests explain
    // retired terms; reusable guidance and JSON fixture data must not retain them.
    if ((instruction || fixture) && retired.test(text)) fail(`retired-system guidance in ${relative}`);
    if (relative.startsWith("skills/")) {
      if (/\/Users\/|\/home\/|src\/components\/|src-tauri\/|design-tokens\/src\/|pnpm validate:|just check/.test(text)) fail("reusable skills embed consumer path/command assumptions");
      if (/\]\(\.\.\/(schemas|templates)\/|`\.\.\/(schemas|templates)/.test(text)) fail("installed skills use consumer-relative asset paths");
    }
    const content = `${relative}\n${text}`.toLowerCase();
    if (identifiers.some((identifier) => content.includes(identifier))) fail(`staged tree contains a configured private identifier: ${relative}`);
  }
  console.log(`  ${label}: structural disclosure checks passed; ${identifiersFile === undefined ? "no private identifier list configured" : "configured private identifiers absent"}`);
} catch {
  invalid("unable to read physical staged inputs or UTF-8 identifier list");
}
JS
