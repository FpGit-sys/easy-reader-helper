import { and, eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { makeAuditEventValues } from "@/server/audit";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import {
  auditEvents,
  correctiveActions,
  evidenceLinks,
  evidences,
} from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import {
  MAX_DOCUMENT_BYTES,
  safeStorageFilename,
  sha256,
  validateDocumentUpload,
  validateFileContent,
  validateRequestContentLength,
} from "@/server/files/policy";
import {
  deletePrivateObject,
  makePrivateObjectKey,
  putPrivateObject,
} from "@/server/files/storage";
import { assertTrustedMutationOrigin } from "@/server/security/origin";

const metadataSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
  actionId: z.string().uuid(),
  description: z.string().trim().max(5000).default(""),
});

export const Route = createFileRoute("/api/actions/evidence-upload")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        let objectKey: string | null = null;
        let databaseCommitted = false;

        try {
          assertTrustedMutationOrigin(request, getServerEnv().APP_URL);
          const session = await getAuth().api.getSession({ headers: request.headers });
          if (!session?.user?.id) return json({ error: "UNAUTHORIZED" }, 401);
          validateRequestContentLength(request, MAX_DOCUMENT_BYTES);

          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File)) return json({ error: "FILE_REQUIRED" }, 400);

          const parsed = metadataSchema.safeParse({
            organizationId: form.get("organizationId"),
            facilityId: form.get("facilityId"),
            actionId: form.get("actionId"),
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
          await requirePermission({
            userId: session.user.id,
            organizationId: data.organizationId,
            facilityId: data.facilityId,
            permission: "actions.write",
          });

          validateDocumentUpload({
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          });

          const db = getDb();
          const [action] = await db
            .select({
              id: correctiveActions.id,
              siloId: correctiveActions.siloId,
              nonconformityId: correctiveActions.nonconformityId,
              status: correctiveActions.status,
            })
            .from(correctiveActions)
            .where(
              and(
                eq(correctiveActions.id, data.actionId),
                eq(correctiveActions.organizationId, data.organizationId),
                eq(correctiveActions.facilityId, data.facilityId),
              ),
            )
            .limit(1);
          if (!action) return json({ error: "NOT_FOUND:CORRECTIVE_ACTION" }, 404);
          if (action.status === "concluida" || action.status === "cancelada") {
            return json({ error: "ACTION_LOCKED" }, 409);
          }

          const bytes = new Uint8Array(await file.arrayBuffer());
          validateFileContent(bytes, file.type);
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
              siloId: action.siloId,
              type: file.type === "application/pdf" ? "documento" : "foto",
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
              nonconformityId: action.nonconformityId,
              correctiveActionId: action.id,
            });

            await tx.insert(auditEvents).values(
              makeAuditEventValues({
                organizationId: data.organizationId,
                facilityId: data.facilityId,
                actorUserId: session.user.id,
                eventType: "corrective_action.evidence_uploaded",
                entityType: "evidence",
                entityId: evidenceId,
                after: {
                  actionId: action.id,
                  nonconformityId: action.nonconformityId,
                  siloId: action.siloId,
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

          const message = error instanceof Error ? error.message : "ACTION_EVIDENCE_UPLOAD_FAILED";
          if (message === "UNAUTHORIZED") return json({ error: message }, 401);
          if (message.startsWith("FORBIDDEN")) return json({ error: message }, 403);
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

          console.error("SiloNR corrective action evidence upload failed", error);
          return json({ error: "ACTION_EVIDENCE_UPLOAD_FAILED" }, 500);
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
