import { and, desc, eq, inArray } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { canTransitionNonconformity, assertNonconformityCanBeResolved } from "@/lib/workflow/corrective";
import { requirePermission } from "@/server/access";
import { assertAssignableUser } from "@/server/assignees";
import { makeAuditEventValues } from "@/server/audit";
import { getDb } from "@/server/db/client";
import { auditEvents, correctiveActions, nonconformities, silos } from "@/server/db/schema";
import { requireSessionUser } from "@/server/session";

const scopeSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
});

const nonconformityIdSchema = scopeSchema.extend({
  nonconformityId: z.string().uuid(),
});

const updateSchema = nonconformityIdSchema.extend({
  status: z.enum(["aberta", "em_tratamento", "resolvida", "cancelada"]).optional(),
  responsibleUserId: z.string().min(1).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

type Permission = "nonconformities.read" | "nonconformities.write";

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

export const listProductionNonconformities = createServerFn({ method: "GET" })
  .validator(scopeSchema)
  .handler(async ({ data }) => {
    await authorize(data, "nonconformities.read");
    const db = getDb();
    const rows = await db
      .select({
        id: nonconformities.id,
        code: nonconformities.code,
        title: nonconformities.title,
        description: nonconformities.description,
        siloId: nonconformities.siloId,
        siloCode: silos.code,
        siloName: silos.name,
        requirementId: nonconformities.requirementId,
        inspectionId: nonconformities.inspectionId,
        severity: nonconformities.severity,
        status: nonconformities.status,
        responsibleUserId: nonconformities.responsibleUserId,
        dueAt: nonconformities.dueAt,
        resolvedAt: nonconformities.resolvedAt,
        createdAt: nonconformities.createdAt,
        updatedAt: nonconformities.updatedAt,
      })
      .from(nonconformities)
      .leftJoin(silos, eq(silos.id, nonconformities.siloId))
      .where(
        and(
          eq(nonconformities.organizationId, data.organizationId),
          eq(nonconformities.facilityId, data.facilityId),
        ),
      )
      .orderBy(desc(nonconformities.createdAt));

    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const actions = await db
      .select({
        nonconformityId: correctiveActions.nonconformityId,
        id: correctiveActions.id,
        status: correctiveActions.status,
      })
      .from(correctiveActions)
      .where(
        and(
          eq(correctiveActions.organizationId, data.organizationId),
          eq(correctiveActions.facilityId, data.facilityId),
          inArray(correctiveActions.nonconformityId, ids),
        ),
      );

    const now = Date.now();
    return rows.map((row) => {
      const linked = actions.filter((action) => action.nonconformityId === row.id && action.status !== "cancelada");
      const open = linked.filter((action) => action.status !== "concluida");
      return {
        ...row,
        dueAt: row.dueAt?.toISOString() ?? null,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        actionCount: linked.length,
        openActionCount: open.length,
        overdue:
          Boolean(row.dueAt) &&
          row.dueAt!.getTime() < now &&
          row.status !== "resolvida" &&
          row.status !== "cancelada",
      };
    });
  });

export const updateProductionNonconformity = createServerFn({ method: "POST" })
  .validator(updateSchema)
  .handler(async ({ data }) => {
    const session = await authorize(data, "nonconformities.write");
    if (data.responsibleUserId !== undefined) {
      await assertAssignableUser({
        organizationId: data.organizationId,
        facilityId: data.facilityId,
        userId: data.responsibleUserId,
      });
    }

    const db = getDb();
    return db.transaction(async (tx) => {
      const [before] = await tx
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
      if (!before) throw new Error("NOT_FOUND:NONCONFORMITY");

      if (data.status && !canTransitionNonconformity(before.status, data.status)) {
        throw new Error(`INVALID_NONCONFORMITY_TRANSITION:${before.status}:${data.status}`);
      }

      if (data.status === "resolvida") {
        const linkedActions = await tx
          .select({ status: correctiveActions.status })
          .from(correctiveActions)
          .where(
            and(
              eq(correctiveActions.organizationId, data.organizationId),
              eq(correctiveActions.facilityId, data.facilityId),
              eq(correctiveActions.nonconformityId, before.id),
            ),
          );
        const activeActions = linkedActions.filter((action) => action.status !== "cancelada");
        assertNonconformityCanBeResolved({
          linkedActionCount: activeActions.length,
          openActionCount: activeActions.filter((action) => action.status !== "concluida").length,
        });
      }

      const patch: Partial<typeof nonconformities.$inferInsert> = { updatedAt: new Date() };
      if (data.status !== undefined) {
        patch.status = data.status;
        patch.resolvedAt = data.status === "resolvida" ? new Date() : null;
      }
      if (data.responsibleUserId !== undefined) patch.responsibleUserId = data.responsibleUserId;
      if (data.dueAt !== undefined) patch.dueAt = data.dueAt ? new Date(data.dueAt) : null;

      const [after] = await tx
        .update(nonconformities)
        .set(patch)
        .where(eq(nonconformities.id, before.id))
        .returning();
      if (!after) throw new Error("NONCONFORMITY_UPDATE_FAILED");

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "nonconformity.updated",
          entityType: "nonconformity",
          entityId: before.id,
          before: {
            status: before.status,
            responsibleUserId: before.responsibleUserId,
            dueAt: before.dueAt?.toISOString() ?? null,
            resolvedAt: before.resolvedAt?.toISOString() ?? null,
          },
          after: {
            status: after.status,
            responsibleUserId: after.responsibleUserId,
            dueAt: after.dueAt?.toISOString() ?? null,
            resolvedAt: after.resolvedAt?.toISOString() ?? null,
          },
        }),
      );

      return {
        id: after.id,
        status: after.status,
        resolvedAt: after.resolvedAt?.toISOString() ?? null,
      };
    });
  });
