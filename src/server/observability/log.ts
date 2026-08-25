export type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "authorization",
  "cookie",
  "setcookie",
  "secret",
  "accesskey",
  "secretaccesskey",
  "devicetoken",
]);

function normalizeKey(key: string) {
  return key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[max-depth]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: process.env["NODE_ENV"] === "production" ? undefined : value.stack,
    };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEYS.has(normalizeKey(key))
        ? "[redacted]"
        : sanitize(item, depth + 1);
    }
    return output;
  }
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

function sanitizeFields(fields: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    output[key] = SENSITIVE_KEYS.has(normalizeKey(key))
      ? "[redacted]"
      : sanitize(value, 1);
  }
  return output;
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...sanitizeFields(fields),
  });

  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}
