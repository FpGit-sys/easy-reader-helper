import { and, eq, isNull } from "drizzle-orm";
import { requirePermission } from "@/server/access";
import { getDb } from "@/server/db/client";
import { facilities, organizations } from "@/server/db/schema";
import { devices } from "@/server/db/schema.extensions";
import { getLocalLicenseState } from "@/server/licensing/local";
import { type Permission } from "@/server/rbac";
import { bearerToken, tokenHash } from "./crypto";

export const OFFLINE_SYNC_PROTOCOL_VERSION = 1;

export interface DeviceContext {
  deviceId: string;
  organizationId: string;
  facilityId: string;
  userId: string;
  organizationName: string;
  facilityName: string;
  offlineGraceDays: number;
  licenseValidUntil: Date | null;
}

export function calculateOfflineAllowedUntil(input: {
  now?: Date;
  offlineGraceDays: number;
  licenseValidUntil?: Date | null;
}): Date {
  const now = input.now ?? new Date();
  const graceUntil = new Date(now.getTime() + input.offlineGraceDays * 86_400_000);
  if (input.licenseValidUntil && input.licenseValidUntil.getTime() < graceUntil.getTime()) {
    return input.licenseValidUntil;
  }
  return graceUntil;
}

export async function requireDevice(
  request: Request,
  permission: Permission = "inspections.execute",
): Promise<DeviceContext> {
  const rawToken = bearerToken(request.headers);
  if (!rawToken) throw new Error("UNAUTHORIZED:DEVICE_TOKEN");

  const db = getDb();
  const [row] = await db
    .select({
      deviceId: devices.id,
      organizationId: devices.organizationId,
      facilityId: devices.facilityId,
      userId: devices.userId,
      syncProtocolVersion: devices.syncProtocolVersion,
      organizationName: organizations.name,
      facilityName: facilities.name,
    })
    .from(devices)
    .innerJoin(organizations, eq(organizations.id, devices.organizationId))
    .leftJoin(facilities, eq(facilities.id, devices.facilityId))
    .where(and(eq(devices.authTokenHash, tokenHash(rawToken)), isNull(devices.revokedAt)))
    .limit(1);

  if (!row?.facilityId || !row.userId || !row.facilityName) {
    throw new Error("UNAUTHORIZED:DEVICE_SCOPE");
  }
  if (row.syncProtocolVersion !== OFFLINE_SYNC_PROTOCOL_VERSION) {
    throw new Error("DEVICE_PROTOCOL_UNSUPPORTED");
  }

  await requirePermission({
    userId: row.userId,
    organizationId: row.organizationId,
    facilityId: row.facilityId,
    permission,
  });

  const license = await getLocalLicenseState(row.organizationId);
  const offlineGraceDays = license?.offlineGraceDays ?? 0;
  const allowedUntilValue = license?.graceUntil ?? license?.validUntil ?? new Date(0).toISOString();
  const licenseValidUntil = new Date(allowedUntilValue);

  await db
    .update(devices)
    .set({ lastSeenAt: new Date(), lastSyncError: null })
    .where(eq(devices.id, row.deviceId));

  return {
    deviceId: row.deviceId,
    organizationId: row.organizationId,
    facilityId: row.facilityId,
    userId: row.userId,
    organizationName: row.organizationName,
    facilityName: row.facilityName,
    offlineGraceDays,
    licenseValidUntil,
  };
}

export function deviceErrorStatus(message: string): number {
  if (message.startsWith("UNAUTHORIZED")) return 401;
  if (message.startsWith("FORBIDDEN")) return 403;
  if (message === "LICENSE_NOT_ACTIVE" || message === "LICENSE_EXPIRED") return 403;
  if (message === "DEVICE_PROTOCOL_UNSUPPORTED") return 409;
  return 500;
}
