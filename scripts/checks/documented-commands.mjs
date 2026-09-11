#!/usr/bin/env node
/**
 * Exercise the commands printed in shipped templates against an installed,
 * generated launcher. This runs in the existing alpha/beta data-only consumer
 * fixture: source-tree paths and an ambient ds-skills executable cannot satisfy
 * it. It is intentionally a documentation/package contract, not a new runtime
 * harness.
 *
 *   node documented-commands.mjs <consumer-root> <installed-lib-root> <source-root>
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

const [consumer, installed, source] = process.argv
  .slice(2)
  .map((value) => value && path.resolve(value));
if (!consumer || !installed || !source) {
  throw new Error(
    "usage: documented-commands.mjs <consumer-root> <installed-lib-root> <source-root>",
  );
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const run = (args, description, cwd = consumer, env = process.env) => {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${description} failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
};
const launcher = path.join(".ds-skills", "project.mjs");
if (!fs.existsSync(path.join(consumer, launcher))) {
  throw new Error(`consumer has no generated launcher at ${launcher}`);
}

const shell = (script, cwd, env) =>
  spawnSync("bash", ["-c", `set -euo pipefail\n${script}`], {
    cwd,
    env,
    encoding: "utf8",
  });
const readUnixBootstrap = (markdown) => {
  const section = markdown.slice(
    markdown.indexOf("### First-time bootstrap (Unix)"),
  );
  const block = section.match(/```sh\n([\s\S]*?)\n```/);
  if (!block) throw new Error("README has no Unix bootstrap command block");
  return block[1];
};
const waitForPort = (file) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").trim()) {
      return fs.readFileSync(file, "utf8").trim();
    }
    spawnSync("sleep", ["0.05"]);
  }
  throw new Error(`mirror did not write ${file}`);
};
const startMirror = (directory, name) => {
  const portFile = path.join(consumer, `documented-${name}.port`);
  const child = spawn(
    process.execPath,
    [
      path.join(source, "scripts/checks/serve-release.mjs"),
      directory,
      portFile,
    ],
    { stdio: "ignore" },
  );
  return { child, base: `http://127.0.0.1:${waitForPort(portFile)}` };
};

// The v3 starter must be usable unchanged for shape validation. It truthfully
// says materialization has not run, so it deliberately carries no publication.
const ledgerStarter = path.join(
  installed,
  "templates",
  "sync-ledger.template.json",
);
const ledgerTarget = path.join(consumer, "documented", "sync-ledger.json");
fs.mkdirSync(path.dirname(ledgerTarget), { recursive: true });
fs.copyFileSync(ledgerStarter, ledgerTarget);
run(
  [launcher, "validate", "sync-ledger", "documented/sync-ledger.json"],
  "v3 ledger starter shape validation",
);
// The fixture has its consumer profile and exact publication proof, so this is
// deliberately a separate semantic/publish-contract proof, not a claim that
// the generic not-run starter could earn the same result.
run(
  [
    launcher,
    "ledger",
    "validate",
    "--ledger",
    "sync-ledger.json",
    "--profile",
    "profile.json",
  ],
  "installed semantic ledger validation",
);

// Materialize the three shape-only examples named by the shipped Storybook
// policy. The policy command strings use only the generated launcher and a
// shipped schema name, never an .agents path or package-internal script.
const policy = readJson(
  path.join(installed, "templates", "storybook-version-policy.template.json"),
);
const storybook = path.join(consumer, ".storybook");
const storybookData = path.join(consumer, "storybook");
fs.mkdirSync(storybook, { recursive: true });
fs.mkdirSync(storybookData, { recursive: true });
writeJson(path.join(storybook, "storybook-version-policy.json"), policy);
writeJson(path.join(storybookData, "component-tier-policy.json"), {
  policyVersion: "2",
  tierOrder: ["basic"],
  consumerIds: ["fixture"],
  tiers: {
    basic: {
      minimumRequiredKinds: [{ kind: "default", purpose: "baseline" }],
      defaultOptionalKinds: [],
      consumerScope: ["fixture"],
    },
  },
});
writeJson(path.join(storybookData, "story-inventory.json"), {
  inventoryVersion: "1",
  components: [
    {
      componentId: "fixture",
      validatorKinds: ["default"],
      implementedStoryRefs: [{ kind: "default", storyId: "fixture--default" }],
    },
  ],
});
for (const command of policy.validationCommands) {
  if (
    command.includes(".agents/") ||
    command.includes("validate-artifact.mjs")
  ) {
    throw new Error(
      `shipped template retained an internal layout command: ${command}`,
    );
  }
  const args = command.split(" ").slice(1);
  run(args, `documented template command: ${command}`);
}

// Generated help must retain its portable recording setup and before-sync
// safety warning after the installed release substitutes consumer config.
const pluginOut = path.join(consumer, "documented", "plugin");
run(
  [
    launcher,
    "figma",
    "plugin",
    "build",
    "--config",
    "config.json",
    "--out",
    pluginOut,
  ],
  "installed plugin build for generated help",
);
const ui = fs.readFileSync(path.join(pluginOut, "ui.html"), "utf8");
for (const required of [
  /first matching\s+collection name/,
  /type\s+changes/,
  /transaction-wide\s+rollback/,
  /node \.ds-skills\/project\.mjs figma serve --config <config> --artifact <artifact> --drift-out <report>/,
  /panel result is unchanged/,
]) {
  if (!required.test(ui)) {
    throw new Error(
      `generated plugin help omitted required guidance: ${required}`,
    );
  }
}

// The staged archive intentionally omits .github. A release reader must see an
// immutable public link rather than a source-only relative action guide.
const rootReadme = fs.readFileSync(path.join(installed, "README.md"), "utf8");

// Extract and execute the shipped Unix first-trust journey against the same
// local release-mirror mechanism that pack-check uses. The environment swaps
// transport only; the README sequence still acquires the pin, derives release
// from it, checks the bootstrap before execution, exports the prefix, installs,
// and verifies the exact executable.
const release = readJson(path.join(installed, "release.json")).release;
const work = path.dirname(consumer);
const honestMirror = `http://127.0.0.1:${fs.readFileSync(path.join(work, "port"), "utf8").trim()}`;
const bootstrapDir = path.join(consumer, "documented-bootstrap");
fs.mkdirSync(bootstrapDir, { recursive: true });
const bootstrapEnv = {
  ...process.env,
  DS_SKILLS_REVIEWED_RELEASE: release,
  DS_SKILLS_RELEASE_BASE_URL: honestMirror,
};
const bootstrap = shell(
  readUnixBootstrap(rootReadme),
  bootstrapDir,
  bootstrapEnv,
);
if (bootstrap.status !== 0) {
  throw new Error(`documented Unix bootstrap failed: ${bootstrap.stderr}`);
}
const prefix = path.join(bootstrapDir, ".tools", "ds-skills", release);
if (!fs.existsSync(path.join(prefix, "bin", "ds-skills"))) {
  throw new Error(
    "documented Unix bootstrap did not install its exact executable",
  );
}

// The same extracted commands must refuse a pin whose bootstrap digest differs,
// before the bootstrap can run. Use a copied staged mirror so the shared honest
// release and later consumer checks remain untouched.
const mismatchMirror = path.join(consumer, "documented-mismatch-mirror");
fs.cpSync(path.join(work, "release"), mismatchMirror, { recursive: true });
const mismatchRecord = path.join(mismatchMirror, "ds-skills.release.json");
const mismatchPin = readJson(mismatchRecord);
mismatchPin.bootstrap.sha256 = "0".repeat(64);
fs.writeFileSync(mismatchRecord, `${JSON.stringify(mismatchPin, null, 2)}\n`);
const mismatch = startMirror(mismatchMirror, "mismatch");
try {
  const mismatchDir = path.join(consumer, "documented-bootstrap-mismatch");
  fs.mkdirSync(mismatchDir, { recursive: true });
  const result = shell(readUnixBootstrap(rootReadme), mismatchDir, {
    ...bootstrapEnv,
    DS_SKILLS_RELEASE_BASE_URL: mismatch.base,
  });
  if (
    result.status === 0 ||
    !result.stderr.includes("bootstrap digest mismatch")
  ) {
    throw new Error(
      `documented first-trust mismatch was not refused: ${result.stderr}`,
    );
  }
  if (fs.existsSync(path.join(mismatchDir, ".tools"))) {
    throw new Error("mismatched bootstrap reached installation output");
  }
} finally {
  mismatch.child.kill();
}
if (rootReadme.includes("](.github/actions/setup-ds-skills/README.md)")) {
  throw new Error(
    "packaged README still links to omitted .github action documentation",
  );
}
if (!rootReadme.includes("github.com/atomize-hq/ds-skills/blob/")) {
  throw new Error("packaged README has no immutable public setup-action link");
}
const projectGuide = fs.readFileSync(
  path.join(installed, "src", "project-host", "README.md"),
  "utf8",
);
if (
  projectGuide.includes("](../../.github/actions/setup-ds-skills/README.md)")
) {
  throw new Error(
    "packaged project guide still links to omitted .github action documentation",
  );
}
if (!projectGuide.includes("github.com/atomize-hq/ds-skills/blob/")) {
  throw new Error(
    "packaged project guide has no immutable public setup-action link",
  );
}

process.stdout.write(
  `documented bootstrap (pin acquisition, exported prefix, exact executable, mismatch refusal) and installed commands ok: ${consumer}\n`,
);
