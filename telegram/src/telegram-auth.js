import { createHmac, timingSafeEqual } from "node:crypto";
import { isVercelRuntime } from "./runtime-config.js";

const MAX_INIT_DATA_LENGTH = 16 * 1024;
const DEFAULT_MAX_AGE_SECONDS = 60 * 60;
const DEFAULT_FUTURE_SKEW_SECONDS = 30;

function authError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Verify Telegram Mini App initData and return only its signed account identity. */
export function verifyTelegramInitData(initData, botToken, {
  now = Date.now(),
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  futureSkewSeconds = DEFAULT_FUTURE_SKEW_SECONDS
} = {}) {
  if (typeof initData !== "string" || initData.length === 0 || initData.length > MAX_INIT_DATA_LENGTH) {
    throw authError("INVALID_TELEGRAM_AUTH", "Telegram authentication data is malformed.");
  }
  if (typeof botToken !== "string" || botToken.length === 0) {
    throw authError("TELEGRAM_AUTH_NOT_CONFIGURED", "Telegram authentication is not configured.");
  }

  const params = new URLSearchParams(initData);
  const entries = [...params.entries()];
  if (entries.length === 0 || entries.some(([key]) => !key) || new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw authError("INVALID_TELEGRAM_AUTH", "Telegram authentication data is malformed.");
  }
  const hash = params.get("hash");
  const authDateRaw = params.get("auth_date");
  const userRaw = params.get("user");
  if (!hash || !/^[a-f\d]{64}$/i.test(hash) || !authDateRaw || !userRaw) {
    throw authError("INVALID_TELEGRAM_AUTH", "Telegram authentication data is malformed.");
  }

  const dataCheckString = entries
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const suppliedHash = Buffer.from(hash, "hex");
  if (suppliedHash.length !== expectedHash.length || !timingSafeEqual(suppliedHash, expectedHash)) {
    throw authError("INVALID_TELEGRAM_AUTH", "Telegram authentication signature is invalid.");
  }

  if (!/^\d+$/.test(authDateRaw)) {
    throw authError("INVALID_TELEGRAM_AUTH", "Telegram authentication data is malformed.");
  }
  const authDate = Number(authDateRaw);
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + futureSkewSeconds) {
    throw authError("INVALID_TELEGRAM_AUTH", "Telegram authentication date is invalid.");
  }
  if (nowSeconds - authDate > maxAgeSeconds) {
    throw authError("EXPIRED_TELEGRAM_AUTH", "Telegram authentication has expired. Reopen the Mini App and try again.");
  }

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw authError("INVALID_TELEGRAM_AUTH", "Telegram authentication data is malformed.");
  }
  if (!user || typeof user !== "object" || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw authError("INVALID_TELEGRAM_AUTH", "Telegram authentication does not contain a valid user.");
  }
  return { id: user.id };
}

/** Local-only identity is server-configured and cannot be selected by the browser. */
export function resolveDevelopmentAuth(env = process.env) {
  // Vercel Functions never receive a synthetic identity, regardless of NODE_ENV,
  // HOST, or any developer-auth flags configured in the deployment environment.
  if (isVercelRuntime(env)) return null;
  const enabled = env.NODE_ENV === "development" && env.TELEGRAM_DEV_AUTH === "true";
  if (!enabled) return null;
  const host = env.HOST || "127.0.0.1";
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(host)) {
    throw new Error("Telegram development authentication requires a loopback HOST.");
  }
  const userId = Number(env.TELEGRAM_DEV_USER_ID);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("TELEGRAM_DEV_USER_ID must be a positive integer when local development authentication is enabled.");
  }
  return { userId };
}

export function authenticateTelegramRequest(request, { botToken, developmentAuth, now } = {}) {
  const initData = request.headers["x-telegram-init-data"];
  const devHeader = request.headers["x-telegram-dev-auth"];

  // A provided initData always takes precedence; malformed real auth never falls back to dev auth.
  if (initData !== undefined) {
    if (Array.isArray(initData)) throw authError("INVALID_TELEGRAM_AUTH", "Telegram authentication data is malformed.");
    return verifyTelegramInitData(initData, botToken, { now });
  }
  if (devHeader === "true" && developmentAuth) return { id: developmentAuth.userId };
  if (devHeader !== undefined) throw authError("INVALID_TELEGRAM_AUTH", "Telegram authentication data is malformed.");
  throw authError("TELEGRAM_AUTH_REQUIRED", "Open this form in Telegram to authenticate.");
}
