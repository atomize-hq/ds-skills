export const ruleSections = ["invariants", "deviations", "contracts"];
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) =>
  typeof v === "string" && v.trim().length > 0 && v.trim() === v;
export function validateSourcePolicy(data) {
  const errors = [],
    bad = (m) => errors.push(`[UPSTREAM_POLICY_INVALID] ${m}`);
  if (!object(data)) return ["[UPSTREAM_POLICY_INVALID] Expected an object"];
  if (data.policyVersion !== "1") bad('policyVersion must be "1"');
  for (const k of Object.keys(data))
    if (!["policyVersion", "upstream", ...ruleSections].includes(k))
      bad(`Unknown policy field: ${k}`);
  if (
    data.upstream !== undefined &&
    (!object(data.upstream) ||
      Object.values(data.upstream).some((v) => !text(v)))
  )
    bad("upstream must be a string-valued provenance map");
  const ids = new Set();
  let count = 0;
  for (const section of ruleSections) {
    if (!Array.isArray(data[section])) {
      bad(`${section} must be an array`);
      continue;
    }
    for (const rule of data[section]) {
      if (++count > 500) {
        bad("Too many policy rules");
        return errors;
      }
      if (!object(rule)) {
        bad("Rule must be an object");
        continue;
      }
      const scope = section === "invariants" ? "directory" : "file";
      for (const k of Object.keys(rule))
        if (
          !["id", scope, "reason", "instead", "require", "forbid"].includes(k)
        )
          bad(`Unknown rule field: ${k}`);
      if (!text(rule.id) || ids.has(rule.id))
        bad("Rule IDs must be unique nonempty strings");
      ids.add(rule.id);
      for (const k of [scope, "reason"])
        if (!text(rule[k])) bad(`Rule ${rule.id} needs ${k}`);
      if (rule.instead !== undefined && !text(rule.instead))
        bad("instead must be nonempty text");
      const require = rule.require ?? [],
        forbid = rule.forbid ?? [];
      if (!Array.isArray(require) || !Array.isArray(forbid)) {
        bad("require/forbid must be arrays");
        continue;
      }
      if (
        require.length + forbid.length === 0 ||
        require.length + forbid.length > 100
      )
        bad("Rules need 1 to 100 patterns");
      if (section === "contracts" && forbid.length)
        bad("Contracts may only require");
      for (const pattern of [...require, ...forbid]) {
        if (
          typeof pattern !== "string" ||
          !pattern.length ||
          pattern.length > 4096
        ) {
          bad("Patterns must be nonempty strings up to 4096 characters");
          continue;
        }
        try {
          new RegExp(pattern);
        } catch {
          bad(`Invalid regular expression in ${rule.id}`);
        }
      }
    }
  }
  return errors;
}
