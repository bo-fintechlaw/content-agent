export const logger: {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
};

export function start(fnName: string, meta?: Record<string, unknown>): void;
export function success(fnName: string, meta?: Record<string, unknown>): void;
export function fail(
  fnName: string,
  error: unknown,
  meta?: Record<string, unknown>
): void;
