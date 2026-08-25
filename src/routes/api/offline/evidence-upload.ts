import { and, eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { makeAuditEventValues } from "@/server/audit";
import { requirePermission } from "@/server/access";
import { getDb } from "@/server/db/client";
import {
  auditEvents,
  evidenceLinks,
  evidences,
  inspections,
} from "@/server/db/schema";
import { inspectionChecklistSnapshots } from "@/server/db/schema.extensions";
import {
  MAX_IMAGE_BYTES,
  safeStorageFilename,
  sha256,
  validateEvidenceImage,
  validateFileContent,
  validateRequestContentLength,
} from "@/server/files/policy";
import {
  deletePrivateObject,
  makePrivateObjectKey,
  putPrivateObject,
} from "@/server/files/storage";
import { deviceErrorStatus, requireDevice } from "@/server/offline/device-auth";

const metadataSchema = z.object({
  evidenceId: z.string().uuid(),
  inspectionId: z.string().uuid(),
  requirementId: z.string().uuid(),
  description: z.string().trim().max(5000).default(""),
  capturedAt: z.string().datetime().optional(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});

export const Route = createFileRoute("/api/offline/evidence-upload")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        let objectKey: string | null = null;
        let databaseCommitted = false;

        try {
          validateRequestContentLength(request, MAX_IMAGE_BYTES);
          const ctx = await requireDevice(request, "evidence.write");
          await requirePermission({
            userId: ctx.userId,
            organizationId: ctx.organizationId,
            facilityId: ctx.facilityId,
            permission: "inspections.execute",
          });

          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File)) return json({ error: "FILE_REQUIRED" }, 400);

          const parsed = metadataSchema.safeParse({
            evidenceId: form.get("evidenceId"),
            inspectionId: form.get("inspectionId"),
            requirementId: form.get("requirementId"),
            description: form.get("description") ?? "",
            capturedAt: form.get("capturedAt") || undefined,
            expectedSha256: form.get("expectedSha256") || undefined,
          });
          if (!parsed.success) {
            return json({ error: "INVALID_METADATA", issues: parsed.error.issues }, 400);
          }
          const data = parsed.data;

          validateEvidenceImage({
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          });

          const bytes = new Uint8Array(await file.arrayBuffer());
          validateFileContent(bytes, file.type);
          const digest = sha256(bytes);
          if (data.expectedSha256 && data.expectedSha256.toLowerCase() !== digest) {
            return json({ error: "EVIDENCE_HASH_MISMATCH" }, 409);
          }

          const db = getDb();
          const [inspection] = await db
            .select({
              id: inspections.id,
              siloId: inspections.siloId,
              status: inspections.status,
              deviceId: inspections.deviceId,
              inspectorUserId: inspections.inspectorUserId,
            })
            .from(inspections)
            .where(
              and(
                eq(inspections.id, data.inspectionId),
                eq(inspections.organizationId, ctx.organizationId),
                eq(inspections.facilityId, ctx.facilityId),
              ),
            )
            .limit(1);

          if (!inspection) return json({ error: "NOT_FOUND:INSPECTION" }, 404);
          if (inspection.status !== "em_andamento") {
            return json({ error: "INSPECTION_LOCKED" }, 409);
          }
          if (inspection.deviceId !== ctx.deviceId || inspection.inspectorUserId !== ctx.userId) {
            return json({ error: "OFFLINE_DEVICE_OWNERSHIP_CONFLICT" }, 409);
          }

          const [snapshot] = await db
            .select({ requirementId: inspectionChecklistSnapshots.requirementId })
            .from(inspectionChecklistSnapshots)
            .where(
              and(
                eq(inspectionChecklistSnapshots.organizationId, ctx.organizationId),
                eq(inspectionChecklistSnapshots.inspectionId, inspection.id),
                eq(inspectionChecklistSnapshots.requirementId, data.requirementId),
              ),
            )
            .limit(1);
          if (!snapshot) return json({ error: "OFFLINE_EVIDENCE_OUT_OF_SCOPE" }, 409);

          const [existing] = await db
            .select({
              id: evidences.id,
              sha256: evidences.sha256,
              organizationId: evidences.organizationId,
              facilityId: evidences.facilityId,
            })
            .from(evidences)
            .where(eq(evidences.id, data.evidenceId))
            .limit(1);

          if (existing) {
            const [link] = await db
              .select({ id: evidenceLinks.id })
              .from(evidenceLinks)
              .where(
                and(
                  eq(evidenceLinks.organizationId, ctx.organizationId),
                  eq(evidenceLinks.evidenceId, data.evidenceId),
                  eq(evidenceLinks.inspectionId, data.inspectionId),
                  eq(evidenceLinks.requirementId, data.requirementId),
                ),
              )
              .limit(1);
            if (
              existing.organizationId === ctx.organizationId &&
              existing.facilityId === ctx.facilityId &&
              existing.sha256 === digest &&
              link
            ) {
              return json({ id: existing.id, sha256: digest, idempotent: true }, 200);
            }
            return json({ error: "EVIDENCE_ID_CONFLICT" }, 409);
          }

          objectKey = makePrivateObjectKey({
            organizationId: ctx.organizationId,
            facilityId: ctx.facilityId,
            category: "evidence",
            entityId: data.evidenceId,
            filename: safeStorageFilename(file.name),
          });

          await putPrivateObject({
            key: objectKey,
            body: bytes,
            contentType: file.type,
            sha256: digest,
          });

          const capturedAt = data.capturedAt ? new Date(data.capturedAt) : new Date();
          await db.transaction(async (tx) => {
            await tx.insert(evidences).values({
              id: data.evidenceId,
              organizationId: ctx.organizationId,
              facilityId: ctx.facilityId,
              siloId: inspection.siloId,
              type: "foto",
              name: file.name,
              description: data.description,
              storageKey: objectKey!,
              originalFilename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              sha256: digest,
              capturedAt,
              capturedBy: ctx.userId,
              deviceId: ctx.deviceId,
            });

            await tx.insert(evidenceLinks).values({
              organizationId: ctx.organizationId,
              evidenceId: data.evidenceId,
              requirementId: data.requirementId,
              inspectionId: data.inspectionId,
            });

            await tx.insert(auditEvents).values(
              makeAuditEventValues({
                organizationId: ctx.organizationId,
                facilityId: ctx.facilityId,
                actorUserId: ctx.userId,
                eventType: "inspection.offline_evidence_uploaded",
                entityType: "evidence",
                entityId: data.evidenceId,
                after: {
                  inspectionId: data.inspectionId,
                  requirementId: data.requirementId,
                  siloId: inspection.siloId,
                  filename: file.name,
                  mimeType: file.type,
                  sizeBytes: file.size,
                  sha256: digest,
                  deviceId: ctx.deviceId,
                  capturedAt: capturedAt.toISOString(),
                },
                userAgent: request.headers.get("user-agent"),
              }),
            );
          });
          databaseCommitted = true;

          return json({ id: data.evidenceId, sha256: digest, idempotent: false }, 201);
        } catch (error) {
          if (objectKey && !databaseCommitted) {
            await deletePrivateObject(objectKey).catch(() => undefined);
          }

          const message = error instanceof Error ? error.message : "OFFLINE_EVIDENCE_UPLOAD_FAILED";
          const deviceStatus = deviceErrorStatus(message);
          if (deviceStatus !== 500) return json({ error: message }, deviceStatus);
          if (message === "REQUEST_BODY_TOO_LARGE") return json({ error: message }, 413);
          if (
            message === "FILE_SIZE_NOT_ALLOWED" ||
            message === "FILE_TYPE_NOT_ALLOWED" ||
            message === "FILE_CONTENT_MISMATCH" ||
            message === "INVALID_CONTENT_LENGTH" ||
            message === "INVALID_FILE_NAME"
          ) {
            return json({ error: message }, 400);
          }
          if (message === "OBJECT_STORAGE_NOT_CONFIGURED") {
            return json({ error: message }, 503);
          }

          console.error("SiloNR offline evidence upload failed", error);
          return json({ error: "OFFLINE_EVIDENCE_UPLOAD_FAILED" }, 500);
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
