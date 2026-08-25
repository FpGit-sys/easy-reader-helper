import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { makeAuditEventValues } from "@/server/audit";
import { getDb } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";
import { devicePairingCodes, devices, licenses } from "@/server/db/schema.extensions";
import {
  generateDeviceToken,
  pairingCodeHash,
  sha256Hex,
  tokenHash,
} from "@/server/offline/crypto";
import {
  calculateOfflineAllowedUntil,
  OFFLINE_SYNC_PROTOCOL_VERSION,
} from "@/server/offline/device-auth";

const activateSchema = z.object({
  code: z.string().trim().min(12).max(80),
  fingerprint: z.string().trim().min(16).max(500),
  name: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(80),
  appVersion: z.string().trim().min(1).max(40),
});

export const Route = createFileRoute("/api/offline/activate")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
            return json({ error: "CONTENT_TYPE_REQUIRED" }, 415);
          }
          const parsed = activateSchema.safeParse(await request.json());
          if (!parsed.success) return json({ error: "INVALID_ACTIVATION", issues: parsed.error.issues }, 400);

          const data = parsed.data;
          const now = new Date();
          const db = getDb();
          const codeHash = pairingCodeHash(data.code);

          const [pairing] = await db
            .select()
            .from(devicePairingCodes)
            .where(
              and(
                eq(devicePairingCodes.codeHash, codeHash),
                isNull(devicePairingCodes.consumedAt),
                gt(devicePairingCodes.expiresAt, now),
              ),
            )
            .limit(1);
          if (!pairing) return json({ error: "PAIRING_CODE_INVALID_OR_EXPIRED" }, 401);

          const [license] = await db
            .select({
              status: licenses.status,
              validUntil: licenses.validUntil,
              offlineGraceDays: licenses.offlineGraceDays,
            })
            .from(licenses)
            .where(eq(licenses.organizationId, pairing.organizationId))
            .orderBy(desc(licenses.createdAt))
            .limit(1);
          if (!license || (license.status !== "trial" && license.status !== "active")) {
            return json({ error: "LICENSE_NOT_ACTIVE" }, 403);
          }
          if (license.validUntil && license.validUntil.getTime() < now.getTime()) {
            return json({ error: "LICENSE_EXPIRED" }, 403);
          }

          const fingerprintHash = sha256Hex(data.fingerprint);
          const [existing] = await db
            .select()
            .from(devices)
            .where(
              and(
                eq(devices.organizationId, pairing.organizationId),
                eq(devices.deviceFingerprintHash, fingerprintHash),
              ),
            )
            .limit(1);

          if (
            existing &&
            (existing.userId !== pairing.userId || existing.facilityId !== pairing.facilityId) &&
            !existing.revokedAt
          ) {
            return json({ error: "DEVICE_ALREADY_BOUND" }, 409);
          }

          const rawToken = generateDeviceToken();
          const authTokenHash = tokenHash(rawToken);
          const deviceId = existing?.id ?? crypto.randomUUID();
          const activatedAt = new Date();

          await db.transaction(async (tx) => {
            const consumed = await tx
              .update(devicePairingCodes)
              .set({ consumedAt: activatedAt })
              .where(
                and(
                  eq(devicePairingCodes.id, pairing.id),
                  isNull(devicePairingCodes.consumedAt),
                  gt(devicePairingCodes.expiresAt, activatedAt),
                ),
              )
              .returning({ id: devicePairingCodes.id });
            if (consumed.length !== 1) throw new Error("PAIRING_CODE_ALREADY_USED");

            if (existing) {
              await tx
                .update(devices)
                .set({
                  facilityId: pairing.facilityId,
                  userId: pairing.userId,
                  authTokenHash,
                  name: data.name,
                  platform: data.platform,
                  appVersion: data.appVersion,
                  syncProtocolVersion: OFFLINE_SYNC_PROTOCOL_VERSION,
                  lastSeenAt: activatedAt,
                  lastSyncError: null,
                  activatedAt,
                  revokedAt: null,
                })
                .where(eq(devices.id, existing.id));
            } else {
              await tx.insert(devices).values({
                id: deviceId,
                organizationId: pairing.organizationId,
                facilityId: pairing.facilityId,
                userId: pairing.userId,
                deviceFingerprintHash: fingerprintHash,
                authTokenHash,
                name: data.name,
                platform: data.platform,
                appVersion: data.appVersion,
                syncProtocolVersion: OFFLINE_SYNC_PROTOCOL_VERSION,
                lastSeenAt: activatedAt,
                activatedAt,
              });
            }

            await tx.insert(auditEvents).values(
              makeAuditEventValues({
                organizationId: pairing.organizationId,
                facilityId: pairing.facilityId,
                actorUserId: pairing.userId,
                eventType: existing ? "desktop.device_reactivated" : "desktop.device_activated",
                entityType: "device",
                entityId: deviceId,
                after: {
                  name: data.name,
                  platform: data.platform,
                  appVersion: data.appVersion,
                  protocolVersion: OFFLINE_SYNC_PROTOCOL_VERSION,
                },
                userAgent: request.headers.get("user-agent"),
              }),
            );
          });

          const offlineAllowedUntil = calculateOfflineAllowedUntil({
            now,
            offlineGraceDays: license.offlineGraceDays,
            licenseValidUntil: license.validUntil,
          });

          return json(
            {
              token: rawToken,
              deviceId,
              organizationId: pairing.organizationId,
              facilityId: pairing.facilityId,
              userId: pairing.userId,
              protocolVersion: OFFLINE_SYNC_PROTOCOL_VERSION,
              serverTime: now.toISOString(),
              offlineAllowedUntil: offlineAllowedUntil.toISOString(),
            },
            201,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "DEVICE_ACTIVATION_FAILED";
          if (message === "PAIRING_CODE_ALREADY_USED") return json({ error: message }, 409);
          console.error("SiloNR desktop activation failed", error);
          return json({ error: "DEVICE_ACTIVATION_FAILED" }, 500);
        }
      },
    },
  },
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
