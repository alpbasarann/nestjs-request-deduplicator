export type LogLevel = 'info' | 'warn' | 'error';

/**
 * A logging function compatible with any logger (NestJS Logger, Winston, Pino, Bunyan, etc.).
 * Map the `level` parameter to the matching method on your logger of choice.
 * Level filtering is the responsibility of the provided function.
 */
export type LoggerFn = (
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
) => void;

/**
 * Discriminated union controlling how internal log events are handled.
 *
 * - `{ mode: 'silent' }` — suppress all output.
 * - `{ mode: 'logged'; logger: LoggerFn }` — route events to your logger.
 */
export type LoggingConfig =
  | { mode: 'silent' }
  | { mode: 'logged'; logger: LoggerFn };
