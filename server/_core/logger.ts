type LogLevel = "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

export function logEvent(
  level: LogLevel,
  event: string,
  context: LogContext = {}
): void {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
  });

  if (level === "error") {
    console.error(record);
  } else if (level === "warn") {
    console.warn(record);
  } else {
    console.log(record);
  }
}
