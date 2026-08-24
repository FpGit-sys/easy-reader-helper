import { and, desc, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { writeAuditEvent } from "@/server/audit";
import { getDb } from "@/server/db/client";
import { evidenceLinks, evidences, inspections } from "@/server/db/schema";
import { createPrivateDownloadUrl } from "@/server/files/storage";
import { requireSessionUser } from "@/server/session";

const scopeSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
});

const inspectionInputSchema = scopeSchema.extend({
  inspectionId: z.string().uuid(),
});

const evidenceInputSchema = scopeSchema.extend({
  evidenceId: z.string().uuid(),
});

type EvidencePermission = "evidence.read" | "evidence.write";

async function authorize(data: z.infer<typeof scopeSchema>, permission: EvidencePermission) {
  const session = await requireSessionUser();
  await requirePermission({
    userId: session.user.id,
    organizationId: data.organizationId,
    facilityId: data.facilityId,
    permission,
  });
  return session;
}

async function requireInspectionScope(data: z.infer<typeof inspectionInputSchema>) {
  const db = getDb();
  const [inspection] = await db
    .select({ id: inspections.id, siloId: inspections.siloId, status: inspections.status })
    .from(inspections)
    .where(
      and(
        eq(inspections.id, data.inspectionId),
        eq(inspections.organizationId, data.organizationId),
        eq(inspections.facilityId, data.facilityId),
      ),
    )
    .limit(1);
  if (!inspection) throw new Error("NOT_FOUND:INSPECTION");
  return inspection;
}

export const listProductionInspectionEvidence = createServerFn({ method: "GET" })
  .validator(inspectionInputSchema)
  .handler(async ({ data }) => {
    await authorize(data, "evidence.read");
    await requireInspectionScope(data);
    const db = getDb();

    const rows = await db
      .select({
        id: evidences.id,
        requirementId: evidenceLinks.requirementId,
        inspectionId: evidenceLinks.inspectionId,
        siloId: evidences.siloId,
        type: evidences.type,
        name: evidences.name,
        description: evidences.description,
        originalFilename: evidences.originalFilename,
        mimeType: evidences.mimeType,
        sizeBytes: evidences.sizeBytes,
        sha256: evidences.sha256,
        capturedAt: evidences.capturedAt,
        capturedBy: evidences.capturedBy,
      })
      .from(evidenceLinks)
      .innerJoin(evidences, eq(evidences.id, evidenceLinks.evidenceId))
      .where(
        and(
          eq(evidenceLinks.organizationId, data.organizationId),
          eq(evidenceLinks.inspectionId, data.inspectionId),
          eq(evidences.organizationId, data.organizationId),
          eq(evidences.facilityId, data.facilityId),
        ),
      )
      .orderBy(desc(evidences.capturedAt));

    return rows.map((row) => ({
      ...row,
      capturedAt: row.capturedAt.toISOString(),
    }));
  });

export const getProductionEvidenceDownload = createServerFn({ method: "GET" })
  .validator(evidenceInputSchema)
  .handler(async ({ data }) => {
    const session = await authorize(data, "evidence.read");
    const db = getDb();
    const [row] = await db
      .select({
        id: evidences.id,
        storageKey: evidences.storageKey,
        filename: evidences.originalFilename,
        name: evidences.name,
      })
      .from(evidences)
      .where(
        and(
          eq(evidences.id, data.evidenceId),
          eq(evidences.organizationId, data.organizationId),
          eq(evidences.facilityId, data.facilityId),
        ),
      )
      .limit(1);

    if (!row) throw new Error("NOT_FOUND:EVIDENCE");
    if (!row.storageKey) throw new Error("EVIDENCE_WITHOUT_FILE");

    const url = await createPrivateDownloadUrl(row.storageKey, 180);
    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      actorUserId: session.user.id,
      eventType: "evidence.downloaded",
      entityType: "evidence",
      entityId: row.id,
      metadata: { filename: row.filename ?? row.name },
    });

    return { url, filename: row.filename ?? row.name };
  });
