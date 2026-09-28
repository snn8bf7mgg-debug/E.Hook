import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseClient } from "../src/supabase-client.js";

test("requires server-side Supabase environment variables without revealing values", () => {
  assert.throws(
    () => createSupabaseClient({}),
    (error) => {
      assert.match(error.message, /SUPABASE_URL/);
      assert.match(error.message, /SUPABASE_SERVICE_ROLE_KEY/);
      assert.doesNotMatch(error.message, /https?:|secret|eyJ/);
      return true;
    }
  );
});
