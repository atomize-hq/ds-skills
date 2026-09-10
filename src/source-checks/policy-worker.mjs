import { parentPort, workerData } from "node:worker_threads";
const errors = [];
for (const { rule, files, code } of workerData) {
  if (!files.length)
    errors.push(`[UPSTREAM_SCOPE_EMPTY] ${rule.id}: no matching source files`);
  for (const [file, source] of files) {
    if (source === null) {
      errors.push(`[UPSTREAM_SCOPE_EMPTY] ${rule.id}: missing ${file}`);
      continue;
    }
    for (const pattern of rule.require ?? [])
      if (!new RegExp(pattern).test(source))
        errors.push(
          `[UPSTREAM_${code}] ${file}: ${rule.id} requires ${pattern}. ${rule.reason}${rule.instead ? ` Use instead: ${rule.instead}` : ""}`,
        );
    for (const pattern of rule.forbid ?? [])
      if (new RegExp(pattern).test(source))
        errors.push(
          `[UPSTREAM_${code}] ${file}: ${rule.id} forbids ${pattern}. ${rule.reason}${rule.instead ? ` Use instead: ${rule.instead}` : ""}`,
        );
    if (errors.length > 1000) {
      parentPort.postMessage({ overflow: true });
      process.exit(0);
    }
  }
}
parentPort.postMessage({ errors });
