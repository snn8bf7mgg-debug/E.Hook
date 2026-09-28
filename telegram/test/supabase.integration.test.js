import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseClient } from "../src/supabase-client.js";
import { SupabaseCheckInRepository } from "../src/supabase-checkin-repository.js";

const requiredEnvironment = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);
const testTelegramUserId = 900000000000001;
const enabled = process.env.RUN_SUPABASE_INTEGRATION === "1" && missingEnvironment.length === 0;
const skipReason = process.env.RUN_SUPABASE_INTEGRATION !== "1"
  ? "Opt-in only: set RUN_SUPABASE_INTEGRATION=1 and Supabase environment variables to run against a live project."
  : `Requires Supabase environment variables: ${missingEnvironment.join(", ")}.`;

test("Supabase live insert, duplicate conflict, retrieval, and cleanup", { skip: enabled ? false : skipReason }, async (t) => {
  const client = createSupabaseClient();
  const repository = new SupabaseCheckInRepository(client);
  let date;

  // Find a currently unused, reserved future date. Never overwrite a real record.
  for (let day = 1; day <= 28; day += 1) {
    const candidate = `2099-11-${String(day).padStart(2, "0")}`;
    const { data, error } = await repository.findByDate(candidate, testTelegramUserId);
    assert.ifError(error);
    if (!data) {
      date = candidate;
      break;
    }
  }
  if (!date) return t.skip("No unused reserved test date is available in November 2099.");

  const row = {
    date,
    diet_score: 7,
    swim_score: null,
    swim_distance_m: null,
    bike_score: 7,
    bike_distance_km: 10,
    run_score: null,
    run_distance_km: null,
    social_score: 5,
    work_score: 7,
    sleep_score: 80,
    sleep_duration_minutes: 420,
    money_in: 0,
    money_spent: 0,
    unnecessary_spending: 0,
    happiness: 7,
    hrv_ms: 45,
    rhr_bpm: 60,
    weight_kg: 70
  };

  try {
    const inserted = await repository.insert(row, testTelegramUserId);
    assert.ifError(inserted.error);
    assert.equal(inserted.data.date, date);
    assert.ok(inserted.data.id);

    const duplicate = await repository.insert(row, testTelegramUserId);
    assert.equal(duplicate.error?.code, "23505");

    const found = await repository.findByDate(date, testTelegramUserId);
    assert.ifError(found.error);
    assert.equal(found.data.id, inserted.data.id);
    assert.equal(found.data.swim_score, null);
    assert.equal(found.data.swim_distance_m, null);
  } finally {
    await client.from("daily_check_ins").delete().eq("date", date).eq("telegram_user_id", testTelegramUserId);
  }
});
