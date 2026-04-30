/**
 * Unified Logger System
 *
 * A centralized logging utility that:
 * - Provides consistent log formatting
 * - Supports different log levels
 * - Can be silenced in production
 * - Supports structured logging with context
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

interface LoggerOptions {
  /** Minimum level to output (default: 'debug' in dev, 'warn' in prod) */
  minLevel?: LogLevel;
  /** Prefix for all log messages */
  prefix?: string;
  /** Whether to include timestamps */
  timestamps?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Check if we're in development mode
const isDev = process.env.NODE_ENV === "development";

// Default minimum level based on environment
const DEFAULT_MIN_LEVEL: LogLevel = isDev ? "debug" : "warn";

class Logger {
  private minLevel: LogLevel;
  private prefix: string;
  private timestamps: boolean;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? DEFAULT_MIN_LEVEL;
    this.prefix = options.prefix ?? "";
    this.timestamps = options.timestamps ?? isDev;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const parts: string[] = [];

    if (this.timestamps) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    parts.push(`[${level.toUpperCase()}]`);

    if (this.prefix) {
      parts.push(`[${this.prefix}]`);
    }

    parts.push(message);

    if (context && Object.keys(context).length > 0) {
      parts.push(JSON.stringify(context));
    }

    return parts.join(" ");
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, context));
    }
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    if (this.shouldLog("error")) {
      const errorContext =
        error instanceof Error
          ? { ...context, errorName: error.name, errorMessage: error.message }
          : { ...context, error };

      console.error(this.formatMessage("error", message, errorContext));

      // In development, also log the full stack trace
      if (isDev && error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
  }

  /**
   * Create a child logger with a specific prefix
   */
  child(prefix: string): Logger {
    const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new Logger({
      minLevel: this.minLevel,
      prefix: childPrefix,
      timestamps: this.timestamps,
    });
  }
}

// Default logger instance
export const logger = new Logger();

// Pre-configured loggers for different modules
export const storeLogger = logger.child("Store");
export const apiLogger = logger.child("API");
export const editorLogger = logger.child("Editor");

// Factory function for creating custom loggers
export function createLogger(prefix: string, options?: Omit<LoggerOptions, "prefix">): Logger {
  return new Logger({ ...options, prefix });
}

export { Logger };
export type { LogLevel, LogContext, LoggerOptions };
