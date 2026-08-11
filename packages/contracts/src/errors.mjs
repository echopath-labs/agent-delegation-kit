export class DelegationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "DelegationError";
    this.code = code;
    this.details = details;
  }
}

export function asDelegationError(error, fallbackCode = "unexpected_error") {
  if (error instanceof DelegationError) return error;
  return new DelegationError(fallbackCode, error instanceof Error ? error.message : String(error));
}
