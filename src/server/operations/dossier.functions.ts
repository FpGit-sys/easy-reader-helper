import { and, desc, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { getDb, getPool } from "@/server/db/client";
import {
  auditEvents,
  correctiveActions,
  documents,
  documentVersions,
  evidenceLinks,
  evidences,
  facilities,
  inspectionItems,
  inspections,
  nonconformities,
  organizations,
  requirementSources,
  requirements,
  requirementVersions,
  silos,
} from "@/server/db/schema";
import { requirementStates } from "@/server/db/schema.extensions";
import { requireSessionUser } from "@/server/session";

const inputSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
  siloIds: z.array(z.string().uuid()).max(500).default([]),
  includeAudit: z.boolean().default(true),
});

export const getProductionDossierData = createServerFn({ method: "GET" })
  .validator(inputSchema)
  .handler(async ({ data }) => {
    const session = await requireSessionUser();
    await requirePermission({
      userId: session.user.id,
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      permission: "dossier.generate",
    });
    if (data.includeAudit) {
      await requirePermission({
        userId: session.user.id,
        organizationId: data.organizationId,
        facilityId: data.facilityId,
        permission: "audit.read",
      });
    }

    const db = getDb();
    const [[organization], [facility]] = await Promise.all([
      db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, data.organizationId)).limit(1),
      db
        .select({ id: facilities.id, organizationId: facilities.organizationId, name: facilities.name, city: facilities.city, state: facilities.state })
        .from(facilities)
        .where(and(eq(facilities.id, data.facilityId), eq(facilities.organizationId, data.organizationId), eq(facilities.active, true)))
        .limit(1),
    ]);
    if (!organization || !facility) throw new Error("NOT_FOUND:DOSSIER_SCOPE");

    const [siloRows, stateRows, documentRows, inspectionRows, itemRows, ncRows, actionRows, evidenceRows, evidenceLinkRows, auditRows] = await Promise.all([
      db
        .select({ id: silos.id, code: silos.code, name: silos.name, type: silos.type, capacityTonnes: silos.capacityTonnes, inspectionPeriodDays: silos.inspectionPeriodDays })
        .from(silos)
        .where(and(eq(silos.organizationId, data.organizationId), eq(silos.facilityId, data.facilityId), eq(silos.active, true)))
        .orderBy(silos.code),
      db
        .select({
          stateId: requirementStates.id,
          siloId: requirementStates.siloId,
          applicable: requirementStates.applicable,
          status: requirementStates.status,
          dueAt: requirementStates.dueAt,
          lastAssessedAt: requirementStates.lastAssessedAt,
          revision: requirementStates.revision,
          requirementId: requirements.id,
          code: requirements.code,
          title: requirements.title,
          category: requirements.category,
          lifecycle: requirements.lifecycle,
          version: requirementVersions.version,
          description: requirementVersions.description,
          severity: requirementVersions.severity,
          evidenceRequired: requirementVersions.evidenceRequired,
          sourceType: requirementSources.type,
          sourceTitle: requirementSources.title,
          sourceIssuer: requirementSources.issuer,
          sourceVersion: requirementSources.version,
          sourceSection: requirementSources.section,
          sourceOfficialUrl: requirementSources.officialUrl,
          sourceConsultedAt: requirementSources.consultedAt,
          sourceVerifiedAt: requirementSources.verifiedAt,
        })
        .from(requirementStates)
        .innerJoin(requirements, eq(requirements.id, requirementStates.requirementId))
        .leftJoin(requirementVersions, eq(requirementVersions.id, requirements.activeVersionId))
        .leftJoin(requirementSources, eq(requirementSources.id, requirementVersions.sourceId))
        .where(and(eq(requirementStates.organizationId, data.organizationId), eq(requirementStates.facilityId, data.facilityId)))
        .orderBy(requirements.code),
      db
        .select({
          id: documents.id,
          siloId: documents.siloId,
          name: documents.name,
          category: documents.category,
          issuedAt: documents.issuedAt,
          expiresAt: documents.expiresAt,
          version: documentVersions.version,
          filename: documentVersions.originalFilename,
          mimeType: documentVersions.mimeType,
          sizeBytes: documentVersions.sizeBytes,
          sha256: documentVersions.sha256,
          uploadedAt: documentVersions.uploadedAt,
        })
        .from(documents)
        .leftJoin(documentVersions, eq(documentVersions.id, documents.activeVersionId))
        .where(and(eq(documents.organizationId, data.organizationId), eq(documents.facilityId, data.facilityId)))
        .orderBy(documents.name),
      db
        .select({
          id: inspections.id,
          siloId: inspections.siloId,
          code: inspections.code,
          type: inspections.type,
          status: inspections.status,
          inspectorUserId: inspections.inspectorUserId,
          startedAt: inspections.startedAt,
          completedAt: inspections.completedAt,
          notes: inspections.notes,
        })
        .from(inspections)
        .where(and(eq(inspections.organizationId, data.organizationId), eq(inspections.facilityId, data.facilityId)))
        .orderBy(desc(inspections.startedAt)),
      db
        .select({ inspectionId: inspectionItems.inspectionId, result: inspectionItems.result })
        .from(inspectionItems)
        .where(eq(inspectionItems.organizationId, data.organizationId)),
      db
        .select({
          id: nonconformities.id,
          siloId: nonconformities.siloId,
          inspectionId: nonconformities.inspectionId,
          code: nonconformities.code,
          title: nonconformities.title,
          description: nonconformities.description,
          severity: nonconformities.severity,
          status: nonconformities.status,
          responsibleUserId: nonconformities.responsibleUserId,
          dueAt: nonconformities.dueAt,
          resolvedAt: nonconformities.resolvedAt,
          createdAt: nonconformities.createdAt,
        })
        .from(nonconformities)
        .where(and(eq(nonconformities.organizationId, data.organizationId), eq(nonconformities.facilityId, data.facilityId)))
        .orderBy(desc(nonconformities.createdAt)),
      db
        .select({
          id: correctiveActions.id,
          nonconformityId: correctiveActions.nonconformityId,
          siloId: correctiveActions.siloId,
          code: correctiveActions.code,
          title: correctiveActions.title,
          responsibleUserId: correctiveActions.responsibleUserId,
          dueAt: correctiveActions.dueAt,
          priority: correctiveActions.priority,
          status: correctiveActions.status,
          completedAt: correctiveActions.completedAt,
          createdAt: correctiveActions.createdAt,
        })
        .from(correctiveActions)
        .where(and(eq(correctiveActions.organizationId, data.organizationId), eq(correctiveActions.facilityId, data.facilityId)))
        .orderBy(desc(correctiveActions.createdAt)),
      db
        .select({
          id: evidences.id,
          siloId: evidences.siloId,
          type: evidences.type,
          name: evidences.name,
          description: evidences.description,
          originalFilename: evidences.originalFilename,
          mimeType: evidences.mimeType,
          sizeBytes: evidences.sizeBytes,
          sha256: evidences.sha256,
          capturedAt: evidences.capturedAt,
          capturedBy: evidences.capturedBy,
        })
        .from(evidences)
        .where(and(eq(evidences.organizationId, data.organizationId), eq(evidences.facilityId, data.facilityId)))
        .orderBy(desc(evidences.capturedAt)),
      db
        .select({
          evidenceId: evidenceLinks.evidenceId,
          requirementId: evidenceLinks.requirementId,
          inspectionId: evidenceLinks.inspectionId,
          nonconformityId: evidenceLinks.nonconformityId,
          correctiveActionId: evidenceLinks.correctiveActionId,
        })
        .from(evidenceLinks)
        .where(eq(evidenceLinks.organizationId, data.organizationId)),
      data.includeAudit
        ? db
            .select({
              id: auditEvents.id,
              actorUserId: auditEvents.actorUserId,
              eventType: auditEvents.eventType,
              entityType: auditEvents.entityType,
              entityId: auditEvents.entityId,
              occurredAt: auditEvents.occurredAt,
            })
            .from(auditEvents)
            .where(and(eq(auditEvents.organizationId, data.organizationId), eq(auditEvents.facilityId, data.facilityId)))
            .orderBy(desc(auditEvents.occurredAt))
            .limit(200)
        : Promise.resolve([]),
    ]);

    const selectedSiloIds = data.siloIds.length ? new Set(data.siloIds) : new Set(siloRows.map((silo) => silo.id));
    if (data.siloIds.some((id) => !siloRows.some((silo) => silo.id === id))) throw new Error("INVALID_DOSSIER_SILO_SCOPE");
    const inScopeSilo = (siloId: string | null) => siloId === null || selectedSiloIds.has(siloId);

    const selectedSilos = siloRows.filter((silo) => selectedSiloIds.has(silo.id));
    const selectedStates = stateRows.filter((row) => inScopeSilo(row.siloId));
    const selectedDocuments = documentRows.filter((row) => inScopeSilo(row.siloId));
    const selectedInspections = inspectionRows.filter((row) => selectedSiloIds.has(row.siloId));
    const inspectionIds = new Set(selectedInspections.map((row) => row.id));
    const selectedNcs = ncRows.filter((row) => inScopeSilo(row.siloId) && (!row.inspectionId || inspectionIds.has(row.inspectionId)));
    const ncIds = new Set(selectedNcs.map((row) => row.id));
    const selectedActions = actionRows.filter((row) => inScopeSilo(row.siloId) && (!row.nonconformityId || ncIds.has(row.nonconformityId)));
    const actionIds = new Set(selectedActions.map((row) => row.id));
    const selectedEvidence = evidenceRows.filter((row) => {
      if (!inScopeSilo(row.siloId)) return false;
      const links = evidenceLinkRows.filter((link) => link.evidenceId === row.id);
      if (links.length === 0) return true;
      return links.some((link) =>
        (link.inspectionId ? inspectionIds.has(link.inspectionId) : false) ||
        (link.nonconformityId ? ncIds.has(link.nonconformityId) : false) ||
        (link.correctiveActionId ? actionIds.has(link.correctiveActionId) : false) ||
        Boolean(link.requirementId),
      );
    });

    const applicable = selectedStates.filter((row) => row.applicable && row.status !== "nao_aplicavel");
    const attended = applicable.filter((row) => row.status === "atendido").length;
    const pending = applicable.filter((row) => row.status === "pendente").length;
    const critical = applicable.filter((row) => row.status === "critico").length;
    const readinessExact = applicable.length ? (attended / applicable.length) * 100 : 0;
    const now = Date.now();
    const soon = now + 30 * 86_400_000;
    const documentStatus = (expiresAt: Date | null) =>
      !expiresAt ? "sem_validade" as const : expiresAt.getTime() < now ? "vencido" as const : expiresAt.getTime() <= soon ? "vence_em_breve" as const : "valido" as const;

    const userIds = [...new Set([
      session.user.id,
      ...selectedInspections.map((row) => row.inspectorUserId),
      ...selectedNcs.flatMap((row) => row.responsibleUserId ? [row.responsibleUserId] : []),
      ...selectedActions.flatMap((row) => row.responsibleUserId ? [row.responsibleUserId] : []),
      ...selectedEvidence.map((row) => row.capturedBy),
      ...auditRows.map((row) => row.actorUserId),
    ])];
    const authUsers = userIds.length
      ? await getPool().query<{ id: string; name: string | null }>('select id, name from "user" where id = any($1::text[])', [userIds])
      : { rows: [] as Array<{ id: string; name: string | null }> };
    const userNames = new Map(authUsers.rows.map((user) => [user.id, user.name?.trim() || "Usuário"]));
    const siloNames = new Map(selectedSilos.map((silo) => [silo.id, `${silo.code} — ${silo.name}`]));

    return {
      generatedAt: new Date().toISOString(),
      generatedBy: { id: session.user.id, name: userNames.get(session.user.id) ?? session.user.name ?? "Usuário" },
      organization,
      facility: { id: facility.id, name: facility.name, city: facility.city, state: facility.state },
      selectedSiloIds: [...selectedSiloIds],
      summary: {
        readiness: Math.round(readinessExact),
        readinessExact,
        applicable: applicable.length,
        attended,
        pending,
        critical,
        documentsExpired: selectedDocuments.filter((row) => documentStatus(row.expiresAt) === "vencido").length,
        documentsExpiring: selectedDocuments.filter((row) => documentStatus(row.expiresAt) === "vence_em_breve").length,
        openNonconformities: selectedNcs.filter((row) => row.status !== "resolvida" && row.status !== "cancelada").length,
        overdueActions: selectedActions.filter((row) => row.status !== "concluida" && row.status !== "cancelada" && row.dueAt && row.dueAt.getTime() < now).length,
        inspections: selectedInspections.length,
        evidences: selectedEvidence.length,
      },
      silos: selectedSilos,
      requirements: selectedStates.map((row) => ({
        ...row,
        siloName: row.siloId ? siloNames.get(row.siloId) ?? "Silo" : "Unidade",
        dueAt: row.dueAt?.toISOString() ?? null,
        lastAssessedAt: row.lastAssessedAt?.toISOString() ?? null,
        sourceConsultedAt: row.sourceConsultedAt?.toISOString() ?? null,
        sourceVerifiedAt: row.sourceVerifiedAt?.toISOString() ?? null,
      })),
      documents: selectedDocuments.map((row) => ({
        ...row,
        siloName: row.siloId ? siloNames.get(row.siloId) ?? "Silo" : "Unidade",
        status: documentStatus(row.expiresAt),
        issuedAt: row.issuedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        uploadedAt: row.uploadedAt?.toISOString() ?? null,
      })),
      inspections: selectedInspections.map((row) => {
        const items = itemRows.filter((item) => item.inspectionId === row.id);
        return {
          ...row,
          siloName: siloNames.get(row.siloId) ?? "Silo",
          inspectorName: userNames.get(row.inspectorUserId) ?? "Usuário",
          startedAt: row.startedAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          itemCount: items.length,
          issueCount: items.filter((item) => item.result === "pendente" || item.result === "critico").length,
        };
      }),
      nonconformities: selectedNcs.map((row) => ({
        ...row,
        siloName: row.siloId ? siloNames.get(row.siloId) ?? "Silo" : "Unidade",
        responsibleName: row.responsibleUserId ? userNames.get(row.responsibleUserId) ?? "Usuário" : "Não definido",
        dueAt: row.dueAt?.toISOString() ?? null,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      actions: selectedActions.map((row) => ({
        ...row,
        siloName: row.siloId ? siloNames.get(row.siloId) ?? "Silo" : "Unidade",
        responsibleName: row.responsibleUserId ? userNames.get(row.responsibleUserId) ?? "Usuário" : "Não definido",
        evidenceCount: evidenceLinkRows.filter((link) => link.correctiveActionId === row.id).length,
        dueAt: row.dueAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      evidences: selectedEvidence.map((row) => ({
        ...row,
        siloName: row.siloId ? siloNames.get(row.siloId) ?? "Silo" : "Unidade",
        capturedByName: userNames.get(row.capturedBy) ?? "Usuário",
        capturedAt: row.capturedAt.toISOString(),
        links: evidenceLinkRows.filter((link) => link.evidenceId === row.id),
      })),
      audit: auditRows.map((row) => ({
        ...row,
        actorName: userNames.get(row.actorUserId) ?? "Usuário",
        occurredAt: row.occurredAt.toISOString(),
      })),
      disclaimer:
        "O SiloNR é uma ferramenta de apoio à gestão de documentos, inspeções, evidências, pendências e ações internas. O índice apresentado é de prontidão operacional/documental com base nos critérios cadastrados e não constitui certificação, garantia de conformidade legal, laudo ou parecer técnico/jurídico.",
    };
  });
