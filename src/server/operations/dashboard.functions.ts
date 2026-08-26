import { and, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { getDb } from "@/server/db/client";
import {
  correctiveActions,
  documents,
  evidences,
  facilities,
  inspections,
  nonconformities,
  requirements,
  silos,
} from "@/server/db/schema";
import { requirementStates } from "@/server/db/schema.extensions";
import { requireSessionUser } from "@/server/session";

const inputSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
});

export const getProductionDashboard = createServerFn({ method: "GET" })
  .validator(inputSchema)
  .handler(async ({ data }) => {
    const session = await requireSessionUser();
    await requirePermission({
      userId: session.user.id,
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      permission: "requirements.read",
    });

    const db = getDb();
    const scope = and(
      eq(facilities.id, data.facilityId),
      eq(facilities.organizationId, data.organizationId),
      eq(facilities.active, true),
    );

    const [facility] = await db.select().from(facilities).where(scope).limit(1);
    if (!facility) throw new Error("NOT_FOUND:FACILITY");

    const [stateRows, documentRows, actionRows, ncRows, evidenceRows, inspectionRows, siloRows] =
      await Promise.all([
        db
          .select({
            status: requirementStates.status,
            applicable: requirementStates.applicable,
            siloId: requirementStates.siloId,
            category: requirements.category,
          })
          .from(requirementStates)
          .innerJoin(requirements, eq(requirements.id, requirementStates.requirementId))
          .where(
            and(
              eq(requirementStates.organizationId, data.organizationId),
              eq(requirementStates.facilityId, data.facilityId),
            ),
          ),
        db
          .select({ expiresAt: documents.expiresAt })
          .from(documents)
          .where(
            and(
              eq(documents.organizationId, data.organizationId),
              eq(documents.facilityId, data.facilityId),
            ),
          ),
        db
          .select({ status: correctiveActions.status, dueAt: correctiveActions.dueAt })
          .from(correctiveActions)
          .where(
            and(
              eq(correctiveActions.organizationId, data.organizationId),
              eq(correctiveActions.facilityId, data.facilityId),
            ),
          ),
        db
          .select({ status: nonconformities.status })
          .from(nonconformities)
          .where(
            and(
              eq(nonconformities.organizationId, data.organizationId),
              eq(nonconformities.facilityId, data.facilityId),
            ),
          ),
        db
          .select({ id: evidences.id })
          .from(evidences)
          .where(
            and(
              eq(evidences.organizationId, data.organizationId),
              eq(evidences.facilityId, data.facilityId),
            ),
          ),
        db
          .select({ id: inspections.id })
          .from(inspections)
          .where(
            and(
              eq(inspections.organizationId, data.organizationId),
              eq(inspections.facilityId, data.facilityId),
            ),
          ),
        db
          .select({ id: silos.id, code: silos.code, name: silos.name })
          .from(silos)
          .where(
            and(
              eq(silos.organizationId, data.organizationId),
              eq(silos.facilityId, data.facilityId),
              eq(silos.active, true),
            ),
          ),
      ]);

    const applicable = stateRows.filter(
      (item) => item.applicable && item.status !== "nao_aplicavel",
    );
    const attended = applicable.filter((item) => item.status === "atendido").length;
    const pending = applicable.filter((item) => item.status === "pendente").length;
    const critical = applicable.filter((item) => item.status === "critico").length;
    const notApplicable = stateRows.filter(
      (item) => !item.applicable || item.status === "nao_aplicavel",
    ).length;
    const totalApplicable = applicable.length;
    const readinessExact = totalApplicable === 0 ? 0 : (attended / totalApplicable) * 100;
    const readiness = Math.round(readinessExact);

    const now = new Date();
    const expirationWindowDays = 30;
    const expirationLimit = new Date(now.getTime() + expirationWindowDays * 86_400_000);
    const documentsExpired = documentRows.filter(
      (item) => item.expiresAt && item.expiresAt.getTime() < now.getTime(),
    ).length;
    const documentsExpiring = documentRows.filter(
      (item) =>
        item.expiresAt &&
        item.expiresAt.getTime() >= now.getTime() &&
        item.expiresAt.getTime() <= expirationLimit.getTime(),
    ).length;
    const actionsOverdue = actionRows.filter(
      (item) =>
        item.status !== "concluida" &&
        item.status !== "cancelada" &&
        item.dueAt &&
        item.dueAt.getTime() < now.getTime(),
    ).length;
    const openNonconformities = ncRows.filter(
      (item) => item.status !== "resolvida" && item.status !== "cancelada",
    ).length;

    const byCategory = new Map<string, number>();
    for (const item of applicable) {
      if (item.status !== "pendente" && item.status !== "critico") continue;
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
    }

    const siloRisk = siloRows
      .map((silo) => {
        const items = applicable.filter((item) => item.siloId === silo.id);
        const siloAttended = items.filter((item) => item.status === "atendido").length;
        const siloCritical = items.filter((item) => item.status === "critico").length;
        const siloPending = items.filter((item) => item.status === "pendente").length;
        const percent = items.length === 0 ? 0 : Math.round((siloAttended / items.length) * 100);
        const riskScore = siloCritical * 1000 + siloPending * 10 + (100 - percent);
        return {
          id: silo.id,
          code: silo.code,
          name: silo.name,
          critical: siloCritical,
          pending: siloPending,
          readiness: percent,
          riskScore,
        };
      })
      .sort((a, b) => b.riskScore - a.riskScore);

    return {
      facility: {
        id: facility.id,
        name: facility.name,
        city: facility.city,
        state: facility.state,
      },
      readiness,
      readinessExact,
      totalApplicable,
      attended,
      pending,
      critical,
      notApplicable,
      documentsExpired,
      documentsExpiring,
      actionsOverdue,
      openNonconformities,
      evidenceCount: evidenceRows.length,
      inspectionCount: inspectionRows.length,
      expirationWindowDays,
      statusChart: [
        { name: "Atendidos", value: attended },
        { name: "Pendentes", value: pending },
        { name: "Críticos", value: critical },
        { name: "Não aplicáveis", value: notApplicable },
      ],
      pendingByCategory: [...byCategory.entries()]
        .map(([category, value]) => ({ category, value }))
        .sort((a, b) => b.value - a.value),
      prioritySilo: siloRisk[0] ?? null,
    };
  });
