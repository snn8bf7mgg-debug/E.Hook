import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createApiServer } from "../src/server.js";

const TEST_BOT_TOKEN = "unit-test-token-never-used-outside-this-suite";
const NOW = Date.parse("2026-09-28T21:00:00.000Z");
const records = new Map();
let baseUrl;
let insertFailure = null;
let retrievalFailure = null;
let insertCount = 0;

const repository = {
  async insert(checkIn, telegramUserId) {
    insertCount += 1;
    if (insertFailure) return { data: null, error: insertFailure };
    const key = `${telegramUserId}:${checkIn.date}`;
    if (records.has(key)) return { data: null, error: { code: "23505" } };
    const data = {
      ...checkIn,
      telegram_user_id: telegramUserId,
      id: `mock-${telegramUserId}-${checkIn.date}`,
      created_at: "2026-09-28T20:00:00.000Z",
      updated_at: "2026-09-28T20:00:00.000Z"
    };
    records.set(key, data);
    return { data, error: null };
  },
  async findByDate(date, telegramUserId) {
    if (retrievalFailure) return { data: null, error: retrievalFailure };
    return { data: records.get(`${telegramUserId}:${date}`) || null, error: null };
  }
};

const server = createApiServer({ repository, telegramBotToken: TEST_BOT_TOKEN, now: NOW });

before(async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  records.clear();
  insertFailure = null;
  retrievalFailure = null;
  insertCount = 0;
});
after(async () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

function sample(rest = [], date = "2026-09-28") {
  const data = {
    date, diet_score: 7.5, swim_score: 8, swim_distance_m: 1200,
    bike_score: 7, bike_distance_km: 22.4, run_score: 6, run_distance_km: 5.2,
    social_score: 7, work_score: 8, sleep_score: 82, sleep_duration_minutes: 465,
    money_in: 100.25, money_spent: 32.5, unnecessary_spending: 5,
    happiness: 7, hrv_ms: 54, rhr_bpm: 58, weight_kg: 72.4
  };
  for (const activity of rest) {
    data[`${activity}_score`] = null;
    data[`${activity}_distance_${activity === "swim" ? "m" : "km"}`] = null;
  }
  return data;
}

function initData(userId, { authDate = Math.floor(NOW / 1000), invalidSignature = false } = {}) {
  const values = new URLSearchParams({
    auth_date: String(authDate),
    query_id: `query-${userId}`,
    user: JSON.stringify({ id: userId, first_name: "Test" })
  });
  const dataCheckString = [...values.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(TEST_BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  values.set("hash", invalidSignature ? "0".repeat(64) : hash);
  return values.toString();
}

function telegramHeaders(userId, options) {
  return { "x-telegram-init-data": initData(userId, options) };
}
async function postCheckIn(data, headers = telegramHeaders(10001)) {
  return fetch(`${baseUrl}/api/check-ins`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(data)
  });
}

test("serves the Mini App from the API origin", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Daily check-in/);
});

test("accepts valid Telegram initData and derives the stored user identity", async () => {
  const response = await postCheckIn(sample());
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.stored, true);
  assert.equal(body.checkIn.telegram_user_id, 10001);
  assert.equal(body.checkIn.date, "2026-09-28");
});

test("local development auth uses only the server-configured synthetic account", async () => {
  const localServer = createApiServer({ repository, developmentAuth: { userId: 30003 }, now: NOW });
  await new Promise((resolve, reject) => {
    localServer.once("error", reject);
    localServer.listen(0, "127.0.0.1", resolve);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${localServer.address().port}/api/check-ins`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-dev-auth": "true", "x-telegram-user-id": "99999" },
      body: JSON.stringify(sample())
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).checkIn.telegram_user_id, 30003);
  } finally {
    await new Promise((resolve, reject) => localServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("rejects missing Telegram authentication", async () => {
  const response = await postCheckIn(sample(), {});
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "TELEGRAM_AUTH_REQUIRED");
  assert.equal(insertCount, 0);
});

test("rejects invalid Telegram signatures", async () => {
  const response = await postCheckIn(sample(), telegramHeaders(10001, { invalidSignature: true }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "INVALID_TELEGRAM_AUTH");
  assert.equal(insertCount, 0);
});

test("rejects malformed initData and an independently supplied user ID", async () => {
  const malformed = await postCheckIn(sample(), { "x-telegram-init-data": "not-init-data" });
  assert.equal(malformed.status, 401);
  const spoofed = await postCheckIn({ ...sample(), telegram_user_id: 10002 });
  assert.equal(spoofed.status, 422);
  assert.equal(insertCount, 0);
});

test("rejects expired Telegram authentication", async () => {
  const response = await postCheckIn(sample(), telegramHeaders(10001, { authDate: Math.floor(NOW / 1000) - 3601 }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "EXPIRED_TELEGRAM_AUTH");
  assert.equal(insertCount, 0);
});

test("retrieves records only for the authenticated Telegram user", async () => {
  await postCheckIn(sample(), telegramHeaders(10001));
  const own = await fetch(`${baseUrl}/api/check-ins?date=2026-09-28`, { headers: telegramHeaders(10001) });
  assert.equal(own.status, 200);
  assert.equal((await own.json()).checkIn.telegram_user_id, 10001);
  const other = await fetch(`${baseUrl}/api/check-ins?date=2026-09-28`, { headers: telegramHeaders(10002) });
  assert.equal(other.status, 404);
});

test("returns a conflict for a duplicate date belonging to the same user", async () => {
  await postCheckIn(sample(), telegramHeaders(10001));
  const response = await postCheckIn(sample(), telegramHeaders(10001));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "CHECK_IN_EXISTS");
});

test("allows different Telegram users to check in on the same date", async () => {
  assert.equal((await postCheckIn(sample(), telegramHeaders(10001))).status, 201);
  assert.equal((await postCheckIn(sample(), telegramHeaders(10002))).status, 201);
  assert.equal(records.size, 2);
});

test("accepts rest-day entries for an authenticated user", async () => {
  const response = await postCheckIn(sample(["swim", "bike", "run"]));
  assert.equal(response.status, 201);
  const row = (await response.json()).checkIn;
  assert.equal(row.swim_score, null);
  assert.equal(row.bike_distance_km, null);
  assert.equal(row.run_score, null);
});

test("rejects invalid payloads before database access", async () => {
  const response = await postCheckIn({ ...sample(), diet_score: 10.1 });
  assert.equal(response.status, 422);
  assert.match((await response.json()).details.join(" "), /diet_score/);
  assert.equal(insertCount, 0);
});

test("protects query validation and missing records behind authentication", async () => {
  const missingAuth = await fetch(`${baseUrl}/api/check-ins?date=2026-09-29`);
  assert.equal(missingAuth.status, 401);
  const missing = await fetch(`${baseUrl}/api/check-ins?date=2026-09-29`, { headers: telegramHeaders(10001) });
  assert.equal(missing.status, 404);
  const invalid = await fetch(`${baseUrl}/api/check-ins?date=2026-02-30`, { headers: telegramHeaders(10001) });
  assert.equal(invalid.status, 400);
});

test("maps database duplicate and failure errors without exposing database details", async () => {
  insertFailure = { code: "23505", message: "private database detail" };
  const duplicate = await postCheckIn(sample());
  assert.equal(duplicate.status, 409);
  insertFailure = { code: "XX000", message: "sensitive connection detail" };
  const failed = await postCheckIn(sample());
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "The check-in database is temporarily unavailable." });
  retrievalFailure = { code: "XX000", message: "sensitive connection detail" };
  const getFailed = await fetch(`${baseUrl}/api/check-ins?date=2026-09-28`, { headers: telegramHeaders(10001) });
  assert.equal(getFailed.status, 503);
});
