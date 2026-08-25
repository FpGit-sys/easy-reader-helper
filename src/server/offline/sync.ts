import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { makeAuditEventValues } from "@/server/audit";
import { getDb } from "@/server/db/client";
import {
  auditEvents,
  evidenceLinks,
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
  offlineSyncReceipts,
  requirementStates,
} from "@/server/db/schema.extensions";
import { type DeviceContext } from "./device-auth";

const answerResultSchema = z.enum(["atendido", "pendente", "critico", "nao_aplicavel"]);

const checklistPairSchema = z.object({
  requirementId: z.string().uuid(),
  requirementVersionId: z.string().uuid(),
});

const answerSchema = z.object({
  requirementId: z.string().uuid(),
  result: answerResultSchema,
  notes: z.string().trim().max(5000).default(""),
  answeredAt: z.string().datetime().optional(),
});

const inspectionSnapshotPayloadSchema = z.object({
  siloId: z.string().uuid(),
  inspectionType: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(5000).default(""),
  startedAt: z.string().datetime(),
  baseRevision: z.number().int().min(0),
  finalize: z.boolean().default(false),
  checklist: z.array(checklistPairSchema).min(1).max(1000),
  answers: z.array(answerSchema).max(1000),
});

export const offlineEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal("inspection.snapshot"),
  entityId: z.string().uuid(),
  createdAt: z.string().datetime(),
  payload: inspectionSnapshotPayloadSchema,
});

export type OfflineEvent = z.infer<typeof offlineEventSchema>;

type SyncResult = {
  eventId: string;
  entityId: string;
  status: "applied" | "conflict" | "rejected";
  code?: string;
  serverRevision?: number;
  inspectionStatus?: "em_andamento" | "concluida" | "cancelada";
  findingsCreated?: number;
};

type ChecklistSnapshot = {
  code: string;
  title: string;
  category: string;
  description: string;
  severity: "baixa" | "media" | "alta";
  evidenceRequired: boolean;
  internalPeriodDays: number | null;
  source: {
    type: "interno" | "externa_nao_verificada" | "externa_verificada" | null;
    title: string | null;
    issuer: string | null;
    version: string | null;
    section: string | null;
    officialUrl: string | null;
    consultedAt: string | null;
    verifiedBy: string | null;
    verifiedAt: string | null;
  };
};

function inspectionCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `OFF-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function duplicateValues(values: string[]) {
  return values.length !== new Set(values).size;
}

function severityForFinding(
  result: z.infer<typeof answerResultSchema>,
  snapshot: ChecklistSnapshot,
) {
  if (result === "critico") return "alta" as const;
  return snapshot.severity;
}

function knownSyncError(message: string): SyncResult["status"] | null {
  if (
    message === "INSPECTION_CONFLICT" ||
    message === "INSPECTION_LOCKED" ||
    message === "OFFLINE_CHECKLIST_STALE" ||
    message === "OFFLINE_DEVICE_OWNERSHIP_CONFLICT"
  ) {
    return "conflict";
  }
  if (
    message === "NOT_FOUND:SILO" ||
    message === "OFFLINE_CHECKLIST_INVALID" ||
    message === "INSPECTION_CHECKLIST_INCOMPLETE" ||
    message.startsWith("INSPECTION_REQUIRED_EVIDENCE_MISSING") ||
    message === "DUPLICATE_INSPECTION_ANSWER"
  ) {
    return "rejected";
  }
  return null;
}

export async function applyOfflineEvent(ctx: DeviceContext, event: OfflineEvent): Promise<SyncResult> {
  const db = getDb();
  const [receipt] = await db
    .select({ result: offlineSyncReceipts.result })
    .from(offlineSyncReceipts)
    .where(
      and(
        eq(offlineSyncReceipts.deviceId, ctx.deviceId),
        eq(offlineSyncReceipts.eventId, event.id),
      ),
    )
    .limit(1);
  if (receipt) return receipt.result as SyncResult;

  try {
    const result = await applyInspectionSnapshot(ctx, event);
    await db.insert(offlineSyncReceipts).values({
      organizationId: ctx.organizationId,
      facilityId: ctx.facilityId,
      deviceId: ctx.deviceId,
      eventId: event.id,
      eventType: event.type,
      entityId: event.entityId,
      result,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "OFFLINE_SYNC_FAILED";
    const status = knownSyncError(message);
    if (!status) throw error;
    const result: SyncResult = {
      eventId: event.id,
      entityId: event.entityId,
      status,
      code: message,
    };
    await db.insert(offlineSyncReceipts).values({
      organizationId: ctx.organizationId,
      facilityId: ctx.facilityId,
      deviceId: ctx.deviceId,
      eventId: event.id,
      eventType: event.type,
      entityId: event.entityId,
      result,
    });
    return result;
  }
}

async function applyInspectionSnapshot(ctx: DeviceContext, event: OfflineEvent): Promise<SyncResult> {
  const payload = event.payload;
  if (duplicateValues(payload.checklist.map((item) => item.requirementId))) {
    throw new Error("OFFLINE_CHECKLIST_INVALID");
  }
  if (duplicateValues(payload.answers.map((item) => item.requirementId))) {
    throw new Error("DUPLICATE_INSPECTION_ANSWER");
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    const [silo] = await tx
      .select({ id: silos.id })
      .from(silos)
      .where(
        and(
          eq(silos.id, payload.siloId),
          eq(silos.organizationId, ctx.organizationId),
          eq(silos.facilityId, ctx.facilityId),
          eq(silos.active, true),
        ),
      )
      .limit(1);
    if (!silo) throw new Error("NOT_FOUND:SILO");

    let [inspection] = await tx
      .select()
      .from(inspections)
      .where(
        and(
          eq(inspections.id, event.entityId),
          eq(inspections.organizationId, ctx.organizationId),
          eq(inspections.facilityId, ctx.facilityId),
        ),
      )
      .limit(1);

    let snapshots: Array<typeof inspectionChecklistSnapshots.$inferSelect> = [];
    let created = false;

    if (!inspection) {
      if (payload.baseRevision !== 0) throw new Error("INSPECTION_CONFLICT");
      const checklistRows = await loadCurrentChecklist(tx, ctx.organizationId, payload.siloId);
      assertChecklistMatches(payload.checklist, checklistRows);

      const code = inspectionCode();
      const startedAt = new Date(payload.startedAt);
      await tx.insert(inspections).values({
        id: event.entityId,
        organizationId: ctx.organizationId,
        facilityId: ctx.facilityId,
        siloId: payload.siloId,
        code,
        type: payload.inspectionType,
        status: "em_andamento",
        inspectorUserId: ctx.userId,
        startedAt,
        notes: payload.notes,
        deviceId: ctx.deviceId,
        syncRevision: 1,
      });

      await tx.insert(inspectionChecklistSnapshots).values(
        checklistRows.map((row, index) => ({
          organizationId: ctx.organizationId,
          inspectionId: event.entityId,
          requirementId: row.requirementId,
          requirementVersionId: row.requirementVersionId,
          ordinal: index + 1,
          snapshot: makeSnapshot(row),
        })),
      );

      [inspection] = await tx
        .select()
        .from(inspections)
        .where(eq(inspections.id, event.entityId))
        .limit(1);
      created = true;
    }

    if (!inspection) throw new Error("INSPECTION_CONFLICT");
    if (inspection.deviceId !== ctx.deviceId || inspection.inspectorUserId !== ctx.userId) {
      throw new Error("OFFLINE_DEVICE_OWNERSHIP_CONFLICT");
    }
    if (inspection.status !== "em_andamento") throw new Error("INSPECTION_LOCKED");
    if (!created && inspection.syncRevision !== payload.baseRevision) {
      throw new Error("INSPECTION_CONFLICT");
    }
    if (inspection.siloId !== payload.siloId) throw new Error("INSPECTION_CONFLICT");

    snapshots = await tx
      .select()
      .from(inspectionChecklistSnapshots)
      .where(
        and(
          eq(inspectionChecklistSnapshots.organizationId, ctx.organizationId),
          eq(inspectionChecklistSnapshots.inspectionId, inspection.id),
        ),
      )
      .orderBy(asc(inspectionChecklistSnapshots.ordinal));
    assertChecklistMatches(
      payload.checklist,
      snapshots.map((row) => ({
        requirementId: row.requirementId,
        requirementVersionId: row.requirementVersionId,
      })),
    );

    const snapshotByRequirement = new Map(snapshots.map((row) => [row.requirementId, row]));
    for (const answer of payload.answers) {
      if (!snapshotByRequirement.has(answer.requirementId)) {
        throw new Error("OFFLINE_CHECKLIST_INVALID");
      }
    }

    await tx
      .delete(inspectionItems)
      .where(
        and(
          eq(inspectionItems.organizationId, ctx.organizationId),
          eq(inspectionItems.inspectionId, inspection.id),
        ),
      );

    if (payload.answers.length > 0) {
      await tx.insert(inspectionItems).values(
        payload.answers.map((answer) => {
          const snapshotRow = snapshotByRequirement.get(answer.requirementId)!;
          return {
            organizationId: ctx.organizationId,
            inspectionId: inspection!.id,
            requirementId: answer.requirementId,
            requirementVersionId: snapshotRow.requirementVersionId,
            result: answer.result,
            notes: answer.notes,
            answeredBy: ctx.userId,
            answeredAt: answer.answeredAt ? new Date(answer.answeredAt) : new Date(event.createdAt),
            snapshot: snapshotRow.snapshot,
          };
        }),
      );
    }

    let findingsCreated = 0;
    let nextStatus: "em_andamento" | "concluida" = "em_andamento";
    let completedAt: Date | null = null;

    if (payload.finalize) {
      if (payload.answers.length !== snapshots.length) {
        throw new Error("INSPECTION_CHECKLIST_INCOMPLETE");
      }
      const answerByRequirement = new Map(
        payload.answers.map((answer) => [answer.requirementId, answer]),
      );
      if (snapshots.some((snapshot) => !answerByRequirement.has(snapshot.requirementId))) {
        throw new Error("INSPECTION_CHECKLIST_INCOMPLETE");
      }

      const linkedEvidence = await tx
        .select({ requirementId: evidenceLinks.requirementId })
        .from(evidenceLinks)
        .where(
          and(
            eq(evidenceLinks.organizationId, ctx.organizationId),
            eq(evidenceLinks.inspectionId, inspection.id),
          ),
        );
      const evidenceRequirements = new Set(
        linkedEvidence
          .map((row) => row.requirementId)
          .filter((value): value is string => Boolean(value)),
      );
      const missingEvidence = snapshots
        .filter((row) => {
          const snapshot = row.snapshot as ChecklistSnapshot;
          const answer = answerByRequirement.get(row.requirementId)!;
          return (
            snapshot.evidenceRequired &&
            answer.result !== "nao_aplicavel" &&
            !evidenceRequirements.has(row.requirementId)
          );
        })
        .map((row) => (row.snapshot as ChecklistSnapshot).code);
      if (missingEvidence.length > 0) {
        throw new Error(`INSPECTION_REQUIRED_EVIDENCE_MISSING:${missingEvidence.join(",")}`);
      }

      for (const answer of payload.answers) {
        const [current] = await tx
          .select()
          .from(requirementStates)
          .where(
            and(
              eq(requirementStates.organizationId, ctx.organizationId),
              eq(requirementStates.facilityId, ctx.facilityId),
              eq(requirementStates.requirementId, answer.requirementId),
              eq(requirementStates.siloId, inspection.siloId),
            ),
          )
          .limit(1);
        const applicable = answer.result !== "nao_aplicavel";
        if (current) {
          await tx
            .update(requirementStates)
            .set({
              applicable,
              status: answer.result,
              lastAssessedAt: new Date(answer.answeredAt ?? event.createdAt),
              updatedBy: ctx.userId,
              revision: current.revision + 1,
              updatedAt: new Date(),
            })
            .where(eq(requirementStates.id, current.id));
        } else {
          await tx.insert(requirementStates).values({
            organizationId: ctx.organizationId,
            facilityId: ctx.facilityId,
            requirementId: answer.requirementId,
            siloId: inspection.siloId,
            applicable,
            status: answer.result,
            lastAssessedAt: new Date(answer.answeredAt ?? event.createdAt),
            updatedBy: ctx.userId,
          });
        }
      }

      const issueAnswers = payload.answers.filter(
        (answer) => answer.result === "pendente" || answer.result === "critico",
      );
      if (issueAnswers.length > 0) {
        await tx.insert(nonconformities).values(
          issueAnswers.map((answer, index) => {
            const row = snapshotByRequirement.get(answer.requirementId)!;
            const snapshot = row.snapshot as ChecklistSnapshot;
            return {
              organizationId: ctx.organizationId,
              facilityId: ctx.facilityId,
              siloId: inspection!.siloId,
              requirementId: answer.requirementId,
              inspectionId: inspection!.id,
              code: `NC-${inspection!.code}-${String(index + 1).padStart(2, "0")}`,
              title: `${snapshot.code} — ${snapshot.title}`,
              description:
                answer.notes ||
                `Resultado ${answer.result} registrado em inspeção sincronizada do modo offline.`,
              severity: severityForFinding(answer.result, snapshot),
              status: "aberta" as const,
            };
          }),
        );
      }
      findingsCreated = issueAnswers.length;
      nextStatus = "concluida";
      completedAt = new Date(event.createdAt);
    }

    const nextRevision = created ? 1 : inspection.syncRevision + 1;
    const [updated] = await tx
      .update(inspections)
      .set({
        type: payload.inspectionType,
        notes: payload.notes,
        status: nextStatus,
        completedAt,
        syncRevision: nextRevision,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inspections.id, inspection.id),
          eq(inspections.syncRevision, inspection.syncRevision),
        ),
      )
      .returning({ syncRevision: inspections.syncRevision, status: inspections.status });
    if (!updated) throw new Error("INSPECTION_CONFLICT");

    await tx.insert(auditEvents).values(
      makeAuditEventValues({
        organizationId: ctx.organizationId,
        facilityId: ctx.facilityId,
        actorUserId: ctx.userId,
        eventType: payload.finalize
          ? "inspection.offline_completed"
          : created
            ? "inspection.offline_created"
            : "inspection.offline_synced",
        entityType: "inspection",
        entityId: inspection.id,
        before: created
          ? null
          : { status: inspection.status, syncRevision: inspection.syncRevision },
        after: {
          deviceId: ctx.deviceId,
          status: updated.status,
          syncRevision: updated.syncRevision,
          answers: payload.answers.length,
          checklistItems: snapshots.length,
          findingsCreated,
          clientEventId: event.id,
          clientCreatedAt: event.createdAt,
        },
        metadata: { source: "desktop-offline-sync" },
      }),
    );

    return {
      eventId: event.id,
      entityId: inspection.id,
      status: "applied" as const,
      serverRevision: updated.syncRevision,
      inspectionStatus: updated.status,
      findingsCreated,
    };
  });
}

async function loadCurrentChecklist(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  organizationId: string,
  siloId: string,
) {
  return tx
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
        eq(requirementSilos.organizationId, organizationId),
        eq(requirementSilos.siloId, siloId),
        eq(requirements.organizationId, organizationId),
        eq(requirements.lifecycle, "publicado"),
      ),
    )
    .orderBy(asc(requirements.code));
}

function assertChecklistMatches(
  client: Array<{ requirementId: string; requirementVersionId: string }>,
  server: Array<{ requirementId: string; requirementVersionId: string }>,
) {
  if (client.length !== server.length) throw new Error("OFFLINE_CHECKLIST_STALE");
  const serverPairs = new Set(
    server.map((item) => `${item.requirementId}:${item.requirementVersionId}`),
  );
  if (
    client.some(
      (item) => !serverPairs.has(`${item.requirementId}:${item.requirementVersionId}`),
    )
  ) {
    throw new Error("OFFLINE_CHECKLIST_STALE");
  }
}

function makeSnapshot(row: Awaited<ReturnType<typeof loadCurrentChecklist>>[number]): ChecklistSnapshot {
  return {
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
  };
}
