/** Small lexical adapter for generated CSS, not a browser CSS validator. */
export function removeCssComments(source) {
  let result = "";
  for (let i = 0; i < source.length; ) {
    const end = skipOpaque(source, i);
    if (end !== i) {
      result += source.startsWith("/*", i)
        ? source.slice(i, end).replace(/[^\r\n]/g, " ")
        : source.slice(i, end);
      i = end;
    } else result += source[i++];
  }
  return result;
}

/** Quoted, unconditional, top-level imports only; url()/media imports do not qualify. */
export function readCssImports(source) {
  const css = removeCssComments(source);
  const imports = [];
  let depth = 0;
  for (let i = 0; i < css.length; ) {
    if (depth === 0 && css[i] === "@") {
      const match = css.slice(i).match(/^@import\s+(["'])([^"'\\\r\n]+)\1\s*;/);
      if (match) {
        imports.push(match[2]);
        i += match[0].length;
        continue;
      }
    }
    const end = skipOpaque(css, i);
    if (end !== i) {
      i = end;
      continue;
    }
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
    i++;
  }
  return imports;
}

export function declaredRuntimeProperties(source) {
  const css = removeCssComments(source);
  const names = new Set();
  let depth = 0;
  for (let i = 0; i < css.length; ) {
    const end = skipOpaque(css, i);
    if (end !== i) {
      i = end;
      continue;
    }
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
    // Generated output uses one declaration per line. Do not count text inside
    // strings, comments, selectors or var() references as a declaration.
    if (depth > 0 && (i === 0 || css[i - 1] === "\n")) {
      const match = css.slice(i).match(/^[\t ]*(--[a-z0-9-]+)\s*:/);
      if (match) names.add(match[1]);
    }
    i++;
  }
  return names;
}

function skipOpaque(source, i) {
  if (source.startsWith("/*", i)) {
    const end = source.indexOf("*/", i + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (source[i] !== '"' && source[i] !== "'") return i;
  const quote = source[i];
  for (let j = i + 1; j < source.length; j++) {
    if (source[j] === "\\") j++;
    else if (source[j] === quote) return j + 1;
  }
  return source.length;
}
