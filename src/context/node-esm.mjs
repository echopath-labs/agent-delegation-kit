import { DelegationError } from "../errors.mjs";

const REGEX_START_AFTER = new Set([
  "(", "[", "{", ",", ";", ":", "=", "!", "?", "&&", "||", "??",
  "=>", "+", "-", "*", "%", "&", "|", "^", "~", "<", ">"
]);
const REGEX_KEYWORDS = new Set([
  "return", "throw", "case", "delete", "void", "typeof", "instanceof",
  "in", "of", "yield", "await", "else", "do", "new"
]);

function token(type, value, start, end, lineBreak = false) {
  return { type, value, start, end, lineBreak };
}

function isIdentifierStart(character) {
  return /[A-Za-z_$]/u.test(character);
}

function isIdentifierPart(character) {
  return /[A-Za-z0-9_$]/u.test(character);
}

function skipQuoted(source, start, quote) {
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
    } else if (character === quote) {
      return index + 1;
    } else if (character === "\n" || character === "\r") {
      return -1;
    } else {
      index += 1;
    }
  }
  return -1;
}

function skipTemplate(source, start) {
  let index = start + 1;
  let interpolated = false;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === "$" && source[index + 1] === "{") interpolated = true;
    if (source[index] === "`") {
      const end = index + 1;
      return {
        end,
        potentialDependency: interpolated && /\b(?:import|export)\b/u.test(source.slice(start + 1, end - 1))
      };
    }
    index += 1;
  }
  return { end: -1, potentialDependency: false };
}

function skipRegex(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "[") inClass = true;
    else if (character === "]") inClass = false;
    else if (character === "/" && !inClass) {
      index += 1;
      while (/[A-Za-z]/u.test(source[index] ?? "")) index += 1;
      return index;
    } else if (character === "\n" || character === "\r") {
      return -1;
    }
    index += 1;
  }
  return -1;
}

function canStartRegex(previous) {
  if (!previous) return true;
  if (previous.type === "identifier") return REGEX_KEYWORDS.has(previous.value);
  if (previous.type === "string" || previous.type === "regex" || previous.type === "number") return false;
  return REGEX_START_AFTER.has(previous.value);
}

function decodeString(raw) {
  const quote = raw[0];
  if (raw.at(-1) !== quote) return null;
  let output = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      output += character;
      continue;
    }
    const next = raw[++index];
    if (next === undefined) return null;
    if (next === "\n") continue;
    if (next === "\r") {
      if (raw[index + 1] === "\n") index += 1;
      continue;
    }
    const simple = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" };
    if (Object.hasOwn(simple, next)) {
      output += simple[next];
    } else if (next === "x") {
      const hex = raw.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/u.test(hex)) return null;
      output += String.fromCodePoint(Number.parseInt(hex, 16));
      index += 2;
    } else if (next === "u") {
      let hex;
      if (raw[index + 1] === "{") {
        const close = raw.indexOf("}", index + 2);
        if (close < 0) return null;
        hex = raw.slice(index + 2, close);
        index = close;
      } else {
        hex = raw.slice(index + 1, index + 5);
        if (hex.length !== 4) return null;
        index += 4;
      }
      if (!/^[0-9A-Fa-f]+$/u.test(hex)) return null;
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint > 0x10ffff) return null;
      output += String.fromCodePoint(codePoint);
    } else {
      output += next;
    }
  }
  return output;
}

function tokenize(source) {
  const tokens = [];
  const issues = [];
  let index = 0;
  let hadLineBreak = false;
  let previous = null;
  while (index < source.length) {
    const character = source[index];
    if (/\s/u.test(character)) {
      if (character === "\n" || character === "\r") hadLineBreak = true;
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
      hadLineBreak = true;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) {
        issues.push("unterminated block comment");
        break;
      }
      if (/[\r\n]/u.test(source.slice(index, end + 2))) hadLineBreak = true;
      index = end + 2;
      continue;
    }
    if (character === "'" || character === '"') {
      const start = index;
      const end = skipQuoted(source, index, character);
      if (end < 0) {
        issues.push("unterminated string literal");
        break;
      }
      const raw = source.slice(start, end);
      const value = decodeString(raw);
      tokens.push(token("string", value, start, end, hadLineBreak));
      previous = tokens.at(-1);
      hadLineBreak = false;
      index = end;
      continue;
    }
    if (character === "`") {
      const start = index;
      const template = skipTemplate(source, index);
      if (template.end < 0) {
        issues.push("unterminated template literal");
        break;
      }
      if (template.potentialDependency) issues.push("dependency syntax inside template interpolation is unsupported");
      tokens.push(token("template", null, start, template.end, hadLineBreak));
      previous = tokens.at(-1);
      hadLineBreak = false;
      index = template.end;
      continue;
    }
    if (character === "/" && canStartRegex(previous)) {
      const end = skipRegex(source, index);
      if (end > 0) {
        tokens.push(token("regex", null, index, end, hadLineBreak));
        previous = tokens.at(-1);
        hadLineBreak = false;
        index = end;
        continue;
      }
      issues.push("unterminated regular expression literal");
      break;
    }
    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (isIdentifierPart(source[index] ?? "")) index += 1;
      tokens.push(token("identifier", source.slice(start, index), start, index, hadLineBreak));
      previous = tokens.at(-1);
      hadLineBreak = false;
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9._]/u.test(source[index] ?? "")) index += 1;
      tokens.push(token("number", source.slice(start, index), start, index, hadLineBreak));
      previous = tokens.at(-1);
      hadLineBreak = false;
      continue;
    }
    const three = source.slice(index, index + 3);
    const two = source.slice(index, index + 2);
    const punct = ["...", "=>", "?.", "&&", "||", "??", "**", "==", "!=", "<=", ">=", "++", "--", "?."];
    const value = punct.includes(three) ? three : punct.includes(two) ? two : character;
    tokens.push(token("punct", value, index, index + value.length, hadLineBreak));
    previous = tokens.at(-1);
    hadLineBreak = false;
    index += value.length;
  }
  return { tokens, issues: [...new Set(issues)] };
}

function classifySpecifier(specifier) {
  if (specifier.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(specifier) || specifier.startsWith("\\\\")) return "unresolved";
  if (specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../")) return "local";
  if (specifier.startsWith("node:")) return "external";
  if (specifier.startsWith("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(specifier)) return "unresolved";
  if (!specifier.startsWith("/")) return "external";
  return "unresolved";
}

function reference(kind, specifier, reason = undefined) {
  const result = { kind, classification: kind === "unresolved" ? "unresolved" : classifySpecifier(specifier), specifier };
  if (reason) result.reason = reason;
  return result;
}

function isLiteralSpecifier(candidate) {
  return candidate?.type === "string" && typeof candidate.value === "string" && candidate.value.length > 0;
}

function findStringAfter(tokens, start, stopAtClose = false) {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const current = tokens[index];
    if (current.value === "{" || current.value === "(" || current.value === "[") depth += 1;
    if (current.value === "}" || current.value === ")" || current.value === "]") {
      if (depth === 0 && stopAtClose) return null;
      depth = Math.max(0, depth - 1);
    }
    if (current.value === ";" && depth === 0) return null;
    if (current.value === "from" && tokens[index + 1]?.type === "string") return tokens[index + 1];
  }
  return null;
}

function classifyImport(tokens, index) {
  const current = tokens[index];
  const next = tokens[index + 1];
  const previous = tokens[index - 1];
  if (previous?.value === "." || previous?.value === "?.") return null;
  if (next?.value === ".") {
    return tokens[index + 2]?.value === "meta" ? null : reference("unresolved", "<ambiguous>", "ambiguous import syntax");
  }
  if (next?.value === "(") {
    const argument = tokens[index + 2];
    if (isLiteralSpecifier(argument) && (tokens[index + 3]?.value === ")" || tokens[index + 3]?.value === ",")) {
      return reference("dynamic", argument.value);
    }
    return reference("unresolved", "<non-literal>", "non-literal dynamic import");
  }
  if (isLiteralSpecifier(next)) return reference("static", next.value);
  const from = findStringAfter(tokens, index + 1);
  if (from) return reference("static", from.value);
  return reference("unresolved", "<ambiguous>", "ambiguous static import syntax");
}

function classifyExport(tokens, index) {
  const next = tokens[index + 1];
  if (next?.value !== "*" && next?.value !== "{") return null;
  const from = findStringAfter(tokens, index + 1);
  if (from) return reference("static", from.value);
  return null;
}

/**
 * Lexically classify Node ESM references. It intentionally does not attempt
 * to become a JavaScript parser: unsupported or ambiguous syntax is reported
 * as unresolved, and no code is evaluated.
 */
export function analyzeNodeEsm({ relativePath, source }) {
  if (typeof relativePath !== "string" || typeof source !== "string") {
    throw new DelegationError("invalid_analyzer_input", "node-esm requires relativePath and source text.");
  }
  if (!relativePath.endsWith(".js") && !relativePath.endsWith(".mjs")) {
    return { analyzer: "node-esm", references: [] };
  }
  const { tokens, issues } = tokenize(source);
  const references = issues.map((reason) => reference("unresolved", "<lexical-error>", reason));
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "identifier") continue;
    if (tokens[index].value === "import") {
      const found = classifyImport(tokens, index);
      if (found) references.push(found);
    } else if (tokens[index].value === "export") {
      const found = classifyExport(tokens, index);
      if (found) references.push({ ...found, kind: "reexport" });
    }
  }
  return { analyzer: "node-esm", references };
}

export const analyze = analyzeNodeEsm;
export const analyzeNodeEsmSource = analyzeNodeEsm;
