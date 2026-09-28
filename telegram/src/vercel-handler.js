import { createSupabaseClient } from "./supabase-client.js";
import { SupabaseCheckInRepository } from "./supabase-checkin-repository.js";
import { createRequestHandler } from "./server.js";
import { assertRuntimeConfiguration } from "./runtime-config.js";

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

/** Creates a Vercel Node.js function handler without opening a listening server. */
export function createVercelRouteHandler(route, { env = process.env, repository } = {}) {
  if (!new Set(["check-ins", "health"]).has(route)) throw new TypeError("Unknown Vercel route.");
  // Vercel routes require all server credentials even if a test injects a repository.
  assertRuntimeConfiguration(env, { forceVercel: true });
  const checkInRepository = repository || new SupabaseCheckInRepository(createSupabaseClient(env));
  const handleRequest = createRequestHandler({
    repository: checkInRepository,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    developmentAuth: null
  });
  const expectedPaths = route === "health" ? new Set(["/api/health", "/health"]) : new Set(["/api/check-ins"]);

  return (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (!expectedPaths.has(url.pathname)) return json(response, 404, { error: "Not found." });
    return handleRequest(request, response);
  };
}

/** Lazily initializes server-only dependencies on first invocation in a function instance. */
export function createLazyVercelRouteHandler(route) {
  let handler;
  return (request, response) => {
    try {
      handler ||= createVercelRouteHandler(route);
      return handler(request, response);
    } catch {
      return json(response, 503, { error: "The server is not configured for this request." });
    }
  };
}
