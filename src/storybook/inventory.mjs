export const allowedStorybookValidatorKinds = Object.freeze([
  "default",
  "variant-matrix",
  "state-matrix",
  "actions",
  "controlled",
  "keyboard",
  "focus",
  "workflow",
  "motion",
  "async",
  "docs",
  "responsive",
  "composition",
]);

const storybookValidatorKindOrder = new Map(
  allowedStorybookValidatorKinds.map((kind, index) => [kind, index]),
);

export function validateStoryInventory(data) {
  const errors = [];

  if (!assertPlainObject(errors, data, "storyInventory")) {
    return errors;
  }

  validateKeySpec(
    errors,
    data,
    {
      required: ["inventoryVersion", "components"],
      optional: [],
    },
    "storyInventory",
  );
  requireLiteral(errors, data.inventoryVersion, "1", "inventoryVersion");

  if (!Array.isArray(data.components)) {
    errors.push(
      "[CT-9B_STORY_INVENTORY_INVALID_COMPONENTS] components must be an array",
    );
    return errors;
  }

  const seenComponentIds = new Set();
  for (const [index, component] of data.components.entries()) {
    validateComponent(errors, component, index, seenComponentIds);
  }

  return errors;
}

function validateComponent(errors, component, index, seenComponentIds) {
  const label = `components[${index}]`;
  if (!assertPlainObject(errors, component, label)) {
    return;
  }

  validateKeySpec(
    errors,
    component,
    {
      required: ["componentId", "validatorKinds", "implementedStoryRefs"],
      optional: [],
    },
    label,
  );

  const componentId = component.componentId;
  if (typeof componentId !== "string" || componentId.length === 0) {
    errors.push(
      `[CT-9B_STORY_INVENTORY_INVALID_COMPONENT_ID] ${label}.componentId must be a non-empty string`,
    );
  } else if (seenComponentIds.has(componentId)) {
    errors.push(
      `[CT-9B_STORY_INVENTORY_DUPLICATE_COMPONENT_ID] ${label}.componentId duplicates "${componentId}"`,
    );
  } else {
    seenComponentIds.add(componentId);
  }

  const validatorKinds = validateValidatorKinds(
    errors,
    component.validatorKinds,
    label,
  );
  const implementedKinds = validateImplementedStoryRefs(
    errors,
    component.implementedStoryRefs,
    label,
  );

  if (validatorKinds === null || implementedKinds === null) {
    return;
  }

  if (!sameSet(validatorKinds, implementedKinds)) {
    errors.push(
      `[CT-9B_STORY_INVENTORY_KIND_SET_MISMATCH] ${label}.validatorKinds must match ${label}.implementedStoryRefs.kind exactly`,
    );
  }
}

function validateValidatorKinds(errors, validatorKinds, componentLabel) {
  const label = `${componentLabel}.validatorKinds`;
  if (!Array.isArray(validatorKinds)) {
    errors.push(
      `[CT-9B_STORY_INVENTORY_INVALID_KIND_LIST] ${label} must be an array`,
    );
    return null;
  }

  const uniqueKinds = new Set();
  let previousKindIndex = -1;

  for (const [index, kind] of validatorKinds.entries()) {
    const itemLabel = `${label}[${index}]`;
    if (typeof kind !== "string" || kind.length === 0) {
      errors.push(
        `[CT-9B_STORY_INVENTORY_INVALID_KIND] ${itemLabel} must be a non-empty string`,
      );
      continue;
    }

    if (!storybookValidatorKindOrder.has(kind)) {
      errors.push(
        `[CT-9B_STORY_INVENTORY_UNKNOWN_KIND] ${itemLabel} must be one of ${allowedStorybookValidatorKinds.join(", ")}`,
      );
      continue;
    }

    if (uniqueKinds.has(kind)) {
      errors.push(
        `[CT-9B_STORY_INVENTORY_DUPLICATE_KIND] ${itemLabel} duplicates "${kind}" in ${label}`,
      );
      continue;
    }

    const nextKindIndex = storybookValidatorKindOrder.get(kind);
    if (nextKindIndex < previousKindIndex) {
      errors.push(
        `[CT-9B_STORY_INVENTORY_INVALID_KIND_ORDER] ${label} must follow the canonical validator kind order`,
      );
    }

    previousKindIndex = nextKindIndex;
    uniqueKinds.add(kind);
  }

  return uniqueKinds;
}

function validateImplementedStoryRefs(
  errors,
  implementedStoryRefs,
  componentLabel,
) {
  const label = `${componentLabel}.implementedStoryRefs`;
  if (!Array.isArray(implementedStoryRefs)) {
    errors.push(
      `[CT-9B_STORY_INVENTORY_INVALID_STORY_REF_LIST] ${label} must be an array`,
    );
    return null;
  }

  const uniqueKinds = new Set();
  const seenPairs = new Set();

  for (const [index, storyRef] of implementedStoryRefs.entries()) {
    const itemLabel = `${label}[${index}]`;
    if (!assertPlainObject(errors, storyRef, itemLabel)) {
      continue;
    }

    validateKeySpec(
      errors,
      storyRef,
      {
        required: ["kind", "storyId"],
        optional: [],
      },
      itemLabel,
    );

    const { kind, storyId } = storyRef;
    if (typeof kind !== "string" || kind.length === 0) {
      errors.push(
        `[CT-9B_STORY_INVENTORY_INVALID_STORY_REF_KIND] ${itemLabel}.kind must be a non-empty string`,
      );
    } else if (!storybookValidatorKindOrder.has(kind)) {
      errors.push(
        `[CT-9B_STORY_INVENTORY_UNKNOWN_KIND] ${itemLabel}.kind must be one of ${allowedStorybookValidatorKinds.join(", ")}`,
      );
    } else {
      uniqueKinds.add(kind);
    }

    if (typeof storyId !== "string" || storyId.length === 0) {
      errors.push(
        `[CT-9B_STORY_INVENTORY_INVALID_STORY_ID] ${itemLabel}.storyId must be a non-empty string`,
      );
      continue;
    }

    const storyRefKey = `${kind}::${storyId}`;
    if (seenPairs.has(storyRefKey)) {
      errors.push(
        `[CT-9B_STORY_INVENTORY_DUPLICATE_STORY_REF] ${itemLabel} duplicates { kind: "${kind}", storyId: "${storyId}" }`,
      );
      continue;
    }

    seenPairs.add(storyRefKey);
  }

  return uniqueKinds;
}

function assertPlainObject(errors, value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(
      `[CT-9B_STORY_INVENTORY_INVALID_OBJECT] ${label} must be an object`,
    );
    return false;
  }

  return true;
}

function validateKeySpec(errors, value, keySpec, label) {
  const requiredKeys = [...keySpec.required].sort();
  const optionalKeys = [...(keySpec.optional ?? [])].sort();
  const allowedKeys = [...requiredKeys, ...optionalKeys].sort();
  const actualKeys = Object.keys(value).sort();

  for (const key of requiredKeys) {
    if (!actualKeys.includes(key)) {
      errors.push(
        `[CT-9B_STORY_INVENTORY_MISSING_REQUIRED_KEY] ${label}.${key} is required`,
      );
    }
  }

  for (const key of actualKeys) {
    if (!allowedKeys.includes(key)) {
      errors.push(
        `[CT-9B_STORY_INVENTORY_UNEXPECTED_KEY] ${label}.${key} is not allowed`,
      );
    }
  }
}

function requireLiteral(errors, actual, expected, label) {
  if (actual !== expected) {
    errors.push(
      `[CT-9B_STORY_INVENTORY_INVALID_LITERAL] ${label} must be ${expected}`,
    );
  }
}

function sameSet(left, right) {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}
