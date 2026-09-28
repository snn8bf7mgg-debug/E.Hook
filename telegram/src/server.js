import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createSupabaseClient } from "./supabase-client.js";
import { SupabaseCheckInRepository } from "./supabase-checkin-repository.js";
import { isValidCheckInDate, validateCheckIn } from "./validate-checkin.js";
import { authenticateTelegramRequest, resolveDevelopmentAuth } from "./telegram-auth.js";
import { assertRuntimeConfiguration } from "./runtime-config.js";

const maxBodyBytes = 64 * 1024;

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  // Vercel's Node function adapter may expose a parsed request.body rather than
  // leaving the original IncomingMessage stream available to iterate.
  let parsedBody;
  try {
    parsedBody = request.body;
  } catch {
    throw Object.assign(new Error("Request body must contain valid JSON."), { status: 400 });
  }
  if (parsedBody !== undefined) {
    const serialized = Buffer.isBuffer(parsedBody) ? parsedBody : Buffer.from(typeof parsedBody === "string" ? parsedBody : JSON.stringify(parsedBody));
    if (serialized.length > maxBodyBytes) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    if (Buffer.isBuffer(parsedBody) || typeof parsedBody === "string") {
      try {
        return JSON.parse(serialized.toString("utf8"));
      } catch {
        throw Object.assign(new Error("Request body must contain valid JSON."), { status: 400 });
      }
    }
    return parsedBody;
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must contain valid JSON."), { status: 400 });
  }
}

function databaseUnavailable(response) {
  return sendJson(response, 503, { error: "The check-in database is temporarily unavailable." });
}

export function createRequestHandler({ repository, telegramBotToken, developmentAuth = null, now }) {
  if (!repository || typeof repository.insert !== "function" || typeof repository.findByDate !== "function") {
    throw new TypeError("A check-in repository with insert and findByDate methods is required.");
  }

  return async function handleRequest(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
      return sendJson(response, 200, { status: "ok", storage: "supabase" });
    }

    if (request.method === "GET" && url.pathname === "/api/check-ins") {
      let telegramUser;
      try {
        telegramUser = authenticateTelegramRequest(request, { botToken: telegramBotToken, developmentAuth, now });
      } catch (error) {
        const status = error.code === "TELEGRAM_AUTH_NOT_CONFIGURED" ? 503 : 401;
        return sendJson(response, status, { error: error.message, code: error.code });
      }
      const dates = url.searchParams.getAll("date");
      if (dates.length !== 1 || !isValidCheckInDate(dates[0])) {
        return sendJson(response, 400, { error: "A single date query parameter in YYYY-MM-DD format is required." });
      }
      try {
        const { data, error } = await repository.findByDate(dates[0], telegramUser.id);
        if (error) return databaseUnavailable(response);
        if (!data) return sendJson(response, 404, { error: "No check-in exists for that date.", date: dates[0] });
        return sendJson(response, 200, { checkIn: data });
      } catch {
        return databaseUnavailable(response);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/check-ins") {
      let telegramUser;
      try {
        telegramUser = authenticateTelegramRequest(request, { botToken: telegramBotToken, developmentAuth, now });
      } catch (error) {
        const status = error.code === "TELEGRAM_AUTH_NOT_CONFIGURED" ? 503 : 401;
        return sendJson(response, status, { error: error.message, code: error.code });
      }
      if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
        return sendJson(response, 415, { error: "Content-Type must be application/json." });
      }

      let input;
      try {
        input = await readJson(request);
      } catch (error) {
        return sendJson(response, error.status || 400, { error: error.message });
      }
      const validation = validateCheckIn(input);
      if (!validation.valid) return sendJson(response, 422, { error: "Invalid check-in.", details: validation.errors });

      try {
        const { data, error } = await repository.insert(validation.value, telegramUser.id);
        if (error?.code === "23505") {
          return sendJson(response, 409, {
            error: "A check-in already exists for this date.",
            code: "CHECK_IN_EXISTS",
            date: validation.value.date
          });
        }
        if (error || !data) return databaseUnavailable(response);
        return sendJson(response, 201, { status: "stored", stored: true, checkIn: data });
      } catch {
        return databaseUnavailable(response);
      }
    }

    return sendJson(response, 404, { error: "Not found." });
  };
}

/** Local HTTP server wrapper; Vercel Functions call createRequestHandler directly. */
export function createApiServer(options) {
  const handleRequest = createRequestHandler(options);
  return createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      try {
        const html = await readFile(new URL("../web/index.html", import.meta.url));
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        });
        return response.end(html);
      } catch {
        return sendJson(response, 500, { error: "Mini App entry point is unavailable." });
      }
    }
    return handleRequest(request, response);
  });
}

export function startServer({ env = process.env } = {}) {
  assertRuntimeConfiguration(env);
  const client = createSupabaseClient(env);
  const repository = new SupabaseCheckInRepository(client);
  const api = createApiServer({
    repository,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    developmentAuth: resolveDevelopmentAuth(env)
  });
  api.on("error", () => {
    console.error("The check-in API could not bind to its configured address.");
    process.exitCode = 1;
  });
  api.listen(Number(env.PORT || 8787), env.HOST || "127.0.0.1", () => {
    console.log(`Check-in API listening on http://${env.HOST || "127.0.0.1"}:${Number(env.PORT || 8787)}`);
  });
  return api;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    startServer();
  } catch {
    console.error("Unable to initialize the check-in API. Verify the required server environment configuration.");
    process.exitCode = 1;
  }
}
