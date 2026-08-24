type RuntimeEnvironment = Record<string, string | undefined>;

export type RuntimeConfigIssue = {
  key: string;
  message: string;
};

const MINIMUM_SECRET_BYTES = 32;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function requireValue(
  env: RuntimeEnvironment,
  key: string,
  issues: RuntimeConfigIssue[]
): string | undefined {
  const value = env[key]?.trim();
  if (!value) {
    issues.push({ key, message: "is required" });
    return undefined;
  }
  return value;
}

function requireUrl(
  env: RuntimeEnvironment,
  key: string,
  issues: RuntimeConfigIssue[]
): void {
  const value = requireValue(env, key, issues);
  if (!value) return;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    issues.push({ key, message: "must be a valid HTTP(S) URL" });
  }
}

/** Validate only configuration needed for the server to operate safely. */
export function validateRuntimeConfig(
  env: RuntimeEnvironment = process.env
): RuntimeConfigIssue[] {
  const issues: RuntimeConfigIssue[] = [];

  requireValue(env, "SUPABASE_DATABASE_URL", issues);
  requireValue(env, "GOOGLE_CLIENT_ID", issues);
  requireValue(env, "GOOGLE_CLIENT_SECRET", issues);
  requireUrl(env, "BUILT_IN_FORGE_API_URL", issues);
  requireValue(env, "BUILT_IN_FORGE_API_KEY", issues);

  const jwtSecret = requireValue(env, "JWT_SECRET", issues);
  if (jwtSecret && byteLength(jwtSecret) < MINIMUM_SECRET_BYTES) {
    issues.push({
      key: "JWT_SECRET",
      message: `must contain at least ${MINIMUM_SECRET_BYTES} bytes`,
    });
  }

  if (env.TURATH_PRICING_ENABLED === "true") {
    requireValue(env, "STRIPE_SECRET_KEY", issues);
    requireValue(env, "STRIPE_WEBHOOK_SECRET", issues);
  }

  return issues;
}

export function assertRuntimeConfig(
  env: RuntimeEnvironment = process.env
): RuntimeConfigIssue[] {
  const issues = validateRuntimeConfig(env);
  if (issues.length > 0 && env.NODE_ENV === "production") {
    const summary = issues
      .map(issue => `${issue.key} ${issue.message}`)
      .join("; ");
    throw new Error(`Unsafe production configuration: ${summary}`);
  }
  return issues;
}
