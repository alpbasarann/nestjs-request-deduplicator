export enum DeduplicatorState {
  /**
   * The request is currently being processed.
   * Any duplicate arriving while a record is IN_PROGRESS receives a 409 Conflict.
   */
  IN_PROGRESS = 'IN_PROGRESS',

  /**
   * The request completed successfully.
   * Any duplicate receives a 409 Conflict immediately (no handler invocation).
   */
  COMPLETED = 'COMPLETED',

  /**
   * The request failed (handler threw, adapter write failed, etc.).
   * The next request with the same deduplication key is allowed to re-run the handler
   * after the record is reset to IN_PROGRESS.
   */
  FAILED = 'FAILED',
}

export enum LogLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}
