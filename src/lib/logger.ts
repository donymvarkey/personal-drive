/**
 * Production-hardened structured logger.
 * Automatically sanitizes and redacts sensitive data (passwords, auth tokens, secrets)
 * before emitting to stdout/stderr.
 */

const SENSITIVE_KEYS = new Set([
  "password",
  "currentpassword",
  "newpassword",
  "hashedpassword",
  "token",
  "secret",
  "auth_secret",
  "authorization",
  "cookie",
  "session",
]);

function sanitizeValue(key: string, value: unknown): unknown {
  if (typeof key === "string" && SENSITIVE_KEYS.has(key.toLowerCase())) {
    return "[REDACTED]";
  }
  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(key, item));
    }
    const cleanObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      cleanObj[k] = sanitizeValue(k, v);
    }
    return cleanObj;
  }
  return value;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

class AppLogger {
  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const sanitizedMeta = meta ? sanitizeValue("meta", meta) : undefined;
    const logObj = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...(sanitizedMeta ? { meta: sanitizedMeta } : {}),
    };
    return JSON.stringify(logObj);
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    console.log(this.formatMessage("info", message, meta));
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(this.formatMessage("warn", message, meta));
  }

  public error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    const errorDetails = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error;
    console.error(this.formatMessage("error", message, { ...meta, error: errorDetails }));
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== "production") {
      console.debug(this.formatMessage("debug", message, meta));
    }
  }
}

export const logger = new AppLogger();
