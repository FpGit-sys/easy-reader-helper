import { and, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { getDb, getPool } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";
import { requireSessionUser } from "@/server/session";

const inputSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
  search: z.string().trim().max(200).default(""),
  entityType: z.string().trim().max(120).nullable().default(null),
  eventType: z.string().trim().max(160).nullable().default(null),
  actorUserId: z.string().trim().max(255).nullable().default(null),
  from: z.string().datetime().nullable().default(null),
  to: z.string().datetime().nullable().default(null),
  limit: z.number().int().min(1).max(250).default(100),
  offset: z.number().int().min(0).max(20_000).default(0),
});

export const listProductionAuditEvents = createServerFn({ method: "GET" })
  .validator(inputSchema)
  .handler(async ({ data }) => {
    const session = await requireSessionUser();
    await requirePermission({
      userId: session.user.id,
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      permission: "audit.read",
    });

    const filters: SQL[] = [
      eq(auditEvents.organizationId, data.organizationId),
      eq(auditEvents.facilityId, data.facilityId),
    ];

    if (data.entityType) filters.push(eq(auditEvents.entityType, data.entityType));
    if (data.eventType) filters.push(eq(auditEvents.eventType, data.eventType));
    if (data.actorUserId) filters.push(eq(auditEvents.actorUserId, data.actorUserId));
    if (data.from) filters.push(gte(auditEvents.occurredAt, new Date(data.from)));
    if (data.to) filters.push(lte(auditEvents.occurredAt, new Date(data.to)));
    if (data.search) {
      const needle = `%${data.search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const searchClause = or(
        ilike(auditEvents.eventType, needle),
        ilike(auditEvents.entityType, needle),
        ilike(auditEvents.entityId, needle),
      );
      if (searchClause) filters.push(searchClause);
    }

    const rows = await getDb()
      .select({
        id: auditEvents.id,
        actorUserId: auditEvents.actorUserId,
        eventType: auditEvents.eventType,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        occurredAt: auditEvents.occurredAt,
        before: auditEvents.before,
        after: auditEvents.after,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(and(...filters))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(data.limit + 1)
      .offset(data.offset);

    const pageRows = rows.slice(0, data.limit);
    const actorIds = [...new Set(pageRows.map((row) => row.actorUserId))];
    const users = actorIds.length
      ? await getPool().query<{ id: string; name: string | null }>(
          'select id, name from "user" where id = any($1::text[])',
          [actorIds],
        )
      : { rows: [] as Array<{ id: string; name: string | null }> };
    const userNames = new Map(users.rows.map((user) => [user.id, user.name?.trim() || "Usuário"]));

    const entityTypes = [...new Set(pageRows.map((row) => row.entityType))].sort();
    const eventTypes = [...new Set(pageRows.map((row) => row.eventType))].sort();
    const actors = actorIds
      .map((id) => ({ id, name: userNames.get(id) ?? "Usuário" }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    return {
      rows: pageRows.map((row) => ({
        id: row.id,
        actorUserId: row.actorUserId,
        actorName: userNames.get(row.actorUserId) ?? "Usuário",
        eventType: row.eventType,
        entityType: row.entityType,
        entityId: row.entityId,
        occurredAt: row.occurredAt.toISOString(),
        beforeJson: JSON.stringify(row.before ?? null),
        afterJson: JSON.stringify(row.after ?? null),
        metadataJson: JSON.stringify(row.metadata ?? {}),
      })),
      hasMore: rows.length > data.limit,
      nextOffset: data.offset + pageRows.length,
      facets: { entityTypes, eventTypes, actors },
    };
  });
