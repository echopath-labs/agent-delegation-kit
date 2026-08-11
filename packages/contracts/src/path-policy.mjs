import path from "node:path";
import { DelegationError } from "./errors.mjs";

const RESERVED_SEGMENTS = new Set([".git", ".agent-delegation"]);

export function isReservedPath(value) {
  return String(value).replaceAll("\\", "/").split("/").some((segment) => RESERVED_SEGMENTS.has(segment.toLowerCase()));
}

export function normalizeRelativePath(value, field = "path") {
  if (typeof value !== "string" || value.length === 0) {
    throw new DelegationError("invalid_path", `${field} must be a non-empty string.`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(value) ||
    normalized.split("/").includes("..") ||
    normalized.includes("\0")
  ) {
    throw new DelegationError("invalid_path", `${field} must stay within the repository.`);
  }
  const canonical = path.posix.normalize(normalized);
  if (canonical !== normalized || normalized.includes("//") || normalized.endsWith("/") && normalized !== "/") {
    throw new DelegationError("invalid_path", `${field} must use one canonical repository-relative spelling.`);
  }
  return canonical || ".";
}

function escapeRegex(character) {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

export function globToRegExp(pattern, options = {}) {
  const normalized = normalizeRelativePath(pattern, "scope pattern");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          source += "(?:.*/)?";
          index += 1;
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(character);
    }
  }
  return new RegExp(`${source}$`, options.caseInsensitive === true ? "i" : "");
}

export function evaluatePathScope(changedPaths, scope) {
  const allowed = scope.allowedPaths.map(globToRegExp);
  const forbidden = scope.forbiddenPaths.map((pattern) => globToRegExp(pattern, { caseInsensitive: true }));
  const breaches = [];

  for (const rawPath of changedPaths) {
    const candidate = normalizeRelativePath(rawPath, "changed path");
    const isAllowed = allowed.some((pattern) => pattern.test(candidate));
    const isForbidden = forbidden.some((pattern) => pattern.test(candidate));
    if (!isAllowed || isForbidden || isReservedPath(candidate)) breaches.push(candidate);
  }

  return [...new Set(breaches)].sort();
}
