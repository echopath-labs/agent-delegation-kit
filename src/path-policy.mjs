import path from "node:path";
import { DelegationError } from "./errors.mjs";

export function normalizeRelativePath(value, field = "path") {
  if (typeof value !== "string" || value.length === 0) {
    throw new DelegationError("invalid_path", `${field} must be a non-empty string.`);
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(value) ||
    normalized.split("/").includes("..") ||
    normalized.includes("\0")
  ) {
    throw new DelegationError("invalid_path", `${field} must stay within the repository.`);
  }
  return normalized || ".";
}

function escapeRegex(character) {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

export function globToRegExp(pattern) {
  const normalized = normalizeRelativePath(pattern, "scope pattern");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(character);
    }
  }
  return new RegExp(`${source}$`);
}

export function evaluatePathScope(changedPaths, scope) {
  const allowed = scope.allowedPaths.map(globToRegExp);
  const forbidden = scope.forbiddenPaths.map(globToRegExp);
  const breaches = [];

  for (const rawPath of changedPaths) {
    const candidate = normalizeRelativePath(rawPath, "changed path");
    const isAllowed = allowed.some((pattern) => pattern.test(candidate));
    const isForbidden = forbidden.some((pattern) => pattern.test(candidate));
    if (!isAllowed || isForbidden) breaches.push(candidate);
  }

  return [...new Set(breaches)].sort();
}
