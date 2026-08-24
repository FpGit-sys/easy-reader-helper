import { and, desc, eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { makeAuditEventValues } from "@/server/audit";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { auditEvents, documents, documentVersions, silos } from "@/server/db/schema";
import { safeStorageFilename, sha256, validateDocumentUpload } from "@/server/files/policy";
import {
  deletePrivateObject,
  makePrivateObjectKey,
  putPrivateObject,
} from "@/server/files/storage";

const metadataSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
  documentId: z.string().uuid().optional(),
  siloId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(120),
  issuedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const Route = createFileRoute("/api/documents/upload")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        let objectKey: string | null = null;
        let databaseCommitted = false;
        try {
          const session = await getAuth().api.getSession({ headers: request.headers });
          if (!session?.user?.id) return json({ error: "UNAUTHORIZED" }, 401);

          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File)) return json({ error: "FILE_REQUIRED" }, 400);

          const parsed = metadataSchema.safeParse({
            organizationId: form.get("organizationId"),
            facilityId: form.get("facilityId"),
            documentId: emptyToUndefined(form.get("documentId")),
            siloId: emptyToUndefined(form.get("siloId")),
            name: form.get("name"),
            category: form.get("category"),
            issuedAt: emptyToUndefined(form.get("issuedAt")),
            expiresAt: emptyToUndefined(form.get("expiresAt")),
          });
          if (!parsed.success) return json({ error: "INVALID_METADATA", issues: parsed.error.issues }, 400);
          const data = parsed.data;

          await requirePermission({
            userId: session.user.id,
            organizationId: data.organizationId,
            facilityId: data.facilityId,
            permission: "documents.write",
          });

          validateDocumentUpload({
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          });

          const db = getDb();
          if (data.siloId) {
            const [silo] = await db
              .select({ id: silos.id })
              .from(silos)
              .where(
                and(
                  eq(silos.id, data.siloId),
                  eq(silos.organizationId, data.organizationId),
                  eq(silos.facilityId, data.facilityId),
                  eq(silos.active, true),
                ),
              )
              .limit(1);
            if (!silo) return json({ error: "INVALID_SILO_SCOPE" }, 400);
          }

          let existing: typeof documents.$inferSelect | null = null;
          if (data.documentId) {
            const [row] = await db
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
            if (!row) return json({ error: "NOT_FOUND:DOCUMENT" }, 404);
            existing = row;
          }

          const bytes = new Uint8Array(await file.arrayBuffer());
          const digest = sha256(bytes);
          const documentId = existing?.id ?? crypto.randomUUID();
          objectKey = makePrivateObjectKey({
            organizationId: data.organizationId,
            facilityId: data.facilityId,
            category: "documents",
            entityId: documentId,
            filename: safeStorageFilename(file.name),
          });

          await putPrivateObject({
            key: objectKey,
            body: bytes,
            contentType: file.type,
            sha256: digest,
          });

          const latestVersion = existing
            ? await db
                .select({ version: documentVersions.version })
                .from(documentVersions)
                .where(eq(documentVersions.documentId, documentId))
                .orderBy(desc(documentVersions.version))
                .limit(1)
            : [];
          const versionNumber = (latestVersion[0]?.version ?? 0) + 1;
          const versionId = crypto.randomUUID();
          const auditInput = {
            organizationId: data.organizationId,
            facilityId: data.facilityId,
            actorUserId: session.user.id,
            eventType: existing ? "document.version_uploaded" : "document.created",
            entityType: "document",
            entityId: documentId,
            before: existing
              ? {
                  name: existing.name,
                  category: existing.category,
                  siloId: existing.siloId,
                  activeVersionId: existing.activeVersionId,
                }
              : null,
            after: {
              name: data.name,
              category: data.category,
              siloId: data.siloId ?? null,
              version: versionNumber,
              filename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              sha256: digest,
            },
            userAgent: request.headers.get("user-agent"),
          };

          await db.transaction(async (tx) => {
            if (!existing) {
              await tx.insert(documents).values({
                id: documentId,
                organizationId: data.organizationId,
                facilityId: data.facilityId,
                siloId: data.siloId ?? null,
                name: data.name,
                category: data.category,
                issuedAt: data.issuedAt ? new Date(data.issuedAt) : null,
                expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
                activeVersionId: versionId,
              });
            }

            await tx.insert(documentVersions).values({
              id: versionId,
              organizationId: data.organizationId,
              documentId,
              version: versionNumber,
              storageKey: objectKey!,
              originalFilename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              sha256: digest,
              uploadedBy: session.user.id,
            });

            if (existing) {
              await tx
                .update(documents)
                .set({
                  name: data.name,
                  category: data.category,
                  siloId: data.siloId ?? null,
                  issuedAt: data.issuedAt ? new Date(data.issuedAt) : null,
                  expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
                  activeVersionId: versionId,
                  updatedAt: new Date(),
                })
                .where(eq(documents.id, existing.id));
            }

            await tx.insert(auditEvents).values(makeAuditEventValues(auditInput));
          });
          databaseCommitted = true;

          return json(
            {
              id: documentId,
              version: versionNumber,
              sha256: digest,
            },
            200,
          );
        } catch (error) {
          if (objectKey && !databaseCommitted) {
            await deletePrivateObject(objectKey).catch(() => undefined);
          }
          const message = error instanceof Error ? error.message : "UPLOAD_FAILED";
          if (message === "UNAUTHORIZED") return json({ error: message }, 401);
          if (message.startsWith("FORBIDDEN")) return json({ error: message }, 403);
          if (
            message === "FILE_SIZE_NOT_ALLOWED" ||
            message === "FILE_TYPE_NOT_ALLOWED" ||
            message === "INVALID_FILE_NAME"
          ) {
            return json({ error: message }, 400);
          }
          console.error("SiloNR document upload failed", error);
          return json({ error: "UPLOAD_FAILED" }, 500);
        }
      },
    },
  },
});

function emptyToUndefined(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
