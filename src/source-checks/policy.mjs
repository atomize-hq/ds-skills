import path from "node:path";
import { Worker } from "node:worker_threads";
import { resolveProjectPath, loadProject } from "../project/config.mjs";
import { sourceReader, sourceError } from "./inputs.mjs";
import { ruleSections, validateSourcePolicy } from "./policy-shape.mjs";
export function capturePolicy(project) {
  const config = project.sourceChecks?.policy;
  if (!config) throw sourceError("Source policy checking is not configured");
  const reader = sourceReader(project.rootDir);
  reader.read(project.configPath);
  let policy;
  try {
    policy = JSON.parse(reader.read(config.file));
  } catch (error) {
    if (error.code) throw error;
    return { errors: ["[UPSTREAM_POLICY_INVALID] Invalid JSON"], reader };
  }
  const errors = validateSourcePolicy(policy);
  if (errors.length) return { errors, reader };
  const tasks = [];
  for (const section of ruleSections)
    for (const rule of policy[section]) {
      const file = resolveProjectPath(
        project.rootDir,
        rule[section === "invariants" ? "directory" : "file"],
        "policy scope",
      );
      const files =
        section === "invariants"
          ? reader.list(file, config.extensions, config.recursive)
          : [file];
      tasks.push({
        rule,
        code: {
          invariants: "INVARIANT_VIOLATED",
          deviations: "DEVIATION_LOST",
          contracts: "CONTRACT_LOST",
        }[section],
        files: files.map((f) => [
          path.relative(project.rootDir, f).split(path.sep).join("/"),
          reader.read(f, true),
        ]),
      });
    }
  return {
    errors: [],
    reader,
    tasks,
    counts: Object.fromEntries(ruleSections.map((k) => [k, policy[k].length])),
  };
}
async function runPatterns(tasks, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./policy-worker.mjs", import.meta.url), {
      workerData: tasks,
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    let result, problem;
    const timer = globalThis.setTimeout(() => {
      problem = "Source policy regular-expression evaluation timed out";
      void worker.terminate();
    }, timeoutMs);
    worker.on("message", (r) => {
      if (r?.overflow) problem = "Source policy diagnostics exceed limit";
      else result = r;
    });
    worker.on("error", () => {
      problem = "Source policy worker failed";
    });
    worker.on("exit", (code) => {
      globalThis.clearTimeout(timer);
      if (problem || code !== 0 || !Array.isArray(result?.errors))
        reject(
          sourceError(problem ?? "Source policy worker returned no result"),
        );
      else resolve(result.errors);
    });
  });
}
export async function checkSourcePolicy(project) {
  const current = loadProject(project.configPath, { rootDir: project.rootDir });
  if (JSON.stringify(current) !== JSON.stringify(project))
    throw sourceError("Project configuration changed");
  const captured = capturePolicy(project);
  const errors = captured.errors.length
    ? captured.errors
    : await runPatterns(captured.tasks, project.sourceChecks.policy.timeoutMs);
  if (capturePolicy(project).reader.identity() !== captured.reader.identity())
    throw sourceError("Source policy inputs changed during evaluation");
  return {
    ok: errors.length === 0,
    errors,
    inputDigest: captured.reader.identity(),
    counts: captured.counts ?? null,
  };
}
