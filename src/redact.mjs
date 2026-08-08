const sensitiveAssignment = /\b[A-Za-z0-9_]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi;
const bearerValue = /\bBearer\s+[A-Za-z0-9._~+\/-]+/gi;
const likelyKey = /\b(sk-[A-Za-z0-9_-]{8,}|gh[opusr]_[A-Za-z0-9_]{8,})\b/g;

export function redact(text) {
  return String(text ?? "")
    .replace(sensitiveAssignment, "[REDACTED_CREDENTIAL]")
    .replace(bearerValue, "Bearer [REDACTED]")
    .replace(likelyKey, "[REDACTED]");
}

export function conciseOutput(text, maxLength = 4000) {
  const safe = redact(text).trim();
  if (safe.length <= maxLength) return safe;
  return `${safe.slice(0, maxLength)}\n[output truncated]`;
}
