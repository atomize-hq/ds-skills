/** Supported static CSF adapter. This module is bundled; it never imports story code. */
import ts from "typescript";
import { isExportStory, storyNameFromExport, toId } from "@storybook/csf";

export function parseStorySource(text, filePath) {
  const errors = [];
  const source = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (source.parseDiagnostics.length)
    return {
      errors: source.parseDiagnostics.map(
        (d) =>
          `[STORYBOOK_CSF_SYNTAX] ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
      ),
      storyIds: [],
    };
  const variables = new Map(),
    names = [];
  let meta = null;
  const error = (message) =>
    errors.push(`[STORYBOOK_CSF_UNSUPPORTED] ${filePath}: ${message}`);
  for (const statement of source.statements) {
    const exported = statement.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          if (exported) error("destructured exports are unsupported");
          continue;
        }
        variables.set(declaration.name.text, declaration.initializer);
        if (exported) names.push(declaration.name.text);
      }
    } else if (
      ts.isFunctionDeclaration(statement) &&
      exported &&
      statement.name
    )
      names.push(statement.name.text);
    else if (ts.isExportAssignment(statement) && !statement.isExportEquals)
      meta = statement.expression;
    else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly)
      error(
        "named re-exports/export lists are unsupported; declare local story exports",
      );
    else if (
      ts.isExpressionStatement(statement) &&
      !ts.isStringLiteral(statement.expression)
    )
      error("top-level runtime expressions/mutations are unsupported");
    else if (
      ts.isExportAssignment(statement) ||
      (exported &&
        !ts.isTypeAliasDeclaration(statement) &&
        !ts.isInterfaceDeclaration(statement))
    )
      error("unsupported runtime export");
  }
  function resolve(expression) {
    let current = unwrap(expression);
    const seen = new Set();
    while (current && ts.isIdentifier(current)) {
      if (seen.has(current.text)) {
        error("cyclic metadata alias");
        return null;
      }
      seen.add(current.text);
      current = unwrap(variables.get(current.text));
    }
    return current;
  }
  const object = resolve(meta);
  if (!object || !ts.isObjectLiteralExpression(object))
    error("default metadata must resolve to a local object");
  const fields = new Map();
  if (object && ts.isObjectLiteralExpression(object))
    for (const property of object.properties) {
      if (
        ts.isSpreadAssignment(property) ||
        (property.name && ts.isComputedPropertyName(property.name))
      ) {
        error("metadata spreads/computed keys are unsupported");
        continue;
      }
      const name = property.name?.text;
      if (!["title", "id", "includeStories", "excludeStories"].includes(name))
        continue;
      if (fields.has(name)) error(`duplicate metadata field ${name}`);
      if (ts.isPropertyAssignment(property))
        fields.set(name, resolve(property.initializer));
      else if (ts.isShorthandPropertyAssignment(property))
        fields.set(name, resolve(property.name));
      else error(`metadata ${name} must be static`);
    }
  const literal = (expression) =>
    expression &&
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression))
      ? expression.text
      : null;
  const title = literal(fields.get("title")),
    id = literal(fields.get("id"));
  if (
    (!id && !title) ||
    (fields.has("id") && !id) ||
    (fields.has("title") && !title)
  )
    error("provide a non-empty literal metadata title or id");
  const filters = {};
  for (const key of ["includeStories", "excludeStories"])
    if (fields.has(key)) {
      const expression = fields.get(key);
      if (expression && ts.isArrayLiteralExpression(expression)) {
        const values = expression.elements.map((e) => literal(resolve(e)));
        if (values.some((v) => v === null))
          error(`${key} must be a literal string array`);
        else filters[key] = values;
      } else if (expression && ts.isRegularExpressionLiteral(expression)) {
        const match = expression.text.match(/^\/(.*)\/([a-z]*)$/s);
        try {
          filters[key] = new RegExp(match[1], match[2]);
        } catch {
          error(`invalid ${key} regexp`);
        }
      } else error(`${key} must be a literal array or regexp`);
    }
  // This adapter derives IDs from metadata and export names, not runtime overrides.
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name?.text === "__id")
      error("runtime __id overrides are unsupported");
    ts.forEachChild(node, visit);
  }
  visit(source);
  const storyIds = [];
  if (!errors.length)
    for (const name of names.filter(
      (name) => name !== "__namedExportsOrder" && isExportStory(name, filters),
    )) {
      try {
        const storyId = toId(id || title, storyNameFromExport(name));
        if (storyIds.includes(storyId)) error(`duplicate story ID ${storyId}`);
        storyIds.push(storyId);
      } catch (cause) {
        error(cause.message);
      }
    }
  return { errors, storyIds: errors.length ? [] : storyIds };
}
function unwrap(expression) {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isTypeAssertionExpression(current))
  )
    current = current.expression;
  return current;
}

// Bundled formatting is deterministic and never reads consumer plugins/configuration.
export { formatProofReport } from "./proof-formatter.mjs";

export { parseContractSource } from "../source-checks/contract-parser.mjs";
