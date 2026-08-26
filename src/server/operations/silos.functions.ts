import { and, desc, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { writeAuditEvent } from "@/server/audit";
import { getDb } from "@/server/db/client";
import { correctiveActions, inspections, silos } from "@/server/db/schema";
import { requirementStates } from "@/server/db/schema.extensions";
import { requireSessionUser } from "@/server/session";

const scopeSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
});

const siloFieldsSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  type: z.string().trim().min(1).max(120),
  capacityTonnes: z.number().int().min(0).max(5_000_000),
  inspectionPeriodDays: z.number().int().min(1).max(3650),
  notes: z.string().trim().max(5000).default(""),
});

const createSiloInput = scopeSchema.extend({ silo: siloFieldsSchema });
const updateSiloInput = scopeSchema.extend({
  siloId: z.string().uuid(),
  silo: siloFieldsSchema.partial(),
});
const archiveSiloInput = scopeSchema.extend({ siloId: z.string().uuid() });

async function authorize(input: z.infer<typeof scopeSchema>, permission: "silos.read" | "silos.write") {
  const session = await requireSessionUser();
  await requirePermission({
    userId: session.user.id,
    organizationId: input.organizationId,
    facilityId: input.facilityId,
    permission,
  });
  return session;
}

export const listProductionSilos = createServerFn({ method: "GET" })
  .validator(scopeSchema)
  .handler(async ({ data }) => {
    await authorize(data, "silos.read");
    const db = getDb();

    const [siloRows, stateRows, inspectionRows, actionRows] = await Promise.all([
      db
        .select()
        .from(silos)
        .where(
          and(
            eq(silos.organizationId, data.organizationId),
            eq(silos.facilityId, data.facilityId),
            eq(silos.active, true),
          ),
        )
        .orderBy(silos.code),
      db
        .select({
          siloId: requirementStates.siloId,
          applicable: requirementStates.applicable,
          status: requirementStates.status,
        })
        .from(requirementStates)
        .where(
          and(
            eq(requirementStates.organizationId, data.organizationId),
            eq(requirementStates.facilityId, data.facilityId),
          ),
        ),
      db
        .select({
          siloId: inspections.siloId,
          completedAt: inspections.completedAt,
          startedAt: inspections.startedAt,
          status: inspections.status,
        })
        .from(inspections)
        .where(
          and(
            eq(inspections.organizationId, data.organizationId),
            eq(inspections.facilityId, data.facilityId),
          ),
        )
        .orderBy(desc(inspections.startedAt)),
      db
        .select({
          siloId: correctiveActions.siloId,
          title: correctiveActions.title,
          dueAt: correctiveActions.dueAt,
          status: correctiveActions.status,
        })
        .from(correctiveActions)
        .where(
          and(
            eq(correctiveActions.organizationId, data.organizationId),
            eq(correctiveActions.facilityId, data.facilityId),
          ),
        ),
    ]);

    return siloRows.map((silo) => {
      const scopedStates = stateRows.filter((item) => item.siloId === silo.id && item.applicable);
      const applicableStates = scopedStates.filter((item) => item.status !== "nao_aplicavel");
      const attended = applicableStates.filter((item) => item.status === "atendido").length;
      const pending = applicableStates.filter((item) => item.status === "pendente").length;
      const critical = applicableStates.filter((item) => item.status === "critico").length;
      const total = applicableStates.length;
      const readiness = total === 0 ? 0 : Math.round((attended / total) * 100);
      const status = critical > 0 || (total > 0 && readiness < 60) ? "critico" : readiness < 90 ? "atencao" : "bom";

      const latestInspection = inspectionRows.find(
        (item) => item.siloId === silo.id && item.status === "concluida",
      );
      const openActions = actionRows
        .filter(
          (item) =>
            item.siloId === silo.id &&
            item.status !== "concluida" &&
            item.status !== "cancelada",
        )
        .sort((a, b) => {
          if (!a.dueAt && !b.dueAt) return 0;
          if (!a.dueAt) return 1;
          if (!b.dueAt) return -1;
          return a.dueAt.getTime() - b.dueAt.getTime();
        });

      return {
        id: silo.id,
        code: silo.code,
        name: silo.name,
        type: silo.type,
        capacityTonnes: silo.capacityTonnes,
        inspectionPeriodDays: silo.inspectionPeriodDays,
        notes: silo.notes,
        readiness,
        pending,
        critical,
        status,
        lastInspectionAt: latestInspection?.completedAt?.toISOString() ?? null,
        nextAction: openActions[0]
          ? {
              title: openActions[0].title,
              dueAt: openActions[0].dueAt?.toISOString() ?? null,
            }
          : null,
      };
    });
  });

export const createProductionSilo = createServerFn({ method: "POST" })
  .validator(createSiloInput)
  .handler(async ({ data }) => {
    const session = await authorize(data, "silos.write");
    const db = getDb();
    const [created] = await db
      .insert(silos)
      .values({
        organizationId: data.organizationId,
        facilityId: data.facilityId,
        code: data.silo.code,
        name: data.silo.name,
        type: data.silo.type,
        capacityTonnes: data.silo.capacityTonnes,
        inspectionPeriodDays: data.silo.inspectionPeriodDays,
        notes: data.silo.notes,
      })
      .returning();

    if (!created) throw new Error("SILO_CREATE_FAILED");

    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      actorUserId: session.user.id,
      eventType: "silo.created",
      entityType: "silo",
      entityId: created.id,
      after: {
        code: created.code,
        name: created.name,
        type: created.type,
        capacityTonnes: created.capacityTonnes,
        inspectionPeriodDays: created.inspectionPeriodDays,
      },
    });

    return { id: created.id };
  });

export const updateProductionSilo = createServerFn({ method: "POST" })
  .validator(updateSiloInput)
  .handler(async ({ data }) => {
    const session = await authorize(data, "silos.write");
    const db = getDb();
    const [before] = await db
      .select()
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

    if (!before) throw new Error("NOT_FOUND:SILO");

    const [after] = await db
      .update(silos)
      .set({ ...data.silo, updatedAt: new Date() })
      .where(eq(silos.id, before.id))
      .returning();

    if (!after) throw new Error("SILO_UPDATE_FAILED");

    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      actorUserId: session.user.id,
      eventType: "silo.updated",
      entityType: "silo",
      entityId: after.id,
      before: {
        code: before.code,
        name: before.name,
        type: before.type,
        capacityTonnes: before.capacityTonnes,
        inspectionPeriodDays: before.inspectionPeriodDays,
        notes: before.notes,
      },
      after: {
        code: after.code,
        name: after.name,
        type: after.type,
        capacityTonnes: after.capacityTonnes,
        inspectionPeriodDays: after.inspectionPeriodDays,
        notes: after.notes,
      },
    });

    return { id: after.id };
  });

export const archiveProductionSilo = createServerFn({ method: "POST" })
  .validator(archiveSiloInput)
  .handler(async ({ data }) => {
    const session = await authorize(data, "silos.write");
    const db = getDb();
    const [before] = await db
      .select()
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

    if (!before) throw new Error("NOT_FOUND:SILO");

    await db.update(silos).set({ active: false, updatedAt: new Date() }).where(eq(silos.id, before.id));
    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      actorUserId: session.user.id,
      eventType: "silo.archived",
      entityType: "silo",
      entityId: before.id,
      before: { active: true, code: before.code, name: before.name },
      after: { active: false, code: before.code, name: before.name },
    });

    return { ok: true };
  });
