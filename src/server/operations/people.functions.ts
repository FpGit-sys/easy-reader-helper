import { and, eq, isNull, or } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { getDb, getPool } from "@/server/db/client";
import { memberships } from "@/server/db/schema";
import { can, type Role } from "@/server/rbac";
import { requireSessionUser } from "@/server/session";

const scopeSchema = z.object({
  organizationId: z.string().uuid(),
  facilityId: z.string().uuid(),
});

export const listAssignableUsers = createServerFn({ method: "GET" })
  .validator(scopeSchema)
  .handler(async ({ data }) => {
    const session = await requireSessionUser();
    await requirePermission({
      userId: session.user.id,
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      permission: "nonconformities.read",
    });

    const rows = await getDb()
      .select({ userId: memberships.userId, role: memberships.role, facilityId: memberships.facilityId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, data.organizationId),
          eq(memberships.active, true),
          or(eq(memberships.facilityId, data.facilityId), isNull(memberships.facilityId)),
        ),
      );

    const effective = new Map<string, { userId: string; role: string; direct: boolean }>();
    for (const row of rows) {
      const direct = row.facilityId === data.facilityId;
      const current = effective.get(row.userId);
      if (!current || (direct && !current.direct)) {
        effective.set(row.userId, { userId: row.userId, role: row.role, direct });
      }
    }

    const actionCapable = [...effective.values()].filter((member) =>
      can(member.role as Role, "actions.write"),
    );
    const ids = actionCapable.map((member) => member.userId);
    if (ids.length === 0) return [];

    const authUsers = await getPool().query<{ id: string; name: string | null }>(
      'select id, name from "user" where id = any($1::text[])',
      [ids],
    );
    const names = new Map(authUsers.rows.map((user) => [user.id, user.name]));

    return actionCapable
      .map((member) => ({
        id: member.userId,
        name: names.get(member.userId)?.trim() || "Usuário da unidade",
        role: member.role,
        isCurrentUser: member.userId === session.user.id,
      }))
      .sort((a, b) => {
        if (a.isCurrentUser !== b.isCurrentUser) return a.isCurrentUser ? -1 : 1;
        return a.name.localeCompare(b.name, "pt-BR");
      });
  });
