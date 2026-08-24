import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { makeAuditEventValues } from "@/server/audit";
import { getDb } from "@/server/db/client";
import {
  auditEvents,
  inspectionItems,
  inspections,
  nonconformities,
  requirementSilos,
  requirementSources,
  requirements,
  requirementVersions,
  silos,
} from "@/server/db/schema";
import {
  inspectionChecklistSnapshots,
  requirementStates,
} from "@/server/db/schema.extensions";
import { requireSessionUser } from "@/server/session";

const scopeSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
});

const inspectionIdSchema = scopeSchema.extend({
  inspectionId: z.string().uuid(),
});

const createInspectionSchema = scopeSchema.extend({
  siloId: z.string().uuid(),
  type: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(5000).default(""),
});

const answerResultSchema = z.enum(["atendido", "pendente", "critico", "nao_aplicavel"]);

const saveInspectionAnswersSchema = inspectionIdSchema.extend({
  answers: z
    .array(
      z.object({
        requirementId: z.string().uuid(),
        result: answerResultSchema,
        notes: z.string().trim().max(5000).default(""),
      }),
    )
    .max(1000),
});

const checklistSnapshotSchema = z.object({
  code: z.string(),
  title: z.string(),
  category: z.string(),
  description: z.string(),
  severity: z.enum(["baixa", "media", "alta"]),
  evidenceRequired: z.boolean(),
  internalPeriodDays: z.number().int().nullable(),
  source: z.object({
    type: z.enum(["interno", "externa_nao_verificada", "externa_verificada"]).nullable(),
    title: z.string().nullable(),
    issuer: z.string().nullable(),
    version: z.string().nullable(),
    section: z.string().nullable(),
    officialUrl: z.string().nullable(),
    consultedAt: z.string().nullable(),
    verifiedBy: z.string().nullable(),
    verifiedAt: z.string().nullable(),
  }),
});

type ChecklistSnapshot = z.infer<typeof checklistSnapshotSchema>;

type InspectionPermission = "inspections.read" | "inspections.execute";

async function authorize(data: z.infer<typeof scopeSchema>, permission: InspectionPermission) {
  const session = await requireSessionUser();
  await requirePermission({
    userId: session.user.id,
    organizationId: data.organizationId,
    facilityId: data.facilityId,
    permission,
  });
  return session;
}

function makeInspectionCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `INSP-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function safeSnapshot(value: Record<string, unknown>): ChecklistSnapshot {
  const parsed = checklistSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_INSPECTION_SNAPSHOT");
  return parsed.data;
}

function severityForFinding(result: z.infer<typeof answerResultSchema>, snapshot: ChecklistSnapshot) {
  if (result === "critico") return "alta" as const;
  return snapshot.severity;
}

async function validateSilo(organizationId: string, facilityId: string, siloId: string) {
  const db = getDb();
  const [silo] = await db
    .select({ id: silos.id, name: silos.name, code: silos.code })
    .from(silos)
    .where(
      and(
        eq(silos.id, siloId),
        eq(silos.organizationId, organizationId),
        eq(silos.facilityId, facilityId),
        eq(silos.active, true),
      ),
    )
    .limit(1);

  if (!silo) throw new Error("NOT_FOUND:SILO");
  return silo;
}

export const listProductionInspections = createServerFn({ method: "GET" })
  .validator(scopeSchema)
  .handler(async ({ data }) => {
    await authorize(data, "inspections.read");
    const db = getDb();
    const rows = await db
      .select({
        id: inspections.id,
        code: inspections.code,
        siloId: inspections.siloId,
        siloCode: silos.code,
        siloName: silos.name,
        type: inspections.type,
        status: inspections.status,
        inspectorUserId: inspections.inspectorUserId,
        startedAt: inspections.startedAt,
        completedAt: inspections.completedAt,
        notes: inspections.notes,
        syncRevision: inspections.syncRevision,
      })
      .from(inspections)
      .innerJoin(silos, eq(silos.id, inspections.siloId))
      .where(
        and(
          eq(inspections.organizationId, data.organizationId),
          eq(inspections.facilityId, data.facilityId),
        ),
      )
      .orderBy(desc(inspections.startedAt));

    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const [items, findings] = await Promise.all([
      db
        .select({ inspectionId: inspectionItems.inspectionId, result: inspectionItems.result })
        .from(inspectionItems)
        .where(
          and(
            eq(inspectionItems.organizationId, data.organizationId),
            inArray(inspectionItems.inspectionId, ids),
          ),
        ),
      db
        .select({ inspectionId: nonconformities.inspectionId, status: nonconformities.status })
        .from(nonconformities)
        .where(
          and(
            eq(nonconformities.organizationId, data.organizationId),
            eq(nonconformities.facilityId, data.facilityId),
            inArray(nonconformities.inspectionId, ids),
          ),
        ),
    ]);

    return rows.map((row) => {
      const inspectionItemsForRow = items.filter((item) => item.inspectionId === row.id);
      const findingsForRow = findings.filter((item) => item.inspectionId === row.id);
      return {
        ...row,
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
        itemCount: inspectionItemsForRow.length,
        issueCount: inspectionItemsForRow.filter(
          (item) => item.result === "pendente" || item.result === "critico",
        ).length,
        openFindingCount: findingsForRow.filter(
          (item) => item.status !== "resolvida" && item.status !== "cancelada",
        ).length,
      };
    });
  });

export const getProductionInspection = createServerFn({ method: "GET" })
  .validator(inspectionIdSchema)
  .handler(async ({ data }) => {
    await authorize(data, "inspections.read");
    const db = getDb();

    const [inspection] = await db
      .select({
        id: inspections.id,
        code: inspections.code,
        siloId: inspections.siloId,
        siloCode: silos.code,
        siloName: silos.name,
        type: inspections.type,
        status: inspections.status,
        inspectorUserId: inspections.inspectorUserId,
        startedAt: inspections.startedAt,
        completedAt: inspections.completedAt,
        notes: inspections.notes,
        syncRevision: inspections.syncRevision,
      })
      .from(inspections)
      .innerJoin(silos, eq(silos.id, inspections.siloId))
      .where(
        and(
          eq(inspections.id, data.inspectionId),
          eq(inspections.organizationId, data.organizationId),
          eq(inspections.facilityId, data.facilityId),
        ),
      )
      .limit(1);

    if (!inspection) throw new Error("NOT_FOUND:INSPECTION");

    const [snapshots, answers, findings] = await Promise.all([
      db
        .select()
        .from(inspectionChecklistSnapshots)
        .where(
          and(
            eq(inspectionChecklistSnapshots.organizationId, data.organizationId),
            eq(inspectionChecklistSnapshots.inspectionId, inspection.id),
          ),
        )
        .orderBy(asc(inspectionChecklistSnapshots.ordinal)),
      db
        .select({
          id: inspectionItems.id,
          requirementId: inspectionItems.requirementId,
          requirementVersionId: inspectionItems.requirementVersionId,
          result: inspectionItems.result,
          notes: inspectionItems.notes,
          answeredBy: inspectionItems.answeredBy,
          answeredAt: inspectionItems.answeredAt,
        })
        .from(inspectionItems)
        .where(
          and(
            eq(inspectionItems.organizationId, data.organizationId),
            eq(inspectionItems.inspectionId, inspection.id),
          ),
        ),
      db
        .select({
          id: nonconformities.id,
          code: nonconformities.code,
          title: nonconformities.title,
          severity: nonconformities.severity,
          status: nonconformities.status,
          dueAt: nonconformities.dueAt,
        })
        .from(nonconformities)
        .where(
          and(
            eq(nonconformities.organizationId, data.organizationId),
            eq(nonconformities.facilityId, data.facilityId),
            eq(nonconformities.inspectionId, inspection.id),
          ),
        )
        .orderBy(nonconformities.code),
    ]);

    const answerByRequirement = new Map(answers.map((answer) => [answer.requirementId, answer]));
    const checklist = snapshots.map((row) => {
      const snapshot = safeSnapshot(row.snapshot);
      const answer = answerByRequirement.get(row.requirementId);
      return {
        requirementId: row.requirementId,
        requirementVersionId: row.requirementVersionId,
        ordinal: row.ordinal,
        ...snapshot,
        answer: answer
          ? {
              id: answer.id,
              result: answer.result,
              notes: answer.notes,
              answeredBy: answer.answeredBy,
              answeredAt: answer.answeredAt.toISOString(),
            }
          : null,
      };
    });

    return {
      ...inspection,
      startedAt: inspection.startedAt.toISOString(),
      completedAt: inspection.completedAt?.toISOString() ?? null,
      checklist,
      answeredCount: answers.length,
      findings: findings.map((finding) => ({
        ...finding,
        dueAt: finding.dueAt?.toISOString() ?? null,
      })),
    };
  });

export const createProductionInspection = createServerFn({ method: "POST" })
  .validator(createInspectionSchema)
  .handler(async ({ data }) => {
    const session = await authorize(data, "inspections.execute");
    await validateSilo(data.organizationId, data.facilityId, data.siloId);
    const db = getDb();
    const inspectionId = crypto.randomUUID();
    const code = makeInspectionCode();

    await db.transaction(async (tx) => {
      const checklistRows = await tx
        .select({
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
        .where(
          and(
            eq(requirementSilos.organizationId, data.organizationId),
            eq(requirementSilos.siloId, data.siloId),
            eq(requirements.organizationId, data.organizationId),
            eq(requirements.lifecycle, "publicado"),
          ),
        )
        .orderBy(requirements.code);

      if (checklistRows.length === 0) {
        throw new Error("INSPECTION_NO_PUBLISHED_CRITERIA");
      }

      await tx.insert(inspections).values({
        id: inspectionId,
        organizationId: data.organizationId,
        facilityId: data.facilityId,
        siloId: data.siloId,
        code,
        type: data.type,
        status: "em_andamento",
        inspectorUserId: session.user.id,
        notes: data.notes,
        syncRevision: 1,
      });

      await tx.insert(inspectionChecklistSnapshots).values(
        checklistRows.map((row, index) => ({
          organizationId: data.organizationId,
          inspectionId,
          requirementId: row.requirementId,
          requirementVersionId: row.requirementVersionId,
          ordinal: index + 1,
          snapshot: {
            code: row.code,
            title: row.title,
            category: row.category,
            description: row.description,
            severity: row.severity,
            evidenceRequired: row.evidenceRequired,
            internalPeriodDays: row.internalPeriodDays,
            source: {
              type: row.sourceType,
              title: row.sourceTitle,
              issuer: row.sourceIssuer,
              version: row.sourceVersion,
              section: row.sourceSection,
              officialUrl: row.sourceOfficialUrl,
              consultedAt: row.sourceConsultedAt?.toISOString() ?? null,
              verifiedBy: row.sourceVerifiedBy,
              verifiedAt: row.sourceVerifiedAt?.toISOString() ?? null,
            },
          } satisfies ChecklistSnapshot,
        })),
      );

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "inspection.started",
          entityType: "inspection",
          entityId: inspectionId,
          after: {
            code,
            siloId: data.siloId,
            type: data.type,
            checklistItems: checklistRows.length,
          },
        }),
      );
    });

    return { id: inspectionId, code };
  });

export const saveProductionInspectionAnswers = createServerFn({ method: "POST" })
  .validator(saveInspectionAnswersSchema)
  .handler(async ({ data }) => {
    const session = await authorize(data, "inspections.execute");
    const db = getDb();

    return db.transaction(async (tx) => {
      const [inspection] = await tx
        .select()
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
      if (inspection.status !== "em_andamento") throw new Error("INSPECTION_LOCKED");

      const snapshots = await tx
        .select()
        .from(inspectionChecklistSnapshots)
        .where(
          and(
            eq(inspectionChecklistSnapshots.organizationId, data.organizationId),
            eq(inspectionChecklistSnapshots.inspectionId, inspection.id),
          ),
        )
        .orderBy(asc(inspectionChecklistSnapshots.ordinal));

      const answerIds = data.answers.map((answer) => answer.requirementId);
      if (answerIds.length !== new Set(answerIds).size) throw new Error("DUPLICATE_INSPECTION_ANSWER");
      const snapshotByRequirement = new Map(snapshots.map((row) => [row.requirementId, row]));
      for (const answer of data.answers) {
        if (!snapshotByRequirement.has(answer.requirementId)) {
          throw new Error("INSPECTION_ANSWER_OUT_OF_SCOPE");
        }
      }

      await tx
        .delete(inspectionItems)
        .where(
          and(
            eq(inspectionItems.organizationId, data.organizationId),
            eq(inspectionItems.inspectionId, inspection.id),
          ),
        );

      if (data.answers.length > 0) {
        await tx.insert(inspectionItems).values(
          data.answers.map((answer) => {
            const snapshot = snapshotByRequirement.get(answer.requirementId)!;
            return {
              organizationId: data.organizationId,
              inspectionId: inspection.id,
              requirementId: answer.requirementId,
              requirementVersionId: snapshot.requirementVersionId,
              result: answer.result,
              notes: answer.notes,
              answeredBy: session.user.id,
              answeredAt: new Date(),
              snapshot: snapshot.snapshot,
            };
          }),
        );
      }

      const [updated] = await tx
        .update(inspections)
        .set({
          syncRevision: inspection.syncRevision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inspections.id, inspection.id),
            eq(inspections.syncRevision, inspection.syncRevision),
          ),
        )
        .returning({ syncRevision: inspections.syncRevision });
      if (!updated) throw new Error("INSPECTION_CONFLICT");

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "inspection.answers_saved",
          entityType: "inspection",
          entityId: inspection.id,
          after: {
            answeredItems: data.answers.length,
            checklistItems: snapshots.length,
            syncRevision: updated.syncRevision,
          },
        }),
      );

      return {
        syncRevision: updated.syncRevision,
        answeredCount: data.answers.length,
        checklistCount: snapshots.length,
        complete: data.answers.length === snapshots.length,
      };
    });
  });

export const finalizeProductionInspection = createServerFn({ method: "POST" })
  .validator(inspectionIdSchema)
  .handler(async ({ data }) => {
    const session = await authorize(data, "inspections.execute");
    const db = getDb();

    return db.transaction(async (tx) => {
      const [inspection] = await tx
        .select()
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
      if (inspection.status !== "em_andamento") throw new Error("INSPECTION_LOCKED");

      const [snapshots, answers] = await Promise.all([
        tx
          .select()
          .from(inspectionChecklistSnapshots)
          .where(
            and(
              eq(inspectionChecklistSnapshots.organizationId, data.organizationId),
              eq(inspectionChecklistSnapshots.inspectionId, inspection.id),
            ),
          )
          .orderBy(asc(inspectionChecklistSnapshots.ordinal)),
        tx
          .select()
          .from(inspectionItems)
          .where(
            and(
              eq(inspectionItems.organizationId, data.organizationId),
              eq(inspectionItems.inspectionId, inspection.id),
            ),
          ),
      ]);

      if (snapshots.length === 0 || answers.length !== snapshots.length) {
        throw new Error("INSPECTION_CHECKLIST_INCOMPLETE");
      }
      const answeredIds = new Set(answers.map((answer) => answer.requirementId));
      if (snapshots.some((snapshot) => !answeredIds.has(snapshot.requirementId))) {
        throw new Error("INSPECTION_CHECKLIST_INCOMPLETE");
      }

      for (const answer of answers) {
        const [currentState] = await tx
          .select()
          .from(requirementStates)
          .where(
            and(
              eq(requirementStates.organizationId, data.organizationId),
              eq(requirementStates.facilityId, data.facilityId),
              eq(requirementStates.requirementId, answer.requirementId),
              eq(requirementStates.siloId, inspection.siloId),
            ),
          )
          .limit(1);

        const applicable = answer.result !== "nao_aplicavel";
        if (currentState) {
          await tx
            .update(requirementStates)
            .set({
              applicable,
              status: answer.result,
              lastAssessedAt: new Date(),
              updatedBy: session.user.id,
              revision: currentState.revision + 1,
              updatedAt: new Date(),
            })
            .where(eq(requirementStates.id, currentState.id));
        } else {
          await tx.insert(requirementStates).values({
            organizationId: data.organizationId,
            facilityId: data.facilityId,
            requirementId: answer.requirementId,
            siloId: inspection.siloId,
            applicable,
            status: answer.result,
            lastAssessedAt: new Date(),
            updatedBy: session.user.id,
          });
        }
      }

      const snapshotByRequirement = new Map(snapshots.map((row) => [row.requirementId, row]));
      const issueAnswers = answers.filter(
        (answer) => answer.result === "pendente" || answer.result === "critico",
      );

      if (issueAnswers.length > 0) {
        await tx.insert(nonconformities).values(
          issueAnswers.map((answer, index) => {
            const snapshotRow = snapshotByRequirement.get(answer.requirementId)!;
            const snapshot = safeSnapshot(snapshotRow.snapshot);
            return {
              organizationId: data.organizationId,
              facilityId: data.facilityId,
              siloId: inspection.siloId,
              requirementId: answer.requirementId,
              inspectionId: inspection.id,
              code: `NC-${inspection.code}-${String(index + 1).padStart(2, "0")}`,
              title: `${snapshot.code} — ${snapshot.title}`,
              description:
                answer.notes ||
                `Resultado ${answer.result} registrado na inspeção ${inspection.code}.`,
              severity: severityForFinding(answer.result, snapshot),
              status: "aberta" as const,
            };
          }),
        );
      }

      const completedAt = new Date();
      const [updated] = await tx
        .update(inspections)
        .set({
          status: "concluida",
          completedAt,
          syncRevision: inspection.syncRevision + 1,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(inspections.id, inspection.id),
            eq(inspections.syncRevision, inspection.syncRevision),
          ),
        )
        .returning({ syncRevision: inspections.syncRevision });
      if (!updated) throw new Error("INSPECTION_CONFLICT");

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "inspection.completed",
          entityType: "inspection",
          entityId: inspection.id,
          before: { status: inspection.status, syncRevision: inspection.syncRevision },
          after: {
            status: "concluida",
            syncRevision: updated.syncRevision,
            checklistItems: snapshots.length,
            findingsCreated: issueAnswers.length,
            completedAt: completedAt.toISOString(),
          },
        }),
      );

      return {
        status: "concluida" as const,
        syncRevision: updated.syncRevision,
        findingsCreated: issueAnswers.length,
        completedAt: completedAt.toISOString(),
      };
    });
  });
