import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { logEvent } from "./server/observability/log";
import { withSecurityHeaders } from "./server/security/headers";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

async function normalizeCatastrophicSsrResponse(
  response: Response,
  requestId: string,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const error = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  logEvent("error", "server.ssr_catastrophic", { requestId, error });
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function harden(response: Response, requestId: string) {
  const hardened = withSecurityHeaders(response, {
    production: process.env["NODE_ENV"] === "production",
  });
  const headers = new Headers(hardened.headers);
  headers.set("x-request-id", requestId);
  return new Response(hardened.body, {
    status: hardened.status,
    statusText: hardened.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const requestId = request.headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
    const started = Date.now();
    let status = 500;

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response, requestId);
      status = normalized.status;
      return harden(normalized, requestId);
    } catch (error) {
      logEvent("error", "server.unhandled_exception", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        error,
      });
      status = 500;
      return harden(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        requestId,
      );
    } finally {
      const durationMs = Date.now() - started;
      if (status >= 500) {
        logEvent("error", "http.request", {
          requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          status,
          durationMs,
        });
      } else if (durationMs >= 2_500) {
        logEvent("warn", "http.slow_request", {
          requestId,
          method: request.method,
          path: new URL(request.url).pathname,
          status,
          durationMs,
        });
      }
    }
  },
};
