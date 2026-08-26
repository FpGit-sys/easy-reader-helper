import { and, asc, eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/server/db/client";
import {
  requirementSilos,
  requirementSources,
  requirements,
  requirementVersions,
  silos,
} from "@/server/db/schema";
import { devices } from "@/server/db/schema.extensions";
import {
  calculateOfflineAllowedUntil,
  deviceErrorStatus,
  OFFLINE_SYNC_PROTOCOL_VERSION,
  requireDevice,
} from "@/server/offline/device-auth";

export const Route = createFileRoute("/api/offline/bootstrap")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          const ctx = await requireDevice(request, "inspections.execute");
          const db = getDb();

          const [siloRows, requirementRows] = await Promise.all([
            db
              .select({
                id: silos.id,
                code: silos.code,
                name: silos.name,
                type: silos.type,
                capacityTonnes: silos.capacityTonnes,
                inspectionPeriodDays: silos.inspectionPeriodDays,
                notes: silos.notes,
              })
              .from(silos)
              .where(
                and(
                  eq(silos.organizationId, ctx.organizationId),
                  eq(silos.facilityId, ctx.facilityId),
                  eq(silos.active, true),
                ),
              )
              .orderBy(asc(silos.code)),
            db
              .select({
                siloId: requirementSilos.siloId,
                requirementId: requirements.id,
                requirementVersionId: requirementVersions.id,
                code: requirements.code,
                title: requirements.title,
                category: requirements.category,
                description: requirementVersions.description,
                severity: requirementVersions.severity,
                evidenceRequired: requirementVersions.evidenceRequired,
                internalPeriodDays: requirementVersions.internalPeriodDays,
                sourceType: requirementSources.type,
                sourceTitle: requirementSources.title,
                sourceIssuer: requirementSources.issuer,
                sourceVersion: requirementSources.version,
                sourceSection: requirementSources.section,
                sourceOfficialUrl: requirementSources.officialUrl,
                sourceConsultedAt: requirementSources.consultedAt,
                sourceVerifiedBy: requirementSources.verifiedBy,
                sourceVerifiedAt: requirementSources.verifiedAt,
              })
              .from(requirementSilos)
              .innerJoin(requirements, eq(requirements.id, requirementSilos.requirementId))
              .innerJoin(requirementVersions, eq(requirementVersions.id, requirements.activeVersionId))
              .leftJoin(requirementSources, eq(requirementSources.id, requirementVersions.sourceId))
              .innerJoin(silos, eq(silos.id, requirementSilos.siloId))
              .where(
                and(
                  eq(requirementSilos.organizationId, ctx.organizationId),
                  eq(requirements.organizationId, ctx.organizationId),
                  eq(requirements.lifecycle, "publicado"),
                  eq(silos.organizationId, ctx.organizationId),
                  eq(silos.facilityId, ctx.facilityId),
                  eq(silos.active, true),
                ),
              )
              .orderBy(asc(requirementSilos.siloId), asc(requirements.code)),
          ]);

          const downloadedAt = new Date();
          const offlineAllowedUntil = calculateOfflineAllowedUntil({
            now: downloadedAt,
            offlineGraceDays: ctx.offlineGraceDays,
            licenseValidUntil: ctx.licenseValidUntil,
          });

          await db
            .update(devices)
            .set({ lastPackAt: downloadedAt, lastSeenAt: downloadedAt, lastSyncError: null })
            .where(eq(devices.id, ctx.deviceId));

          return json({
            protocolVersion: OFFLINE_SYNC_PROTOCOL_VERSION,
            downloadedAt: downloadedAt.toISOString(),
            offlineAllowedUntil: offlineAllowedUntil.toISOString(),
            workspace: {
              organizationId: ctx.organizationId,
              organizationName: ctx.organizationName,
              facilityId: ctx.facilityId,
              facilityName: ctx.facilityName,
              userId: ctx.userId,
              deviceId: ctx.deviceId,
            },
            silos: siloRows,
            requirements: requirementRows.map((row) => ({
              ...row,
              sourceConsultedAt: row.sourceConsultedAt?.toISOString() ?? null,
              sourceVerifiedAt: row.sourceVerifiedAt?.toISOString() ?? null,
            })),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "OFFLINE_BOOTSTRAP_FAILED";
          const status = deviceErrorStatus(message);
          if (status >= 500) console.error("SiloNR offline bootstrap failed", error);
          return json({ error: status >= 500 ? "OFFLINE_BOOTSTRAP_FAILED" : message }, status);
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
