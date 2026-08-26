import { eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { devices } from "@/server/db/schema.extensions";
import { validateRequestContentLength } from "@/server/files/policy";
import {
  deviceErrorStatus,
  OFFLINE_SYNC_PROTOCOL_VERSION,
  requireDevice,
} from "@/server/offline/device-auth";
import { applyOfflineEvent, offlineEventSchema } from "@/server/offline/sync";

const MAX_SYNC_BODY_BYTES = 2 * 1024 * 1024;

const syncRequestSchema = z.object({
  protocolVersion: z.literal(OFFLINE_SYNC_PROTOCOL_VERSION),
  events: z.array(offlineEventSchema).min(1).max(50),
});

export const Route = createFileRoute("/api/offline/sync")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        let deviceId: string | null = null;
        try {
          validateRequestContentLength(request, MAX_SYNC_BODY_BYTES);
          if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
            return json({ error: "CONTENT_TYPE_REQUIRED" }, 415);
          }

          const ctx = await requireDevice(request, "inspections.execute");
          deviceId = ctx.deviceId;
          const parsed = syncRequestSchema.safeParse(await request.json());
          if (!parsed.success) return json({ error: "INVALID_SYNC_PAYLOAD", issues: parsed.error.issues }, 400);

          const results = [];
          for (const event of parsed.data.events) {
            results.push(await applyOfflineEvent(ctx, event));
          }

          const now = new Date();
          const firstProblem = results.find((result) => result.status !== "applied");
          await getDb()
            .update(devices)
            .set({
              lastSeenAt: now,
              lastSyncAt: now,
              lastSyncError: firstProblem?.code ?? null,
            })
            .where(eq(devices.id, ctx.deviceId));

          return json({
            protocolVersion: OFFLINE_SYNC_PROTOCOL_VERSION,
            serverTime: now.toISOString(),
            results,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "OFFLINE_SYNC_FAILED";
          const status = message === "REQUEST_BODY_TOO_LARGE" ? 413 : deviceErrorStatus(message);
          if (deviceId) {
            await getDb()
              .update(devices)
              .set({ lastSyncError: message.slice(0, 500), lastSeenAt: new Date() })
              .where(eq(devices.id, deviceId))
              .catch(() => undefined);
          }
          if (status >= 500) console.error("SiloNR offline sync failed", error);
          return json({ error: status >= 500 ? "OFFLINE_SYNC_FAILED" : message }, status);
        }
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
