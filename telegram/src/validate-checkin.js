import { checkInSchema } from "./checkin-schema.js";

const fields = checkInSchema.required;
const properties = checkInSchema.properties;
const trainingPairs = [
  ["swim_score", "swim_distance_m"],
  ["bike_score", "bike_distance_km"],
  ["run_score", "run_distance_km"]
];

export function isValidCheckInDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/** Returns { valid, errors, value }; training score+distance may both be null for rest. */
export function validateCheckIn(input) {
  const errors = [];
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Check-in must be a JSON object."], value: null };
  }

  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(properties, key)) errors.push(`Unknown field: ${key}.`);
  }
  for (const key of fields) {
    if (!Object.hasOwn(input, key)) errors.push(`Missing required field: ${key}.`);
  }

  for (const [key, rule] of Object.entries(properties)) {
    if (!Object.hasOwn(input, key)) continue;
    const value = input[key];
    if (key === "date") {
      if (typeof value !== "string" || !isValidCheckInDate(value)) errors.push("date must be a real calendar date in YYYY-MM-DD format.");
      continue;
    }
    const acceptsNull = Array.isArray(rule.type) && rule.type.includes("null");
    if (value === null && acceptsNull) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${key} must be a finite number${acceptsNull ? " or null" : ""}.`);
      continue;
    }
    if (rule.type === "integer" && !Number.isInteger(value)) errors.push(`${key} must be an integer.`);
    if (Object.hasOwn(rule, "minimum") && value < rule.minimum) errors.push(`${key} must be at least ${rule.minimum}.`);
    if (Object.hasOwn(rule, "maximum") && value > rule.maximum) errors.push(`${key} must be at most ${rule.maximum}.`);
    if (Object.hasOwn(rule, "exclusiveMinimum") && value <= rule.exclusiveMinimum) errors.push(`${key} must be greater than ${rule.exclusiveMinimum}.`);
  }

  for (const [scoreField, distanceField] of trainingPairs) {
    if (Object.hasOwn(input, scoreField) && Object.hasOwn(input, distanceField)) {
      if ((input[scoreField] === null) !== (input[distanceField] === null)) {
        errors.push(`${scoreField} and ${distanceField} must both be null for a rest day, or both have values for a completed session.`);
      }
    }
  }

  return { valid: errors.length === 0, errors, value: errors.length === 0 ? { ...input } : null };
}
