import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { memberships } from "@/server/db/schema";

export async function assertAssignableUser(input: {
  organizationId: string;
  facilityId: string;
  userId: string | null;
}): Promise<void> {
  if (!input.userId) return;

  const [membership] = await getDb()
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, input.organizationId),
        eq(memberships.userId, input.userId),
        eq(memberships.active, true),
        or(eq(memberships.facilityId, input.facilityId), isNull(memberships.facilityId)),
      ),
    )
    .limit(1);

  if (!membership) throw new Error("INVALID_ASSIGNEE_SCOPE");
}
