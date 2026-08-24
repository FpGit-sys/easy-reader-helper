import { and, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { writeAuditEvent } from "@/server/audit";
import { getDb } from "@/server/db/client";
import { documents, documentVersions } from "@/server/db/schema";
import { createPrivateDownloadUrl } from "@/server/files/storage";
import { requireSessionUser } from "@/server/session";

const scopeSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
});

const documentInput = scopeSchema.extend({ documentId: z.string().uuid() });
const updateMetadataInput = documentInput.extend({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(120),
  siloId: z.string().uuid().nullable(),
  issuedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
});

async function authorize(data: z.infer<typeof scopeSchema>, permission: "documents.read" | "documents.write") {
  const session = await requireSessionUser();
  await requirePermission({
    userId: session.user.id,
    organizationId: data.organizationId,
    facilityId: data.facilityId,
    permission,
  });
  return session;
}

export const listProductionDocuments = createServerFn({ method: "GET" })
  .validator(scopeSchema)
  .handler(async ({ data }) => {
    await authorize(data, "documents.read");
    const db = getDb();
    const rows = await db
      .select({
        id: documents.id,
        siloId: documents.siloId,
        name: documents.name,
        category: documents.category,
        responsibleUserId: documents.responsibleUserId,
        issuedAt: documents.issuedAt,
        expiresAt: documents.expiresAt,
        updatedAt: documents.updatedAt,
        versionId: documentVersions.id,
        version: documentVersions.version,
        originalFilename: documentVersions.originalFilename,
        mimeType: documentVersions.mimeType,
        sizeBytes: documentVersions.sizeBytes,
        sha256: documentVersions.sha256,
        uploadedBy: documentVersions.uploadedBy,
        uploadedAt: documentVersions.uploadedAt,
      })
      .from(documents)
      .leftJoin(documentVersions, eq(documentVersions.id, documents.activeVersionId))
      .where(
        and(
          eq(documents.organizationId, data.organizationId),
          eq(documents.facilityId, data.facilityId),
        ),
      )
      .orderBy(documents.name);

    const now = Date.now();
    const soon = now + 30 * 86_400_000;
    return rows.map((row) => {
      const expires = row.expiresAt?.getTime() ?? null;
      const status =
        expires === null
          ? "sem_validade"
          : expires < now
            ? "vencido"
            : expires <= soon
              ? "vence_em_breve"
              : "valido";
      return {
        ...row,
        status,
        issuedAt: row.issuedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
        uploadedAt: row.uploadedAt?.toISOString() ?? null,
      };
    });
  });

export const getProductionDocumentDownload = createServerFn({ method: "GET" })
  .validator(documentInput)
  .handler(async ({ data }) => {
    const session = await authorize(data, "documents.read");
    const db = getDb();
    const [row] = await db
      .select({
        id: documents.id,
        name: documents.name,
        storageKey: documentVersions.storageKey,
        filename: documentVersions.originalFilename,
      })
      .from(documents)
      .innerJoin(documentVersions, eq(documentVersions.id, documents.activeVersionId))
      .where(
        and(
          eq(documents.id, data.documentId),
          eq(documents.organizationId, data.organizationId),
          eq(documents.facilityId, data.facilityId),
        ),
      )
      .limit(1);

    if (!row) throw new Error("NOT_FOUND:DOCUMENT");
    const url = await createPrivateDownloadUrl(row.storageKey, 180);
    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      actorUserId: session.user.id,
      eventType: "document.downloaded",
      entityType: "document",
      entityId: row.id,
      metadata: { filename: row.filename },
    });
    return { url, filename: row.filename };
  });

export const updateProductionDocumentMetadata = createServerFn({ method: "POST" })
  .validator(updateMetadataInput)
  .handler(async ({ data }) => {
    const session = await authorize(data, "documents.write");
    const db = getDb();
    const [before] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, data.documentId),
          eq(documents.organizationId, data.organizationId),
          eq(documents.facilityId, data.facilityId),
        ),
      )
      .limit(1);
    if (!before) throw new Error("NOT_FOUND:DOCUMENT");

    const [after] = await db
      .update(documents)
      .set({
        name: data.name,
        category: data.category,
        siloId: data.siloId,
        issuedAt: data.issuedAt ? new Date(data.issuedAt) : null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, before.id))
      .returning();
    if (!after) throw new Error("DOCUMENT_UPDATE_FAILED");

    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      actorUserId: session.user.id,
      eventType: "document.metadata_updated",
      entityType: "document",
      entityId: before.id,
      before: {
        name: before.name,
        category: before.category,
        siloId: before.siloId,
        issuedAt: before.issuedAt?.toISOString() ?? null,
        expiresAt: before.expiresAt?.toISOString() ?? null,
      },
      after: {
        name: after.name,
        category: after.category,
        siloId: after.siloId,
        issuedAt: after.issuedAt?.toISOString() ?? null,
        expiresAt: after.expiresAt?.toISOString() ?? null,
      },
    });

    return { ok: true };
  });
