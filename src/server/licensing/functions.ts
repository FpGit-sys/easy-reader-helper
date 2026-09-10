import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { writeAuditEvent } from "@/server/audit";
import { requireSessionUser } from "@/server/session";
import { activateLocalLicense, getLocalLicenseState, refreshLocalLicense } from "./local";

const organizationSchema = z.object({ organizationId: z.string().uuid() });
const activationSchema = organizationSchema.extend({
  licenseKey: z.string().trim().min(20).max(80),
});

async function authorizeLicenseAdministration(organizationId: string) {
  const session = await requireSessionUser();
  await requirePermission({
    userId: session.user.id,
    organizationId,
    facilityId: null,
    permission: "users.manage",
  });
  return session;
}

export const activateProductionLicense = createServerFn({ method: "POST" })
  .validator(activationSchema)
  .handler(async ({ data }) => {
    const session = await authorizeLicenseAdministration(data.organizationId);
    const claims = await activateLocalLicense({
      organizationId: data.organizationId,
      licenseKey: data.licenseKey,
      label: `SiloNR ${data.organizationId.slice(0, 8)}`,
    });
    await writeAuditEvent({
      organizationId: data.organizationId,
      actorUserId: session.user.id,
      eventType: "license.activated",
      entityType: "license",
      entityId: claims.licenseId,
      after: {
        plan: claims.plan,
        status: claims.status,
        validUntil: claims.validUntil,
        graceUntil: claims.graceUntil,
        installationId: claims.installationId,
      },
      metadata: { rawLicenseKeyStored: false },
    });
    return getLocalLicenseState(data.organizationId);
  });

export const refreshProductionLicense = createServerFn({ method: "POST" })
  .validator(organizationSchema)
  .handler(async ({ data }) => {
    const session = await authorizeLicenseAdministration(data.organizationId);
    const claims = await refreshLocalLicense(data.organizationId);
    await writeAuditEvent({
      organizationId: data.organizationId,
      actorUserId: session.user.id,
      eventType: "license.refreshed",
      entityType: "license",
      entityId: claims.licenseId,
      after: { status: claims.status, validUntil: claims.validUntil, graceUntil: claims.graceUntil },
    });
    return getLocalLicenseState(data.organizationId);
  });
