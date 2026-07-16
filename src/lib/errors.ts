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

/** Raised when a login attempt fails (unknown username or wrong password).
 * Deliberately does not distinguish which of the two in its message — that
 * distinction is exactly the kind of detail that helps an attacker
 * enumerate valid usernames. */
export class AuthenticationError extends Error {
  constructor(message = "Nom d'utilisateur ou mot de passe incorrect.") {
    super(message);
    this.name = "AuthenticationError";
  }
}
