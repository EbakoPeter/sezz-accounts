/**
 * Raised by repository methods when a caller-supplied value fails validation
 * (e.g. an empty name, a non-positive amount). Kept distinct from generic
 * `Error` so UI code can reliably distinguish "show this message to the
 * user" from "something unexpected broke".
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Raised when an operation references an id that does not exist. */
export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} introuvable (id: ${id})`);
    this.name = "NotFoundError";
  }
}
