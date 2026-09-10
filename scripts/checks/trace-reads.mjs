#!/usr/bin/env node
/**
 * Prove the installed CLI reaches into nothing it does not own.
 *
 *   trace-reads.mjs <cli> <consumer-dir> <install-prefix>
 *
 * "It worked" is not evidence for this: a stray absolute path into the
 * development checkout resolves fine on the machine that has one, and the
 * failure only appears on a machine that does not. So the CLI is run with the
 * filesystem reads instrumented, and every file it opens is checked against the
 * two directories it is allowed to touch.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const [cli, consumer, prefix] = process.argv.slice(2);
const trace = path.join(consumer, ".reads");
fs.rmSync(trace, { force: true });

const hook = path.join(consumer, "trace-hook.mjs");
fs.writeFileSync(
  hook,
  `import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const log = ${JSON.stringify(trace)};
for (const name of ["readFileSync", "existsSync", "createReadStream"]) {
  const original = fs[name];
  fs[name] = (target, ...rest) => {
    const filename = target instanceof URL ? fileURLToPath(target) : target;
    if (typeof filename === "string") fs.appendFileSync(log, path.resolve(filename) + "\\n");
    return original(target, ...rest);
  };
}
`,
);

execFileSync(
  cli,
  [
    "ledger",
    "validate",
    "--ledger",
    "sync-ledger.json",
    "--profile",
    "profile.json",
  ],
  {
    cwd: consumer,
    stdio: "ignore",
    env: { ...process.env, NODE_OPTIONS: `--import ${JSON.stringify(hook)}` },
  },
);

const recipeInput = JSON.parse(
  fs.readFileSync(path.join(consumer, "recipe-test-input.json"), "utf8"),
);
execFileSync(
  cli,
  [
    "recipes",
    "validate",
    "--recipes",
    recipeInput.recipes,
    "--tokens",
    "artifact.json",
  ],
  {
    cwd: consumer,
    stdio: "ignore",
    env: { ...process.env, NODE_OPTIONS: `--import ${JSON.stringify(hook)}` },
  },
);

execFileSync(cli, ["tokens", "validate", "--config", "project.json"], {
  cwd: consumer,
  stdio: "ignore",
  env: { ...process.env, NODE_OPTIONS: `--import ${JSON.stringify(hook)}` },
});

execFileSync(
  cli,
  ["tokens", "artifacts", "check", "--config", "project.json"],
  {
    cwd: consumer,
    stdio: "ignore",
    env: { ...process.env, NODE_OPTIONS: `--import ${JSON.stringify(hook)}` },
  },
);

execFileSync(cli, ["tokens", "build", "--config", "project.json"], {
  cwd: consumer,
  stdio: "ignore",
  env: { ...process.env, NODE_OPTIONS: `--import ${JSON.stringify(hook)}` },
});

execFileSync(cli, ["tokens", "runtime", "check", "--config", "project.json"], {
  cwd: consumer,
  stdio: "ignore",
  env: { ...process.env, NODE_OPTIONS: `--import ${JSON.stringify(hook)}` },
});
execFileSync(cli, ["tokens", "guard", "--config", "project.json"], {
  cwd: consumer,
  stdio: "ignore",
  env: { ...process.env, NODE_OPTIONS: `--import ${JSON.stringify(hook)}` },
});

execFileSync(cli, ["tokens", "govern", "--config", "project.json"], {
  cwd: consumer,
  stdio: "ignore",
  env: { ...process.env, NODE_OPTIONS: `--import ${JSON.stringify(hook)}` },
});

// realpath both sides: on macOS a temp dir is /var/... to the caller and
// /private/var/... to the process, and a prefix comparison between the two
// forms reports every legitimate read as a stray.
const real = (target) => {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
};
const allowed = [real(prefix), real(consumer)];
const strays = [
  ...new Set(
    fs
      .readFileSync(trace, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("/"))
      .map((line) => real(path.resolve(consumer, line)))
      .filter(
        (file) => !allowed.some((dir) => file.startsWith(`${dir}${path.sep}`)),
      )
      // Node's own runtime and the OS are not the package reaching anywhere.
      .filter(
        (file) => !/^\/(usr|opt|System|Library|proc|etc|dev)\//.test(file),
      )
      .filter((file) => !file.startsWith(path.dirname(process.execPath))),
  ),
];

if (strays.length > 0) {
  process.stderr.write(
    `the installed CLI read ${strays.length} path(s) outside its install and the consumer:\n` +
      `${strays
        .slice(0, 10)
        .map((f) => `  ${f}\n`)
        .join("")}`,
  );
  process.exit(1);
}
process.stdout.write(
  `  reads confined to the install prefix and the consumer's own data\n`,
);
