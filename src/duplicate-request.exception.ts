/**
 * Thrown by RequestDeduplicatorGuard when a request is a duplicate of an
 * already-completed operation.
 *
 * This class intentionally extends plain `Error` — not `HttpException` from
 * `@nestjs/common` — so that it survives `instanceof` checks across module
 * boundaries (e.g. when the package is linked via `file:` during development,
 * or when the consumer app runs a different version of `@nestjs/common`).
 *
 * Handle it in your application with a `@Catch(DuplicateRequestException)` filter.
 */
export class DuplicateRequestException extends Error {
  readonly statusCode = 409;
  readonly code = 'DUPLICATE_REQUEST';

  constructor(message = 'This operation has already been completed') {
    super(message);
    this.name = 'DuplicateRequestException';
    // Restore prototype chain — required when targeting ES5 with TypeScript
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
