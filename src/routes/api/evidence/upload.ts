import { and, eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { makeAuditEventValues } from "@/server/audit";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import {
  auditEvents,
  evidenceLinks,
  evidences,
  inspections,
  silos,
} from "@/server/db/schema";
import { inspectionChecklistSnapshots } from "@/server/db/schema.extensions";
import {
  safeStorageFilename,
  sha256,
  validateEvidenceImage,
} from "@/server/files/policy";
import {
  deletePrivateObject,
  makePrivateObjectKey,
  putPrivateObject,
} from "@/server/files/storage";

const metadataSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
  siloId: z.string().uuid(),
  inspectionId: z.string().uuid(),
  requirementId: z.string().uuid(),
  description: z.string().trim().max(5000).default(""),
});

export const Route = createFileRoute("/api/evidence/upload")({
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
            siloId: form.get("siloId"),
            inspectionId: form.get("inspectionId"),
            requirementId: form.get("requirementId"),
            description: form.get("description") ?? "",
          });
          if (!parsed.success) {
            return json({ error: "INVALID_METADATA", issues: parsed.error.issues }, 400);
          }
          const data = parsed.data;

          await requirePermission({
            userId: session.user.id,
            organizationId: data.organizationId,
            facilityId: data.facilityId,
            permission: "evidence.write",
          });

          validateEvidenceImage({
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          });

          const db = getDb();
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
          if (!inspection) return json({ error: "NOT_FOUND:INSPECTION" }, 404);
          if (inspection.siloId !== data.siloId) return json({ error: "INVALID_INSPECTION_SILO" }, 400);
          if (inspection.status !== "em_andamento") return json({ error: "INSPECTION_LOCKED" }, 409);

          const [snapshot] = await db
            .select({ id: inspectionChecklistSnapshots.id })
            .from(inspectionChecklistSnapshots)
            .where(
              and(
                eq(inspectionChecklistSnapshots.organizationId, data.organizationId),
                eq(inspectionChecklistSnapshots.inspectionId, data.inspectionId),
                eq(inspectionChecklistSnapshots.requirementId, data.requirementId),
              ),
            )
            .limit(1);
          if (!snapshot) return json({ error: "EVIDENCE_REQUIREMENT_OUT_OF_SCOPE" }, 400);

          const bytes = new Uint8Array(await file.arrayBuffer());
          const digest = sha256(bytes);
          const evidenceId = crypto.randomUUID();
          objectKey = makePrivateObjectKey({
            organizationId: data.organizationId,
            facilityId: data.facilityId,
            category: "evidence",
            entityId: evidenceId,
            filename: safeStorageFilename(file.name),
          });

          await putPrivateObject({
            key: objectKey,
            body: bytes,
            contentType: file.type,
            sha256: digest,
          });

          await db.transaction(async (tx) => {
            await tx.insert(evidences).values({
              id: evidenceId,
              organizationId: data.organizationId,
              facilityId: data.facilityId,
              siloId: data.siloId,
              type: "foto",
              name: file.name,
              description: data.description,
              storageKey: objectKey!,
              originalFilename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              sha256: digest,
              capturedBy: session.user.id,
            });

            await tx.insert(evidenceLinks).values({
              organizationId: data.organizationId,
              evidenceId,
              requirementId: data.requirementId,
              inspectionId: data.inspectionId,
            });

            await tx.insert(auditEvents).values(
              makeAuditEventValues({
                organizationId: data.organizationId,
                facilityId: data.facilityId,
                actorUserId: session.user.id,
                eventType: "evidence.uploaded",
                entityType: "evidence",
                entityId: evidenceId,
                after: {
                  inspectionId: data.inspectionId,
                  requirementId: data.requirementId,
                  siloId: data.siloId,
                  filename: file.name,
                  mimeType: file.type,
                  sizeBytes: file.size,
                  sha256: digest,
                },
                userAgent: request.headers.get("user-agent"),
              }),
            );
          });
          databaseCommitted = true;

          return json({ id: evidenceId, sha256: digest }, 201);
        } catch (error) {
          if (objectKey && !databaseCommitted) {
            await deletePrivateObject(objectKey).catch(() => undefined);
          }

          const message = error instanceof Error ? error.message : "EVIDENCE_UPLOAD_FAILED";
          if (message === "UNAUTHORIZED") return json({ error: message }, 401);
          if (message.startsWith("FORBIDDEN")) return json({ error: message }, 403);
          if (
            message === "FILE_SIZE_NOT_ALLOWED" ||
            message === "FILE_TYPE_NOT_ALLOWED" ||
            message === "INVALID_FILE_NAME"
          ) {
            return json({ error: message }, 400);
          }
          if (message === "OBJECT_STORAGE_NOT_CONFIGURED") {
            return json({ error: message }, 503);
          }

          console.error("SiloNR evidence upload failed", error);
          return json({ error: "EVIDENCE_UPLOAD_FAILED" }, 500);
        }
      },
    },
  },
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
