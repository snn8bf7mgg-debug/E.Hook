import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import checkInsDefault, { createCheckInsHandler } from "../api/check-ins.js";
import healthDefault, { createHealthHandler } from "../api/health.js";
import { assertRuntimeConfiguration } from "../src/runtime-config.js";
import { resolveDevelopmentAuth } from "../src/telegram-auth.js";

const TEST_TOKEN = "vercel-handler-test-token";
const vercelEnv = {
  VERCEL_ENV: "preview",
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  TELEGRAM_DEV_AUTH: "true",
  TELEGRAM_DEV_USER_ID: "87654321",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-service-role-key",
  TELEGRAM_BOT_TOKEN: TEST_TOKEN
};

function signedInitData(userId) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: "Function test" })
  });
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TEST_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheck).digest("hex"));
  return params.toString();
}

function validPayload(date) {
  return {
    date,
    diet_score: 7,
    swim_score: null,
    swim_distance_m: null,
    bike_score: 7,
    bike_distance_km: 12,
    run_score: null,
    run_distance_km: null,
    social_score: 6,
    work_score: 8,
    sleep_score: 80,
    sleep_duration_minutes: 440,
    money_in: 0,
    money_spent: 0,
    unnecessary_spending: 0,
    happiness: 7,
    hrv_ms: 50,
    rhr_bpm: 60,
    weight_kg: 72
  };
}

async function withServer(handler, callback, { parsedBody = false } = {}) {
  const server = createServer((request, response) => {
    if (parsedBody && request.method === "POST") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        request.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        handler(request, response);
      });
      return;
    }
    handler(request, response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("production and Vercel runtimes require all server environment variables", () => {
  assert.throws(
    () => assertRuntimeConfiguration({ NODE_ENV: "production" }),
    (error) => {
      assert.match(error.message, /SUPABASE_URL/);
      assert.match(error.message, /SUPABASE_SERVICE_ROLE_KEY/);
      assert.match(error.message, /TELEGRAM_BOT_TOKEN/);
      assert.doesNotMatch(error.message, /https?:|synthetic|secret|eyJ/);
      return true;
    }
  );
  assert.throws(() => assertRuntimeConfiguration({ VERCEL_ENV: "preview" }), /TELEGRAM_BOT_TOKEN/);
  assert.doesNotThrow(() => assertRuntimeConfiguration(vercelEnv, { forceVercel: true }));
});

test("development authentication is disabled for Vercel preview and production markers", () => {
  assert.equal(resolveDevelopmentAuth(vercelEnv), null);
  assert.equal(resolveDevelopmentAuth({ ...vercelEnv, VERCEL_ENV: "production" }), null);
  assert.equal(resolveDevelopmentAuth({ ...vercelEnv, VERCEL_ENV: undefined, VERCEL: "1" }), null);
  assert.equal(resolveDevelopmentAuth({ ...vercelEnv, VERCEL_ENV: undefined, VERCEL: undefined, VERCEL_TARGET_ENV: "staging" }), null);
});

test("Vercel check-in handler requires verified auth even when dev flags are set", async () => {
  const rows = new Map();
  let inserts = 0;
  const repository = {
    async insert(checkIn, telegramUserId) {
      inserts += 1;
      const key = `${telegramUserId}:${checkIn.date}`;
      if (rows.has(key)) return { data: null, error: { code: "23505" } };
      const data = { ...checkIn, telegram_user_id: telegramUserId, id: `vercel-${telegramUserId}` };
      rows.set(key, data);
      return { data, error: null };
    },
    async findByDate(date, telegramUserId) {
      return { data: rows.get(`${telegramUserId}:${date}`) || null, error: null };
    }
  };
  const handler = createCheckInsHandler({ env: vercelEnv, repository });
  assert.equal(typeof checkInsDefault, "function");

  await withServer(handler, async (baseUrl) => {
    const noAuth = await fetch(`${baseUrl}/api/check-ins`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-dev-auth": "true" },
      body: JSON.stringify(validPayload("2099-12-01"))
    });
    assert.equal(noAuth.status, 401);
    assert.equal(inserts, 0);

    const payload = validPayload("2099-12-01");
    const headers = { "content-type": "application/json", "x-telegram-init-data": signedInitData(424242) };
    const inserted = await fetch(`${baseUrl}/api/check-ins`, { method: "POST", headers, body: JSON.stringify(payload) });
    assert.equal(inserted.status, 201);
    const insertedBody = await inserted.json();
    assert.equal(insertedBody.stored, true);
    assert.equal(insertedBody.checkIn.telegram_user_id, 424242);

    const retrieved = await fetch(`${baseUrl}/api/check-ins?date=2099-12-01`, { headers: { "x-telegram-init-data": signedInitData(424242) } });
    assert.equal(retrieved.status, 200);
    assert.equal((await retrieved.json()).checkIn.weight_kg, payload.weight_kg);
  }, { parsedBody: true });
});

test("Vercel health handler serves /api/health without opening a local listener", async () => {
  const repository = { async insert() {}, async findByDate() {} };
  const handler = createHealthHandler({ env: vercelEnv, repository });
  assert.equal(typeof healthDefault, "function");
  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", storage: "supabase" });
    const legacyPath = await fetch(`${baseUrl}/health`);
    assert.equal(legacyPath.status, 200);
  });
});

test("Vercel config serves the Mini App from web root and keeps relative API paths", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(config.outputDirectory, "web");
  assert.ok(config.rewrites.some((rewrite) => rewrite.source === "/health" && rewrite.destination === "/api/health"));
  assert.match(html, /meta name="api-base" content=""/);
  assert.match(html, /fetch\(`\$\{apiBase\}\/api\/check-ins`/);
  assert.equal(packageJson.engines.node, "22.x");
});
