const score = { type: ["number", "null"], minimum: 0, maximum: 10 };
const distance = { type: ["number", "null"], minimum: 0 };

/** JSON Schema for a daily check-in. Null training score and distance mean rest day. */
export const checkInSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "DailyCheckIn",
  type: "object",
  additionalProperties: false,
  required: [
    "date", "diet_score", "swim_score", "swim_distance_m",
    "bike_score", "bike_distance_km", "run_score", "run_distance_km",
    "social_score", "work_score", "sleep_score", "sleep_duration_minutes",
    "money_in", "money_spent", "unnecessary_spending", "happiness",
    "hrv_ms", "rhr_bpm", "weight_kg"
  ],
  properties: {
    date: { type: "string", format: "date" },
    diet_score: { type: "number", minimum: 0, maximum: 10 },
    swim_score: score,
    swim_distance_m: distance,
    bike_score: score,
    bike_distance_km: distance,
    run_score: score,
    run_distance_km: distance,
    social_score: { type: "number", minimum: 0, maximum: 10 },
    work_score: { type: "number", minimum: 0, maximum: 10 },
    sleep_score: { type: "number", minimum: 0, maximum: 100 },
    sleep_duration_minutes: { type: "integer", minimum: 0, maximum: 1440 },
    money_in: { type: "number", minimum: 0 },
    money_spent: { type: "number", minimum: 0 },
    unnecessary_spending: { type: "number", minimum: 0 },
    happiness: { type: "number", minimum: 0, maximum: 10 },
    hrv_ms: { type: "number", minimum: 0, maximum: 1000 },
    rhr_bpm: { type: "number", minimum: 20, maximum: 250 },
    weight_kg: { type: "number", exclusiveMinimum: 0, maximum: 500 }
  }
};
