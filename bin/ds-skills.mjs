#!/usr/bin/env node
// The executable resolves its own package.json rather than searching upward
// from the working directory: `--help` and `--version` have to work outside any
// consumer repository, and the install prefix is the only reliable anchor.
import { readFileSync } from "node:fs";
import process from "node:process";

import { runCli } from "../dist/cli/run.js";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

process.exit(
  runCli({ argv: process.argv.slice(2), version: manifest.version }),
);
