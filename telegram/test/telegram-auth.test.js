import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { authenticateTelegramRequest, resolveDevelopmentAuth, verifyTelegramInitData } from "../src/telegram-auth.js";

const TEST_BOT_TOKEN = "auth-unit-test-token";
const now = Date.parse("2026-09-28T21:00:00.000Z");

function signedData(userId = 7, authDate = Math.floor(now / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify({ id: userId }) });
  const checkString = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TEST_BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
  return params.toString();
}

test("derives the account ID from valid signed Telegram initData", () => {
  assert.deepEqual(verifyTelegramInitData(signedData(12345), TEST_BOT_TOKEN, { now }), { id: 12345 });
});

test("rejects duplicate parameters and malformed signed data", () => {
  assert.throws(() => verifyTelegramInitData(`${signedData()}&auth_date=1`, TEST_BOT_TOKEN, { now }), { code: "INVALID_TELEGRAM_AUTH" });
});

test("rejects data with an invalid signature", () => {
  const params = new URLSearchParams(signedData());
  params.set("user", JSON.stringify({ id: 999 }));
  assert.throws(() => verifyTelegramInitData(params.toString(), TEST_BOT_TOKEN, { now }), { code: "INVALID_TELEGRAM_AUTH" });
});

test("rejects expired and implausibly future authentication dates", () => {
  assert.throws(() => verifyTelegramInitData(signedData(7, Math.floor(now / 1000) - 3601), TEST_BOT_TOKEN, { now }), { code: "EXPIRED_TELEGRAM_AUTH" });
  assert.throws(() => verifyTelegramInitData(signedData(7, Math.floor(now / 1000) + 31), TEST_BOT_TOKEN, { now }), { code: "INVALID_TELEGRAM_AUTH" });
});

test("allows development authentication only when explicitly enabled with loopback configuration", () => {
  assert.equal(resolveDevelopmentAuth({ NODE_ENV: "production", TELEGRAM_DEV_AUTH: "true", TELEGRAM_DEV_USER_ID: "123", HOST: "127.0.0.1" }), null);
  assert.equal(resolveDevelopmentAuth({ NODE_ENV: "development", TELEGRAM_DEV_AUTH: "false", TELEGRAM_DEV_USER_ID: "123", HOST: "127.0.0.1" }), null);
  assert.deepEqual(resolveDevelopmentAuth({ NODE_ENV: "development", TELEGRAM_DEV_AUTH: "true", TELEGRAM_DEV_USER_ID: "123", HOST: "127.0.0.1" }), { userId: 123 });
  assert.throws(() => resolveDevelopmentAuth({ NODE_ENV: "development", TELEGRAM_DEV_AUTH: "true", TELEGRAM_DEV_USER_ID: "123", HOST: "0.0.0.0" }), /loopback/);
});

test("development identity comes from server configuration, never from request data", () => {
  const request = { headers: { "x-telegram-dev-auth": "true", "x-telegram-user-id": "999" } };
  assert.deepEqual(authenticateTelegramRequest(request, { developmentAuth: { userId: 123 } }), { id: 123 });
});
