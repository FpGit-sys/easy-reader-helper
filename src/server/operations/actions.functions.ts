import { and, desc, eq, inArray } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  assertActionCanBeCompleted,
  canTransitionCorrectiveAction,
} from "@/lib/workflow/corrective";
import { requirePermission } from "@/server/access";
import { assertAssignableUser } from "@/server/assignees";
import { makeAuditEventValues, writeAuditEvent } from "@/server/audit";
import { getDb } from "@/server/db/client";
import {
  auditEvents,
  correctiveActions,
  evidenceLinks,
  evidences,
  nonconformities,
  silos,
} from "@/server/db/schema";
import { createPrivateDownloadUrl } from "@/server/files/storage";
import { requireSessionUser } from "@/server/session";

const scopeSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
});

const actionIdSchema = scopeSchema.extend({ actionId: z.string().uuid() });

const createActionSchema = scopeSchema.extend({
  nonconformityId: z.string().uuid().nullable(),
  siloId: z.string().uuid().nullable(),
  title: z.string().trim().min(2).max(240),
  responsibleUserId: z.string().min(1),
  dueAt: z.string().datetime().nullable(),
  priority: z.enum(["baixa", "media", "alta"]),
  notes: z.string().trim().max(5000).default(""),
});

const updateActionSchema = actionIdSchema.extend({
  responsibleUserId: z.string().min(1).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  priority: z.enum(["baixa", "media", "alta"]).optional(),
  notes: z.string().trim().max(5000).optional(),
  status: z
    .enum(["nao_iniciada", "em_andamento", "aguardando_evidencia", "cancelada"])
    .optional(),
});

type Permission = "actions.read" | "actions.write";

async function authorize(data: z.infer<typeof scopeSchema>, permission: Permission) {
  const session = await requireSessionUser();
  await requirePermission({
    userId: session.user.id,
    organizationId: data.organizationId,
    facilityId: data.facilityId,
    permission,
  });
  return session;
}

function makeActionCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `AC-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export const listProductionActions = createServerFn({ method: "GET" })
  .validator(scopeSchema)
  .handler(async ({ data }) => {
    await authorize(data, "actions.read");
    const db = getDb();
    const rows = await db
      .select({
        id: correctiveActions.id,
        code: correctiveActions.code,
        title: correctiveActions.title,
        nonconformityId: correctiveActions.nonconformityId,
        nonconformityCode: nonconformities.code,
        nonconformityTitle: nonconformities.title,
        siloId: correctiveActions.siloId,
        siloCode: silos.code,
        siloName: silos.name,
        responsibleUserId: correctiveActions.responsibleUserId,
        dueAt: correctiveActions.dueAt,
        priority: correctiveActions.priority,
        status: correctiveActions.status,
        notes: correctiveActions.notes,
        completedAt: correctiveActions.completedAt,
        createdAt: correctiveActions.createdAt,
        updatedAt: correctiveActions.updatedAt,
      })
      .from(correctiveActions)
      .leftJoin(nonconformities, eq(nonconformities.id, correctiveActions.nonconformityId))
      .leftJoin(silos, eq(silos.id, correctiveActions.siloId))
      .where(
        and(
          eq(correctiveActions.organizationId, data.organizationId),
          eq(correctiveActions.facilityId, data.facilityId),
        ),
      )
      .orderBy(desc(correctiveActions.createdAt));

    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const links = await db
      .select({ correctiveActionId: evidenceLinks.correctiveActionId })
      .from(evidenceLinks)
      .where(
        and(
          eq(evidenceLinks.organizationId, data.organizationId),
          inArray(evidenceLinks.correctiveActionId, ids),
        ),
      );

    const now = Date.now();
    return rows.map((row) => ({
      ...row,
      dueAt: row.dueAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      evidenceCount: links.filter((link) => link.correctiveActionId === row.id).length,
      overdue:
        Boolean(row.dueAt) &&
        row.dueAt!.getTime() < now &&
        row.status !== "concluida" &&
        row.status !== "cancelada",
    }));
  });

export const createProductionAction = createServerFn({ method: "POST" })
  .validator(createActionSchema)
  .handler(async ({ data }) => {
    const session = await authorize(data, "actions.write");
    await assertAssignableUser({
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      userId: data.responsibleUserId,
      requiredPermission: "actions.write",
    });

    const db = getDb();
    let linkedNonconformity: typeof nonconformities.$inferSelect | null = null;
    if (data.nonconformityId) {
      const [row] = await db
        .select()
        .from(nonconformities)
        .where(
          and(
            eq(nonconformities.id, data.nonconformityId),
            eq(nonconformities.organizationId, data.organizationId),
            eq(nonconformities.facilityId, data.facilityId),
          ),
        )
        .limit(1);
      if (!row) throw new Error("NOT_FOUND:NONCONFORMITY");
      if (row.status === "resolvida" || row.status === "cancelada") {
        throw new Error("NONCONFORMITY_CLOSED");
      }
      linkedNonconformity = row;
    }

    const siloId = linkedNonconformity?.siloId ?? data.siloId;
    if (siloId) {
      const [silo] = await db
        .select({ id: silos.id })
        .from(silos)
        .where(
          and(
            eq(silos.id, siloId),
            eq(silos.organizationId, data.organizationId),
            eq(silos.facilityId, data.facilityId),
            eq(silos.active, true),
          ),
        )
        .limit(1);
      if (!silo) throw new Error("INVALID_SILO_SCOPE");
    }

    const actionId = crypto.randomUUID();
    const code = makeActionCode();
    await db.transaction(async (tx) => {
      await tx.insert(correctiveActions).values({
        id: actionId,
        organizationId: data.organizationId,
        facilityId: data.facilityId,
        nonconformityId: linkedNonconformity?.id ?? null,
        siloId: siloId ?? null,
        code,
        title: data.title,
        responsibleUserId: data.responsibleUserId,
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
        priority: data.priority,
        status: "nao_iniciada",
        notes: data.notes,
      });

      if (linkedNonconformity?.status === "aberta") {
        await tx
          .update(nonconformities)
          .set({ status: "em_tratamento", updatedAt: new Date() })
          .where(eq(nonconformities.id, linkedNonconformity.id));
      }

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "corrective_action.created",
          entityType: "corrective_action",
          entityId: actionId,
          after: {
            code,
            title: data.title,
            nonconformityId: linkedNonconformity?.id ?? null,
            siloId: siloId ?? null,
            responsibleUserId: data.responsibleUserId,
            dueAt: data.dueAt,
            priority: data.priority,
            status: "nao_iniciada",
          },
        }),
      );
    });

    return { id: actionId, code };
  });

export const updateProductionAction = createServerFn({ method: "POST" })
  .validator(updateActionSchema)
  .handler(async ({ data }) => {
    const session = await authorize(data, "actions.write");
    if (data.responsibleUserId !== undefined) {
      await assertAssignableUser({
        organizationId: data.organizationId,
        facilityId: data.facilityId,
        userId: data.responsibleUserId,
        requiredPermission: "actions.write",
      });
    }

    const db = getDb();
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(correctiveActions)
        .where(
          and(
            eq(correctiveActions.id, data.actionId),
            eq(correctiveActions.organizationId, data.organizationId),
            eq(correctiveActions.facilityId, data.facilityId),
          ),
        )
        .limit(1);
      if (!before) throw new Error("NOT_FOUND:CORRECTIVE_ACTION");

      if (data.status && !canTransitionCorrectiveAction(before.status, data.status)) {
        throw new Error(`INVALID_ACTION_TRANSITION:${before.status}:${data.status}`);
      }

      const patch: Partial<typeof correctiveActions.$inferInsert> = { updatedAt: new Date() };
      if (data.responsibleUserId !== undefined) patch.responsibleUserId = data.responsibleUserId;
      if (data.dueAt !== undefined) patch.dueAt = data.dueAt ? new Date(data.dueAt) : null;
      if (data.priority !== undefined) patch.priority = data.priority;
      if (data.notes !== undefined) patch.notes = data.notes;
      if (data.status !== undefined) {
        patch.status = data.status;
        if (before.status === "concluida" && data.status === "em_andamento") patch.completedAt = null;
      }

      const [after] = await tx
        .update(correctiveActions)
        .set(patch)
        .where(eq(correctiveActions.id, before.id))
        .returning();
      if (!after) throw new Error("CORRECTIVE_ACTION_UPDATE_FAILED");

      if (before.status === "concluida" && after.status === "em_andamento" && before.nonconformityId) {
        const [linked] = await tx
          .select({ status: nonconformities.status })
          .from(nonconformities)
          .where(eq(nonconformities.id, before.nonconformityId))
          .limit(1);
        if (linked?.status === "resolvida") {
          await tx
            .update(nonconformities)
            .set({ status: "em_tratamento", resolvedAt: null, updatedAt: new Date() })
            .where(eq(nonconformities.id, before.nonconformityId));
        }
      }

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: before.status === "concluida" && after.status === "em_andamento"
            ? "corrective_action.reopened"
            : "corrective_action.updated",
          entityType: "corrective_action",
          entityId: before.id,
          before: {
            responsibleUserId: before.responsibleUserId,
            dueAt: before.dueAt?.toISOString() ?? null,
            priority: before.priority,
            status: before.status,
            notes: before.notes,
            completedAt: before.completedAt?.toISOString() ?? null,
          },
          after: {
            responsibleUserId: after.responsibleUserId,
            dueAt: after.dueAt?.toISOString() ?? null,
            priority: after.priority,
            status: after.status,
            notes: after.notes,
            completedAt: after.completedAt?.toISOString() ?? null,
          },
        }),
      );

      return { id: after.id, status: after.status };
    });
  });

export const completeProductionAction = createServerFn({ method: "POST" })
  .validator(actionIdSchema)
  .handler(async ({ data }) => {
    const session = await authorize(data, "actions.write");
    const db = getDb();

    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(correctiveActions)
        .where(
          and(
            eq(correctiveActions.id, data.actionId),
            eq(correctiveActions.organizationId, data.organizationId),
            eq(correctiveActions.facilityId, data.facilityId),
          ),
        )
        .limit(1);
      if (!before) throw new Error("NOT_FOUND:CORRECTIVE_ACTION");
      if (before.status === "cancelada") throw new Error("ACTION_CANCELLED");
      if (before.status === "concluida") return { id: before.id, status: before.status, completedAt: before.completedAt?.toISOString() ?? null };

      const evidenceRows = await tx
        .select({ id: evidenceLinks.id })
        .from(evidenceLinks)
        .where(
          and(
            eq(evidenceLinks.organizationId, data.organizationId),
            eq(evidenceLinks.correctiveActionId, before.id),
          ),
        );
      assertActionCanBeCompleted(evidenceRows.length);

      const completedAt = new Date();
      const [after] = await tx
        .update(correctiveActions)
        .set({ status: "concluida", completedAt, updatedAt: completedAt })
        .where(eq(correctiveActions.id, before.id))
        .returning();
      if (!after) throw new Error("CORRECTIVE_ACTION_COMPLETE_FAILED");

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "corrective_action.completed",
          entityType: "corrective_action",
          entityId: before.id,
          before: { status: before.status, completedAt: before.completedAt?.toISOString() ?? null },
          after: {
            status: after.status,
            completedAt: completedAt.toISOString(),
            evidenceCount: evidenceRows.length,
          },
        }),
      );

      return { id: after.id, status: after.status, completedAt: completedAt.toISOString() };
    });
  });

export const listProductionActionEvidence = createServerFn({ method: "GET" })
  .validator(actionIdSchema)
  .handler(async ({ data }) => {
    await authorize(data, "actions.read");
    const db = getDb();
    const [action] = await db
      .select({ id: correctiveActions.id })
      .from(correctiveActions)
      .where(
        and(
          eq(correctiveActions.id, data.actionId),
          eq(correctiveActions.organizationId, data.organizationId),
          eq(correctiveActions.facilityId, data.facilityId),
        ),
      )
      .limit(1);
    if (!action) throw new Error("NOT_FOUND:CORRECTIVE_ACTION");

    const rows = await db
      .select({
        id: evidences.id,
        name: evidences.name,
        description: evidences.description,
        type: evidences.type,
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
          eq(evidenceLinks.correctiveActionId, action.id),
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

export const getProductionActionEvidenceDownload = createServerFn({ method: "GET" })
  .validator(actionIdSchema.extend({ evidenceId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const session = await authorize(data, "actions.read");
    await requirePermission({
      userId: session.user.id,
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      permission: "evidence.read",
    });

    const db = getDb();
    const [row] = await db
      .select({
        evidenceId: evidences.id,
        actionId: correctiveActions.id,
        storageKey: evidences.storageKey,
        filename: evidences.originalFilename,
      })
      .from(evidenceLinks)
      .innerJoin(evidences, eq(evidences.id, evidenceLinks.evidenceId))
      .innerJoin(correctiveActions, eq(correctiveActions.id, evidenceLinks.correctiveActionId))
      .where(
        and(
          eq(evidenceLinks.organizationId, data.organizationId),
          eq(evidenceLinks.correctiveActionId, data.actionId),
          eq(evidenceLinks.evidenceId, data.evidenceId),
          eq(evidences.organizationId, data.organizationId),
          eq(evidences.facilityId, data.facilityId),
          eq(correctiveActions.organizationId, data.organizationId),
          eq(correctiveActions.facilityId, data.facilityId),
        ),
      )
      .limit(1);
    if (!row?.storageKey) throw new Error("NOT_FOUND:ACTION_EVIDENCE");

    const url = await createPrivateDownloadUrl(row.storageKey, 180);
    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      actorUserId: session.user.id,
      eventType: "corrective_action.evidence_downloaded",
      entityType: "evidence",
      entityId: row.evidenceId,
      metadata: { actionId: row.actionId, filename: row.filename },
    });

    return { url, filename: row.filename ?? "evidencia" };
  });
