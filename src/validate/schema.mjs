/**
 * The JSON Schema subset this package implements, split out of artifact.mjs
 * when the package adopted the 300-code-line guard. The seam is real: above it
 * is a CLI, below it is a schema walker, and the walker is the part that must
 * REFUSE a keyword it does not implement rather than ignore it.
 */

/** Thrown for anything the validator cannot even attempt. */
export class ValidateUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidateUsageError";
  }
}

/** The walker's only exit: it never writes and never calls process.exit. */
export function fail(message) {
  throw new ValidateUsageError(message);
}

export const SUPPORTED = new Set([
  "type",
  "enum",
  "const",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minLength",
  "minItems",
  "minProperties",
  "uniqueItems",
  "pattern",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "$ref",
]);

export function validate(value, schema, ctx) {
  if (schema === true) return [];
  if (schema === false) return [`${label(ctx.path)} is not allowed here`];

  const node = resolve(schema, ctx);
  const unsupported = Object.keys(node).filter(
    (key) =>
      !SUPPORTED.has(key) &&
      !key.startsWith("$") &&
      !key.startsWith("x-") &&
      key !== "title" &&
      key !== "description",
  );
  if (unsupported.length > 0) {
    return [
      `${label(ctx.path)}: schema uses keywords this validator does not implement: ${unsupported.join(", ")}`,
    ];
  }

  const errors = [];
  checkType(value, node, ctx, errors);
  checkEnumAndConst(value, node, ctx, errors);
  checkString(value, node, ctx, errors);
  checkArray(value, node, ctx, errors);
  checkObject(value, node, ctx, errors);
  checkCombinators(value, node, ctx, errors);
  return errors;
}

function resolve(schema, ctx) {
  let node = schema;
  if (typeof node.$ref === "string") {
    const target = derefPointer(node.$ref, ctx.root, ctx.path);
    // Sibling keys override the resolved target; $ref itself is consumed here
    // and must not survive into the merged node.
    const siblings = { ...node };
    delete siblings.$ref;
    node = { ...target, ...siblings };
  }
  const profileName = node["x-repo-profile"];
  if (
    profileName &&
    Object.prototype.hasOwnProperty.call(ctx.profile, profileName)
  ) {
    node = { ...node, ...ctx.profile[profileName] };
  }
  return node;
}

function derefPointer(ref, root, where) {
  if (ref === "#") return root;
  if (!ref.startsWith("#/"))
    fail(`${label(where)}: only local $ref is supported, got "${ref}"`);
  let target = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (target === undefined || target === null) break;
    target = target[segment];
  }
  if (target === undefined)
    fail(`${label(where)}: $ref "${ref}" does not resolve`);
  return target;
}

function checkType(value, node, ctx, errors) {
  if (node.type === undefined) return;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (!types.some((type) => matchesType(value, type))) {
    errors.push(
      `${label(ctx.path)} must be ${types.join(" or ")}, got ${describe(value)}`,
    );
  }
}

function matchesType(value, type) {
  switch (type) {
    case "object":
      return (
        value !== null && typeof value === "object" && !Array.isArray(value)
      );
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    default:
      return false;
  }
}

function checkEnumAndConst(value, node, ctx, errors) {
  if (
    Array.isArray(node.enum) &&
    !node.enum.some((option) => deepEqual(option, value))
  ) {
    errors.push(
      `${label(ctx.path)} must be one of ${node.enum.map((o) => JSON.stringify(o)).join(", ")}, got ${JSON.stringify(value)}`,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(node, "const") &&
    !deepEqual(node.const, value)
  ) {
    errors.push(
      `${label(ctx.path)} must be ${JSON.stringify(node.const)}, got ${JSON.stringify(value)}`,
    );
  }
}

function checkString(value, node, ctx, errors) {
  if (typeof value !== "string") return;
  if (typeof node.minLength === "number" && value.length < node.minLength) {
    errors.push(
      `${label(ctx.path)} must be at least ${node.minLength} character(s)`,
    );
  }
  if (
    typeof node.pattern === "string" &&
    !new RegExp(node.pattern, "u").test(value)
  ) {
    errors.push(
      `${label(ctx.path)} must match /${node.pattern}/, got ${JSON.stringify(value)}`,
    );
  }
}

function checkArray(value, node, ctx, errors) {
  if (!Array.isArray(value)) return;
  if (typeof node.minItems === "number" && value.length < node.minItems) {
    errors.push(
      `${label(ctx.path)} must have at least ${node.minItems} item(s), got ${value.length}`,
    );
  }
  if (node.uniqueItems === true) {
    const seen = new Set();
    for (const entry of value) {
      const key = JSON.stringify(entry);
      if (seen.has(key)) {
        errors.push(`${label(ctx.path)} must not repeat ${key}`);
        break;
      }
      seen.add(key);
    }
  }
  if (node.items !== undefined) {
    for (const [index, entry] of value.entries()) {
      errors.push(
        ...validate(entry, node.items, {
          ...ctx,
          path: `${ctx.path}[${index}]`,
        }),
      );
    }
  }
}

function checkObject(value, node, ctx, errors) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return;
  const keys = Object.keys(value);

  if (
    typeof node.minProperties === "number" &&
    keys.length < node.minProperties
  ) {
    errors.push(
      `${label(ctx.path)} must have at least ${node.minProperties} propert(ies), got ${keys.length}`,
    );
  }

  for (const key of node.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(`${label(join(ctx.path, key))} is required`);
    }
  }

  const properties = node.properties ?? {};
  for (const [key, subSchema] of Object.entries(properties)) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(
        ...validate(value[key], subSchema, {
          ...ctx,
          path: join(ctx.path, key),
        }),
      );
    }
  }

  if (node.additionalProperties !== undefined) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
      if (node.additionalProperties === false) {
        errors.push(`${label(join(ctx.path, key))} is not an allowed property`);
      } else {
        errors.push(
          ...validate(value[key], node.additionalProperties, {
            ...ctx,
            path: join(ctx.path, key),
          }),
        );
      }
    }
  }
}

function checkCombinators(value, node, ctx, errors) {
  for (const subSchema of node.allOf ?? []) {
    errors.push(...validate(value, subSchema, ctx));
  }

  if (Array.isArray(node.oneOf)) {
    const results = node.oneOf.map((sub) => validate(value, sub, ctx));
    const passing = results.filter((result) => result.length === 0).length;
    if (passing === 0) {
      // Report why every branch failed rather than the bare arity, which reads
      // as a schema bug to anyone who did not write the schema.
      const reasons = results
        .flat()
        .map((reason) => reason.replace(/^\S+ /, ""));
      errors.push(
        `${label(ctx.path)} matched no allowed form: ${[...new Set(reasons)].join("; ")}`,
      );
    } else if (passing > 1) {
      errors.push(
        `${label(ctx.path)} is ambiguous — it matched ${passing} allowed forms`,
      );
    }
  }

  if (
    Array.isArray(node.anyOf) &&
    !node.anyOf.some((sub) => validate(value, sub, ctx).length === 0)
  ) {
    errors.push(`${label(ctx.path)} must match at least one allowed form`);
  }

  if (node.not !== undefined && validate(value, node.not, ctx).length === 0) {
    const hint = Array.isArray(node.not.required)
      ? ` — ${node.not.required.join(", ")} must be absent`
      : "";
    errors.push(`${label(ctx.path)} must not match the excluded form${hint}`);
  }

  if (node.if !== undefined) {
    const branch =
      validate(value, node.if, ctx).length === 0 ? node.then : node.else;
    if (branch !== undefined) {
      const branchErrors = validate(value, branch, ctx);
      if (branchErrors.length > 0 && node.description) {
        errors.push(`${label(ctx.path)}: ${node.description}`);
      }
      errors.push(...branchErrors);
    }
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual(a[key], b[key]));
}

function join(base, key) {
  return base ? `${base}.${key}` : key;
}

function label(pointer) {
  return pointer === "" ? "(root)" : pointer;
}

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
