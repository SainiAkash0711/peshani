import { ConsoleLogger, LoggerService, LogLevel } from '@nestjs/common';

const REDACT_KEY_PATTERN = /secret|password|passwordhash|token|refreshtoken|jwt|apikey|api_key|credential|authorization/i;

/**
 * Structured, JSON-line logging for production log aggregation. Every entry
 * is one JSON object per line (timestamp, level, context, message, plus
 * optional structured fields) so a log shipper can parse/index/search it
 * without regex-scraping free-text NestJS output.
 *
 * Set globally via `app.useLogger(new StructuredLogger())` in main.ts, which
 * (per NestJS's own documented behavior) redirects every `new Logger(context)`
 * instance's calls through this implementation, not just Nest's internal
 * framework logging - so existing call sites (`this.logger.warn(...)` etc.)
 * across the codebase get structured output for free, with no per-call-site
 * rewrite required.
 *
 * `redact()` only protects the OPTIONAL structured-fields object a caller
 * passes alongside a message (see `logEvent()` below) - it cannot inspect or
 * redact content baked into a free-text message string. Removing a raw
 * secret/token from a log call is still the caller's own responsibility;
 * this is a safety net for structured fields, not a substitute for that
 * discipline.
 */
export class StructuredLogger extends ConsoleLogger {
  private writeLine(level: LogLevel, message: unknown, context?: string, extra?: Record<string, unknown>) {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      context: context ?? this.context,
      message: typeof message === 'string' ? message : String(message),
    };
    if (extra) {
      entry.fields = redact(extra);
    }
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }

  log(message: unknown, context?: string) {
    this.writeLine('log', message, context);
  }

  error(message: unknown, stackOrContext?: string, context?: string) {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: 'error',
      context: context ?? (stackOrContext && !stackOrContext.includes('\n') ? stackOrContext : this.context),
      message: typeof message === 'string' ? message : String(message),
    };
    if (stackOrContext && stackOrContext.includes('\n')) {
      entry.stack = stackOrContext;
    }
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }

  warn(message: unknown, context?: string) {
    this.writeLine('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.writeLine('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.writeLine('verbose', message, context);
  }

  /** Structured, fielded log entry - the preferred call shape for new code (request logs, security events, worker diagnostics). */
  logEvent(level: LogLevel, message: string, fields: Record<string, unknown>) {
    this.writeLine(level, message, fields.context as string | undefined, fields);
  }
}

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = REDACT_KEY_PATTERN.test(key) ? '[REDACTED]' : value;
  }
  return result;
}

export type { LoggerService };
