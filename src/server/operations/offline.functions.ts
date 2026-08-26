import { and, desc, eq, isNull } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { makeAuditEventValues } from "@/server/audit";
import { getDb } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";
import { devicePairingCodes, devices } from "@/server/db/schema.extensions";
import { generatePairingCode, pairingCodeHash } from "@/server/offline/crypto";
import { requireSessionUser } from "@/server/session";

const scopeSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
});

const revokeSchema = scopeSchema.extend({ deviceId: z.string().uuid() });

export const createDesktopPairingCode = createServerFn({ method: "POST" })
  .validator(scopeSchema)
  .handler(async ({ data }) => {
    const session = await requireSessionUser();
    await requirePermission({
      userId: session.user.id,
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      permission: "inspections.execute",
    });

    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const db = getDb();

    await db.transaction(async (tx) => {
      await tx
        .update(devicePairingCodes)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(devicePairingCodes.organizationId, data.organizationId),
            eq(devicePairingCodes.facilityId, data.facilityId),
            eq(devicePairingCodes.userId, session.user.id),
            isNull(devicePairingCodes.consumedAt),
          ),
        );

      await tx.insert(devicePairingCodes).values({
        organizationId: data.organizationId,
        facilityId: data.facilityId,
        userId: session.user.id,
        codeHash: pairingCodeHash(code),
        createdBy: session.user.id,
        expiresAt,
      });

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "desktop.pairing_code_created",
          entityType: "device_pairing",
          entityId: crypto.randomUUID(),
          after: { expiresAt: expiresAt.toISOString() },
        }),
      );
    });

    return { code, expiresAt: expiresAt.toISOString() };
  });

export const listMyDesktopDevices = createServerFn({ method: "GET" })
  .validator(scopeSchema)
  .handler(async ({ data }) => {
    const session = await requireSessionUser();
    await requirePermission({
      userId: session.user.id,
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      permission: "inspections.execute",
    });

    const db = getDb();
    const rows = await db
      .select({
        id: devices.id,
        name: devices.name,
        platform: devices.platform,
        appVersion: devices.appVersion,
        lastSeenAt: devices.lastSeenAt,
        lastSyncAt: devices.lastSyncAt,
        lastPackAt: devices.lastPackAt,
        activatedAt: devices.activatedAt,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .where(
        and(
          eq(devices.organizationId, data.organizationId),
          eq(devices.facilityId, data.facilityId),
          eq(devices.userId, session.user.id),
        ),
      )
      .orderBy(desc(devices.activatedAt));

    return rows.map((row) => ({
      ...row,
      lastSeenAt: row.lastSeenAt.toISOString(),
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      lastPackAt: row.lastPackAt?.toISOString() ?? null,
      activatedAt: row.activatedAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
  });

export const revokeMyDesktopDevice = createServerFn({ method: "POST" })
  .validator(revokeSchema)
  .handler(async ({ data }) => {
    const session = await requireSessionUser();
    await requirePermission({
      userId: session.user.id,
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      permission: "inspections.execute",
    });

    const db = getDb();
    const [device] = await db
      .select({ id: devices.id, name: devices.name, revokedAt: devices.revokedAt })
      .from(devices)
      .where(
        and(
          eq(devices.id, data.deviceId),
          eq(devices.organizationId, data.organizationId),
          eq(devices.facilityId, data.facilityId),
          eq(devices.userId, session.user.id),
        ),
      )
      .limit(1);

    if (!device) throw new Error("NOT_FOUND:DEVICE");
    if (device.revokedAt) return { revoked: true };

    const revokedAt = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(devices)
        .set({ revokedAt, authTokenHash: null, lastSyncError: "DEVICE_REVOKED" })
        .where(eq(devices.id, device.id));
      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "desktop.device_revoked",
          entityType: "device",
          entityId: device.id,
          before: { revoked: false },
          after: { revoked: true, name: device.name, revokedAt: revokedAt.toISOString() },
        }),
      );
    });

    return { revoked: true };
  });
