import ts from "typescript";
export function parseContractSource(text, file) {
  const ast = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const errors = ast.parseDiagnostics.map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, " "),
  );
  const exports = new Map(),
    imports = [],
    declared = new Set(),
    selected = new Set(),
    types = new Set();
  let wildcard = false,
    dynamicSlots = false,
    dynamicSelectors = false;
  const modifiers = (n) => n.modifiers ?? [];
  const has = (n, k) => modifiers(n).some((m) => m.kind === k);
  for (const node of ast.statements)
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      node.name
    )
      types.add(node.name.text);
  for (const node of ast.statements) {
    if (ts.isExportDeclaration(node)) {
      if (!node.exportClause) {
        wildcard = true;
        continue;
      }
      if (ts.isNamedExports(node.exportClause))
        for (const part of node.exportClause.elements)
          exports.set(
            part.name.text,
            node.isTypeOnly ||
              part.isTypeOnly ||
              (!node.moduleSpecifier &&
                types.has((part.propertyName ?? part.name).text))
              ? "type"
              : "value",
          );
      else
        exports.set(
          node.exportClause.name.text,
          node.isTypeOnly ? "type" : "value",
        );
    } else if (ts.isExportAssignment(node)) {
      if (!node.isExportEquals) exports.set("default", "value");
      else errors.push("export = is not supported");
    } else if (has(node, ts.SyntaxKind.ExportKeyword)) {
      if (has(node, ts.SyntaxKind.DefaultKeyword)) {
        exports.set(
          "default",
          ts.isInterfaceDeclaration(node) ? "type" : "value",
        );
        continue;
      }
      if (ts.isVariableStatement(node))
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) exports.set(d.name.text, "value");
          else errors.push("Exported destructuring is not supported");
        }
      else if (node.name && ts.isIdentifier(node.name))
        exports.set(
          node.name.text,
          ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)
            ? "type"
            : "value",
        );
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    )
      imports.push({
        specifier: node.moduleReference.expression.text,
        bindings: [],
        unsupported: true,
      });
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause,
        bindings = [];
      if (clause?.name)
        bindings.push({ name: "default", typeOnly: !!clause.isTypeOnly });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const part of clause.namedBindings.elements)
          bindings.push({
            name: (part.propertyName ?? part.name).text,
            typeOnly: !!clause.isTypeOnly || part.isTypeOnly,
          });
      imports.push({
        specifier: node.moduleSpecifier.text,
        bindings,
        unsupported:
          !!clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings),
      });
    }
  }
  function scan(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "data-slot") {
      const value = node.initializer;
      const literal = ts.isStringLiteral(value ?? {})
        ? value
        : value && ts.isJsxExpression(value)
          ? value.expression
          : null;
      if (
        literal &&
        (ts.isStringLiteral(literal) ||
          ts.isNoSubstitutionTemplateLiteral(literal))
      )
        declared.add(literal.text);
      else dynamicSlots = true;
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !ts.isLiteralTypeNode(node.parent)
    ) {
      for (const pattern of [
        /\[data-slot=['"]?([a-z0-9-]+)['"]?\]/g,
        /(?:has-)?data-\[slot=['"]?([a-z0-9-]+)['"]?\]/g,
      ])
        for (const match of node.text.matchAll(pattern)) selected.add(match[1]);
    }
    if (
      ts.isTemplateExpression(node) &&
      /(?:data-slot=|data-\[slot=)/.test(node.getText(ast))
    )
      dynamicSelectors = true;
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(ast) === "require") &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      imports.push({
        specifier: node.arguments[0].text,
        bindings: [],
        unsupported: true,
      });
    ts.forEachChild(node, scan);
  }
  scan(ast);
  return {
    errors,
    exports: [...exports],
    imports,
    declared: [...declared],
    selected: [...selected],
    wildcard,
    dynamicSlots,
    dynamicSelectors,
  };
}
