import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { makeAuditEventValues } from "@/server/audit";
import { getDb } from "@/server/db/client";
import {
  auditEvents,
  requirementSilos,
  requirementSources,
  requirements,
  requirementVersions,
  silos,
} from "@/server/db/schema";
import { requirementStates } from "@/server/db/schema.extensions";
import { requireSessionUser } from "@/server/session";

const sourceTypeSchema = z.enum(["interno", "externa_nao_verificada", "externa_verificada"]);
const severitySchema = z.enum(["baixa", "media", "alta"]);
const lifecycleSchema = z.enum(["rascunho", "em_revisao", "validado", "publicado", "obsoleto"]);

const scopeSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
});

const sourceSchema = z
  .object({
    type: sourceTypeSchema,
    title: z.string().trim().min(1).max(240),
    issuer: z.string().trim().max(200).nullable(),
    version: z.string().trim().max(120).nullable(),
    section: z.string().trim().max(160).nullable(),
    officialUrl: z.string().url().max(1000).nullable(),
    consultedAt: z.string().datetime().nullable(),
    notes: z.string().trim().max(5000).default(""),
  })
  .superRefine((source, ctx) => {
    if (source.type !== "externa_verificada") return;
    const required: Array<[keyof typeof source, string]> = [
      ["issuer", "Informe o órgão/emissor da fonte verificada."],
      ["version", "Informe a versão/data de referência da fonte verificada."],
      ["section", "Informe o item, seção ou referência da fonte verificada."],
      ["officialUrl", "Informe a URL oficial da fonte verificada."],
      ["consultedAt", "Informe a data em que a fonte oficial foi consultada."],
    ];
    for (const [field, message] of required) {
      if (!source[field]) {
        ctx.addIssue({ code: "custom", path: [field], message });
      }
    }
  });

const versionInputSchema = z.object({
  description: z.string().trim().min(1).max(10_000),
  severity: severitySchema,
  evidenceRequired: z.boolean(),
  internalPeriodDays: z.number().int().min(1).max(3650).nullable(),
  source: sourceSchema,
});

const createInputSchema = scopeSchema.extend({
  code: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(240),
  category: z.string().trim().min(1).max(160),
  siloIds: z.array(z.string().uuid()).max(500).default([]),
  version: versionInputSchema,
});

const reviseInputSchema = scopeSchema.extend({
  requirementId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  category: z.string().trim().min(1).max(160),
  siloIds: z.array(z.string().uuid()).max(500).default([]),
  version: versionInputSchema,
});

const transitionInputSchema = scopeSchema.extend({
  requirementId: z.string().uuid(),
  target: lifecycleSchema,
});

const updateStateInputSchema = scopeSchema.extend({
  requirementId: z.string().uuid(),
  siloId: z.string().uuid().nullable(),
  applicable: z.boolean(),
  status: z.enum(["atendido", "pendente", "critico", "nao_aplicavel"]),
  dueAt: z.string().datetime().nullable(),
});

async function authorize(
  data: z.infer<typeof scopeSchema>,
  permission: "requirements.read" | "requirements.write" | "requirements.publish",
) {
  const session = await requireSessionUser();
  await requirePermission({
    userId: session.user.id,
    organizationId: data.organizationId,
    facilityId: data.facilityId,
    permission,
  });
  return session;
}

async function validateSiloScope(
  organizationId: string,
  facilityId: string,
  siloIds: string[],
) {
  if (siloIds.length === 0) return;
  const db = getDb();
  const rows = await db
    .select({ id: silos.id })
    .from(silos)
    .where(
      and(
        eq(silos.organizationId, organizationId),
        eq(silos.facilityId, facilityId),
        eq(silos.active, true),
        inArray(silos.id, siloIds),
      ),
    );
  if (rows.length !== new Set(siloIds).size) throw new Error("INVALID_SILO_SCOPE");
}

export const listProductionRequirements = createServerFn({ method: "GET" })
  .validator(scopeSchema)
  .handler(async ({ data }) => {
    await authorize(data, "requirements.read");
    const db = getDb();

    const [rows, siloLinks, stateRows] = await Promise.all([
      db
        .select({
          id: requirements.id,
          code: requirements.code,
          title: requirements.title,
          category: requirements.category,
          lifecycle: requirements.lifecycle,
          activeVersionId: requirements.activeVersionId,
          updatedAt: requirements.updatedAt,
          version: requirementVersions.version,
          description: requirementVersions.description,
          severity: requirementVersions.severity,
          evidenceRequired: requirementVersions.evidenceRequired,
          internalPeriodDays: requirementVersions.internalPeriodDays,
          sourceId: requirementVersions.sourceId,
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
        .from(requirements)
        .leftJoin(requirementVersions, eq(requirementVersions.id, requirements.activeVersionId))
        .leftJoin(requirementSources, eq(requirementSources.id, requirementVersions.sourceId))
        .where(eq(requirements.organizationId, data.organizationId))
        .orderBy(requirements.code),
      db
        .select({ requirementId: requirementSilos.requirementId, siloId: requirementSilos.siloId })
        .from(requirementSilos)
        .innerJoin(silos, eq(silos.id, requirementSilos.siloId))
        .where(
          and(
            eq(requirementSilos.organizationId, data.organizationId),
            eq(silos.facilityId, data.facilityId),
            eq(silos.active, true),
          ),
        ),
      db
        .select({
          id: requirementStates.id,
          requirementId: requirementStates.requirementId,
          siloId: requirementStates.siloId,
          applicable: requirementStates.applicable,
          status: requirementStates.status,
          dueAt: requirementStates.dueAt,
          revision: requirementStates.revision,
        })
        .from(requirementStates)
        .where(
          and(
            eq(requirementStates.organizationId, data.organizationId),
            eq(requirementStates.facilityId, data.facilityId),
          ),
        ),
    ]);

    return rows.map((row) => {
      const states = stateRows
        .filter((state) => state.requirementId === row.id)
        .map((state) => ({
          ...state,
          dueAt: state.dueAt?.toISOString() ?? null,
        }));
      const applicable = states.filter((state) => state.applicable && state.status !== "nao_aplicavel");
      const critical = applicable.filter((state) => state.status === "critico").length;
      const pending = applicable.filter((state) => state.status === "pendente").length;
      const attended = applicable.filter((state) => state.status === "atendido").length;
      const status =
        critical > 0
          ? "critico"
          : pending > 0
            ? "pendente"
            : applicable.length > 0
              ? "atendido"
              : "nao_aplicavel";
      return {
        ...row,
        updatedAt: row.updatedAt.toISOString(),
        sourceConsultedAt: row.sourceConsultedAt?.toISOString() ?? null,
        sourceVerifiedAt: row.sourceVerifiedAt?.toISOString() ?? null,
        siloIds: siloLinks.filter((link) => link.requirementId === row.id).map((link) => link.siloId),
        states,
        facilityStatus: status,
        attended,
        pending,
        critical,
      };
    });
  });

export const createProductionRequirement = createServerFn({ method: "POST" })
  .validator(createInputSchema)
  .handler(async ({ data }) => {
    const session = await authorize(data, "requirements.write");
    await validateSiloScope(data.organizationId, data.facilityId, data.siloIds);
    const db = getDb();
    const requirementId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(requirementSources).values({
        id: sourceId,
        organizationId: data.organizationId,
        type: data.version.source.type,
        title: data.version.source.title,
        issuer: data.version.source.issuer,
        version: data.version.source.version,
        section: data.version.source.section,
        officialUrl: data.version.source.officialUrl,
        consultedAt: data.version.source.consultedAt ? new Date(data.version.source.consultedAt) : null,
        verifiedBy: data.version.source.type === "externa_verificada" ? session.user.id : null,
        verifiedAt: data.version.source.type === "externa_verificada" ? new Date() : null,
        notes: data.version.source.notes,
      });

      await tx.insert(requirements).values({
        id: requirementId,
        organizationId: data.organizationId,
        code: data.code,
        title: data.title,
        category: data.category,
        lifecycle: "rascunho",
        activeVersionId: versionId,
      });

      await tx.insert(requirementVersions).values({
        id: versionId,
        organizationId: data.organizationId,
        requirementId,
        version: 1,
        description: data.version.description,
        severity: data.version.severity,
        evidenceRequired: data.version.evidenceRequired,
        internalPeriodDays: data.version.internalPeriodDays,
        sourceId,
      });

      if (data.siloIds.length > 0) {
        await tx.insert(requirementSilos).values(
          data.siloIds.map((siloId) => ({
            organizationId: data.organizationId,
            requirementId,
            siloId,
          })),
        );
      }

      const stateScopes = data.siloIds.length > 0 ? data.siloIds : [null];
      await tx.insert(requirementStates).values(
        stateScopes.map((siloId) => ({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          requirementId,
          siloId,
          applicable: true,
          status: "pendente" as const,
          updatedBy: session.user.id,
        })),
      );

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "requirement.created",
          entityType: "requirement",
          entityId: requirementId,
          after: {
            code: data.code,
            title: data.title,
            category: data.category,
            lifecycle: "rascunho",
            version: 1,
            sourceType: data.version.source.type,
            siloIds: data.siloIds,
          },
        }),
      );
    });

    return { id: requirementId };
  });

export const reviseProductionRequirement = createServerFn({ method: "POST" })
  .validator(reviseInputSchema)
  .handler(async ({ data }) => {
    const session = await authorize(data, "requirements.write");
    await validateSiloScope(data.organizationId, data.facilityId, data.siloIds);
    const db = getDb();
    const [current] = await db
      .select()
      .from(requirements)
      .where(
        and(
          eq(requirements.id, data.requirementId),
          eq(requirements.organizationId, data.organizationId),
        ),
      )
      .limit(1);
    if (!current) throw new Error("NOT_FOUND:REQUIREMENT");
    if (current.lifecycle === "obsoleto") throw new Error("REQUIREMENT_OBSOLETE");

    const [latest] = await db
      .select({ version: requirementVersions.version })
      .from(requirementVersions)
      .where(eq(requirementVersions.requirementId, current.id))
      .orderBy(desc(requirementVersions.version))
      .limit(1);
    const nextVersion = (latest?.version ?? 0) + 1;
    const versionId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(requirementSources).values({
        id: sourceId,
        organizationId: data.organizationId,
        type: data.version.source.type,
        title: data.version.source.title,
        issuer: data.version.source.issuer,
        version: data.version.source.version,
        section: data.version.source.section,
        officialUrl: data.version.source.officialUrl,
        consultedAt: data.version.source.consultedAt ? new Date(data.version.source.consultedAt) : null,
        verifiedBy: data.version.source.type === "externa_verificada" ? session.user.id : null,
        verifiedAt: data.version.source.type === "externa_verificada" ? new Date() : null,
        notes: data.version.source.notes,
      });

      await tx.insert(requirementVersions).values({
        id: versionId,
        organizationId: data.organizationId,
        requirementId: current.id,
        version: nextVersion,
        description: data.version.description,
        severity: data.version.severity,
        evidenceRequired: data.version.evidenceRequired,
        internalPeriodDays: data.version.internalPeriodDays,
        sourceId,
      });

      await tx
        .update(requirements)
        .set({
          title: data.title,
          category: data.category,
          lifecycle: "rascunho",
          activeVersionId: versionId,
          updatedAt: new Date(),
        })
        .where(eq(requirements.id, current.id));

      await tx.delete(requirementSilos).where(eq(requirementSilos.requirementId, current.id));
      if (data.siloIds.length > 0) {
        await tx.insert(requirementSilos).values(
          data.siloIds.map((siloId) => ({
            organizationId: data.organizationId,
            requirementId: current.id,
            siloId,
          })),
        );
      }

      await tx
        .delete(requirementStates)
        .where(
          and(
            eq(requirementStates.organizationId, data.organizationId),
            eq(requirementStates.facilityId, data.facilityId),
            eq(requirementStates.requirementId, current.id),
          ),
        );
      const stateScopes = data.siloIds.length > 0 ? data.siloIds : [null];
      await tx.insert(requirementStates).values(
        stateScopes.map((siloId) => ({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          requirementId: current.id,
          siloId,
          applicable: true,
          status: "pendente" as const,
          updatedBy: session.user.id,
        })),
      );

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "requirement.revised",
          entityType: "requirement",
          entityId: current.id,
          before: {
            title: current.title,
            category: current.category,
            lifecycle: current.lifecycle,
            activeVersionId: current.activeVersionId,
          },
          after: {
            title: data.title,
            category: data.category,
            lifecycle: "rascunho",
            activeVersionId: versionId,
            version: nextVersion,
            sourceType: data.version.source.type,
            siloIds: data.siloIds,
          },
        }),
      );
    });

    return { id: current.id, version: nextVersion };
  });

const TRANSITIONS: Record<z.infer<typeof lifecycleSchema>, z.infer<typeof lifecycleSchema>[]> = {
  rascunho: ["em_revisao"],
  em_revisao: ["rascunho", "validado"],
  validado: ["rascunho", "publicado"],
  publicado: ["obsoleto"],
  obsoleto: [],
};

export const transitionProductionRequirement = createServerFn({ method: "POST" })
  .validator(transitionInputSchema)
  .handler(async ({ data }) => {
    const permission =
      data.target === "validado" || data.target === "publicado" || data.target === "obsoleto"
        ? "requirements.publish"
        : "requirements.write";
    const session = await authorize(data, permission);
    const db = getDb();
    const [current] = await db
      .select()
      .from(requirements)
      .where(
        and(
          eq(requirements.id, data.requirementId),
          eq(requirements.organizationId, data.organizationId),
        ),
      )
      .limit(1);
    if (!current) throw new Error("NOT_FOUND:REQUIREMENT");
    if (!TRANSITIONS[current.lifecycle].includes(data.target)) {
      throw new Error(`INVALID_REQUIREMENT_TRANSITION:${current.lifecycle}:${data.target}`);
    }
    if (!current.activeVersionId) throw new Error("REQUIREMENT_WITHOUT_VERSION");

    await db.transaction(async (tx) => {
      await tx
        .update(requirements)
        .set({ lifecycle: data.target, updatedAt: new Date() })
        .where(eq(requirements.id, current.id));

      if (data.target === "publicado") {
        await tx
          .update(requirementVersions)
          .set({ publishedBy: session.user.id, publishedAt: new Date(), updatedAt: new Date() })
          .where(eq(requirementVersions.id, current.activeVersionId!));
      }

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "requirement.lifecycle_changed",
          entityType: "requirement",
          entityId: current.id,
          before: { lifecycle: current.lifecycle },
          after: { lifecycle: data.target },
        }),
      );
    });

    return { lifecycle: data.target };
  });

export const updateProductionRequirementState = createServerFn({ method: "POST" })
  .validator(updateStateInputSchema)
  .handler(async ({ data }) => {
    const session = await authorize(data, "requirements.write");
    if (data.siloId) {
      await validateSiloScope(data.organizationId, data.facilityId, [data.siloId]);
    }

    const db = getDb();
    return db.transaction(async (tx) => {
      const siloScope =
        data.siloId === null
          ? isNull(requirementStates.siloId)
          : eq(requirementStates.siloId, data.siloId);

      const [current] = await tx
        .select()
        .from(requirementStates)
        .where(
          and(
            eq(requirementStates.organizationId, data.organizationId),
            eq(requirementStates.facilityId, data.facilityId),
            eq(requirementStates.requirementId, data.requirementId),
            siloScope,
          ),
        )
        .limit(1);
      if (!current) throw new Error("NOT_FOUND:REQUIREMENT_STATE");

      const nextStatus = data.applicable ? data.status : "nao_aplicavel";
      const [after] = await tx
        .update(requirementStates)
        .set({
          applicable: data.applicable,
          status: nextStatus,
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          lastAssessedAt: new Date(),
          updatedBy: session.user.id,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(requirementStates.id, current.id),
            eq(requirementStates.revision, current.revision),
          ),
        )
        .returning();
      if (!after) throw new Error("REQUIREMENT_STATE_CONFLICT");

      await tx.insert(auditEvents).values(
        makeAuditEventValues({
          organizationId: data.organizationId,
          facilityId: data.facilityId,
          actorUserId: session.user.id,
          eventType: "requirement.state_changed",
          entityType: "requirement_state",
          entityId: current.id,
          before: {
            applicable: current.applicable,
            status: current.status,
            dueAt: current.dueAt?.toISOString() ?? null,
            revision: current.revision,
          },
          after: {
            applicable: after.applicable,
            status: after.status,
            dueAt: after.dueAt?.toISOString() ?? null,
            revision: after.revision,
          },
        }),
      );

      return { id: after.id, revision: after.revision };
    });
  });
