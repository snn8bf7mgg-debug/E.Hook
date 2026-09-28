import test from "node:test";
import assert from "node:assert/strict";
import { validateCheckIn } from "../src/validate-checkin.js";

const valid = {
  date: "2026-09-28",
  diet_score: 7.5,
  swim_score: null,
  swim_distance_m: null,
  bike_score: 8,
  bike_distance_km: 25.4,
  run_score: 6,
  run_distance_km: 5,
  social_score: 7,
  work_score: 8,
  sleep_score: 82,
  sleep_duration_minutes: 465,
  money_in: 100.25,
  money_spent: 32.5,
  unnecessary_spending: 5,
  happiness: 7,
  hrv_ms: 54,
  rhr_bpm: 58,
  weight_kg: 72.4
};

test("accepts a complete check-in with a rest day", () => {
  const result = validateCheckIn(valid);
  assert.equal(result.valid, true, result.errors.join(" "));
  assert.equal(result.value.swim_score, null);
});

test("rejects scores outside their range", () => {
  const result = validateCheckIn({ ...valid, diet_score: 11 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("diet_score")));
});

test("rejects partial rest-day values", () => {
  const result = validateCheckIn({ ...valid, swim_distance_m: 20 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("both be null")));
});

test("rejects invalid calendar dates and unknown fields", () => {
  const result = validateCheckIn({ ...valid, date: "2026-02-30", telegram_id: "secret" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("real calendar date")));
  assert.ok(result.errors.some((error) => error.includes("Unknown field")));
});

test("rejects missing, non-finite, and unit/range-invalid values", () => {
  const { diet_score, ...missing } = valid;
  assert.ok(validateCheckIn(missing).errors.some((error) => error.includes("Missing required field: diet_score")));
  assert.equal(validateCheckIn({ ...valid, hrv_ms: Infinity }).valid, false);
  assert.equal(validateCheckIn({ ...valid, sleep_duration_minutes: 1441 }).valid, false);
  assert.equal(validateCheckIn({ ...valid, rhr_bpm: 10 }).valid, false);
});
