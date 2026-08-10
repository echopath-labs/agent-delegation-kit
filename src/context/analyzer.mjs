import { DelegationError } from "../errors.mjs";

/**
 * Provider-neutral analyzer contract. An analyzer is deliberately given only
 * a repository-relative identity and source text; it has no filesystem or
 * execution capability.
 */
const REFERENCE_KINDS = new Set(["static", "reexport", "dynamic", "unresolved"]);
const REFERENCE_CLASSIFICATIONS = new Set(["local", "external", "unresolved"]);

export function analyzeSource({ relativePath, source }, analyzer) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new DelegationError("invalid_analyzer_input", "Analyzer relativePath must be non-empty.");
  }
  if (typeof source !== "string") {
    throw new DelegationError("invalid_analyzer_input", "Analyzer source must be text.");
  }
  if (typeof analyzer !== "function") {
    throw new DelegationError("invalid_analyzer_input", "Analyzer must be callable.");
  }
  const result = analyzer({ relativePath, source });
  return validateAnalyzerResult(result);
}

export function validateAnalyzerResult(result) {
  if (
    !result || typeof result !== "object" ||
    typeof result.analyzer !== "string" || result.analyzer.length === 0 ||
    !Array.isArray(result.references)
  ) {
    throw new DelegationError("invalid_analyzer_result", "Analyzer must return an identity and references array.");
  }
  for (const reference of result.references) {
    if (
      !reference || typeof reference !== "object" ||
      !REFERENCE_KINDS.has(reference.kind) ||
      !REFERENCE_CLASSIFICATIONS.has(reference.classification) ||
      typeof reference.specifier !== "string" || reference.specifier.length === 0 ||
      (reference.kind === "unresolved" && reference.classification !== "unresolved")
    ) {
      throw new DelegationError("invalid_analyzer_result", "Analyzer references must use supported kinds, classifications, and non-empty specifiers.");
    }
  }
  return result;
}

// Kept as a named contract alias for callers that prefer a more explicit name.
export const analyzeFileSource = analyzeSource;
