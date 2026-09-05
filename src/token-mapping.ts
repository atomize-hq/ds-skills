export type TokenLeafType =
  | "color"
  | "dimension"
  | "duration"
  | "string"
  | "boolean"
  | "number";

export type FigmaResolvedType = "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";

export type FigmaColor = { r: number; g: number; b: number; a: number };

export type FigmaValue = FigmaColor | number | string | boolean;

export type TokenLeaf = {
  name: string;
  path: string[];
  resolvedType: FigmaResolvedType;
  value: FigmaValue;
};

const supportedTokenTypes = new Set<TokenLeafType>([
  "color",
  "dimension",
  "duration",
  "string",
  "boolean",
  "number",
]);

export function flattenTokenDocument(document: unknown): TokenLeaf[] {
  const leaves: TokenLeaf[] = [];
  walkTokenNode(document, [], leaves);
  return leaves.sort((left, right) => left.name.localeCompare(right.name));
}

function walkTokenNode(
  node: unknown,
  pathSegments: string[],
  leaves: TokenLeaf[],
) {
  if (!isPlainObject(node)) {
    throw new Error("token artifact must contain objects only");
  }

  if (Object.prototype.hasOwnProperty.call(node, "$value")) {
    if (!Object.prototype.hasOwnProperty.call(node, "$type")) {
      throw new Error(`token ${pathSegments.join(".")} is missing $type`);
    }

    const tokenType = (node as { $type?: unknown }).$type;
    if (
      typeof tokenType !== "string" ||
      !supportedTokenTypes.has(tokenType as TokenLeafType)
    ) {
      throw new Error(
        `unsupported token type ${String(tokenType)} at ${pathSegments.join(".")}`,
      );
    }

    const tokenValue = (node as { $value?: unknown }).$value;
    leaves.push({
      name: pathSegments.map(sanitizeVariablePathSegment).join("/"),
      path: pathSegments,
      resolvedType: mapResolvedType(tokenType as TokenLeafType),
      value: normalizeTokenValue(tokenType as TokenLeafType, tokenValue),
    });
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) {
      continue;
    }
    walkTokenNode(value, [...pathSegments, key], leaves);
  }
}

function normalizeTokenValue(
  tokenType: TokenLeafType,
  value: unknown,
): FigmaValue {
  switch (tokenType) {
    case "color":
      return parseColorValue(value);
    case "dimension":
      return parseDimensionValue(value);
    case "duration":
      return parseDurationValue(value);
    case "string":
      return parseStringValue(value);
    case "boolean":
      return parseBooleanValue(value);
    case "number":
      return parseNumberValue(value);
    default: {
      const exhaustive: never = tokenType;
      throw new Error(`unsupported token type ${exhaustive}`);
    }
  }
}

function mapResolvedType(tokenType: TokenLeafType): FigmaResolvedType {
  switch (tokenType) {
    case "color":
      return "COLOR";
    case "dimension":
    case "duration":
    case "number":
      return "FLOAT";
    case "string":
      return "STRING";
    case "boolean":
      return "BOOLEAN";
    default: {
      const exhaustive: never = tokenType;
      throw new Error(`unsupported token type ${exhaustive}`);
    }
  }
}

function parseColorValue(value: unknown): FigmaColor {
  if (typeof value !== "string") {
    throw new Error("color tokens must use string values");
  }

  const normalized = value.trim();
  if (normalized.startsWith("#")) {
    const hex = normalized.replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
      throw new Error(
        `color token value ${value} must use #RRGGBB or #RRGGBBAA`,
      );
    }

    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgbaMatch =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.exec(
      normalized,
    );
  if (!rgbaMatch) {
    throw new Error(
      `color token value ${value} must use #RRGGBB, #RRGGBBAA, rgb(...), or rgba(...)`,
    );
  }

  const channel = (input: string) => {
    const number = Number(input);
    if (number < 0 || number > 255) {
      throw new Error(
        `color token value ${value} must keep RGB channels between 0 and 255`,
      );
    }
    return number / 255;
  };

  const alpha = rgbaMatch[4] == null ? 1 : Number(rgbaMatch[4]);
  if (alpha < 0 || alpha > 1) {
    throw new Error(
      `color token value ${value} must keep alpha between 0 and 1`,
    );
  }

  const [, red, green, blue] = rgbaMatch;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`color token value ${value} is missing an rgb channel`);
  }

  return {
    r: channel(red),
    g: channel(green),
    b: channel(blue),
    a: alpha,
  };
}

function parseDimensionValue(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    throw new Error("dimension tokens must use string values");
  }

  const match = /^\s*(-?\d+(?:\.\d+)?)(px|rem|em|%|)?\s*$/.exec(value);
  if (!match) {
    throw new Error(
      `dimension token value ${value} must be a numeric value with optional unit`,
    );
  }

  return Number(match[1]);
}

function parseDurationValue(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    throw new Error("duration tokens must use string values");
  }

  const match = /^\s*(-?\d+(?:\.\d+)?)(ms|s)\s*$/.exec(value);
  if (!match) {
    throw new Error(`duration token value ${value} must use ms or s units`);
  }

  return match[2] === "s" ? Number(match[1]) * 1000 : Number(match[1]);
}

function parseStringValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("string tokens must use string values");
  }
  return value;
}

function parseBooleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("boolean tokens must use boolean values");
  }
  return value;
}

function parseNumberValue(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error("number tokens must not be empty strings");
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(`number token value ${value} must be a finite number`);
    }
    return parsed;
  }

  throw new Error("number tokens must use numeric values");
}

function sanitizeVariablePathSegment(segment: string) {
  return String(segment).replace(/[.{}]/g, "-");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
