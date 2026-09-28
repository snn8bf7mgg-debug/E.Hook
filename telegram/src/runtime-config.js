const VERCEL_REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN"];

export function isVercelRuntime(env = process.env) {
  return env.VERCEL === "1" || Boolean(env.VERCEL_ENV) || Boolean(env.VERCEL_TARGET_ENV);
}

/** Validate server configuration without including any environment values in errors. */
export function assertRuntimeConfiguration(env = process.env, { forceVercel = false } = {}) {
  if (env.NODE_ENV !== "production" && !isVercelRuntime(env) && !forceVercel) return;
  const missing = VERCEL_REQUIRED_ENV.filter((key) => typeof env[key] !== "string" || env[key].trim() === "");
  if (missing.length) throw new Error(`Missing required server environment variable(s): ${missing.join(", ")}.`);
}

export const vercelRequiredEnvironmentVariables = Object.freeze([...VERCEL_REQUIRED_ENV]);
