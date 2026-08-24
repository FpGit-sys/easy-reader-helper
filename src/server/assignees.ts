import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { memberships } from "@/server/db/schema";
import { can, type Permission, type Role } from "@/server/rbac";

export async function assertAssignableUser(input: {
  organizationId: string;
  facilityId: string;
  userId: string | null;
  requiredPermission?: Permission;
}): Promise<void> {
  if (!input.userId) return;

  const membershipsInScope = await getDb()
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, input.organizationId),
        eq(memberships.userId, input.userId),
        eq(memberships.active, true),
        or(eq(memberships.facilityId, input.facilityId), isNull(memberships.facilityId)),
      ),
    );

  if (membershipsInScope.length === 0) throw new Error("INVALID_ASSIGNEE_SCOPE");
  if (
    input.requiredPermission &&
    !membershipsInScope.some((membership) =>
      can(membership.role as Role, input.requiredPermission!),
    )
  ) {
    throw new Error(`ASSIGNEE_PERMISSION_REQUIRED:${input.requiredPermission}`);
  }
}
