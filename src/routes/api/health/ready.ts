import { createFileRoute } from "@tanstack/react-router";
import { getPool } from "@/server/db/client";
import { checkPrivateStorage } from "@/server/files/storage";
import { logEvent } from "@/server/observability/log";

export const Route = createFileRoute("/api/health/ready")({
  server: {
    handlers: {
      GET: async () => {
        const started = Date.now();
        try {
          await getPool().query("select 1 as ready");
          const storageConfigured = await checkPrivateStorage();
          if (!storageConfigured) {
            return json(
              {
                status: "not_ready",
                database: "ok",
                privateStorage: "not_configured",
                timestamp: new Date().toISOString(),
              },
              503,
            );
          }
          return json(
            {
              status: "ready",
              database: "ok",
              privateStorage: "configured",
              timestamp: new Date().toISOString(),
            },
            200,
          );
        } catch (error) {
          logEvent("error", "health.readiness_failed", {
            durationMs: Date.now() - started,
            error,
          });
          return json(
            {
              status: "not_ready",
              database: "unavailable",
              privateStorage: "unknown",
              timestamp: new Date().toISOString(),
            },
            503,
          );
        }
      },
    },
  },
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
