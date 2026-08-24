import { and, eq, isNull } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { facilities, memberships, organizations } from "@/server/db/schema";
import { requireSessionUser } from "@/server/session";

export const listMyScopes = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSessionUser();
  const db = getDb();

  const rows = await db
    .select({
      membershipId: memberships.id,
      organizationId: organizations.id,
      organizationName: organizations.name,
      facilityId: memberships.facilityId,
      facilityName: facilities.name,
      facilityCity: facilities.city,
      facilityState: facilities.state,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .leftJoin(facilities, eq(facilities.id, memberships.facilityId))
    .where(and(eq(memberships.userId, session.user.id), eq(memberships.active, true)));

  return rows;
});

const organizationFacilitiesInput = z.object({
  organizationId: z.string().uuid(),
});

export const listOrganizationFacilities = createServerFn({ method: "GET" })
  .validator(organizationFacilitiesInput)
  .handler(async ({ data }) => {
    const session = await requireSessionUser();
    const db = getDb();

    const organizationWideMembership = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, session.user.id),
          eq(memberships.organizationId, data.organizationId),
          eq(memberships.active, true),
          isNull(memberships.facilityId),
        ),
      )
      .limit(1);

    if (organizationWideMembership.length === 0) {
      const scoped = await db
        .select({
          id: facilities.id,
          name: facilities.name,
          city: facilities.city,
          state: facilities.state,
        })
        .from(memberships)
        .innerJoin(facilities, eq(facilities.id, memberships.facilityId))
        .where(
          and(
            eq(memberships.userId, session.user.id),
            eq(memberships.organizationId, data.organizationId),
            eq(memberships.active, true),
          ),
        );
      return scoped;
    }

    return db
      .select({
        id: facilities.id,
        name: facilities.name,
        city: facilities.city,
        state: facilities.state,
      })
      .from(facilities)
      .where(
        and(
          eq(facilities.organizationId, data.organizationId),
          eq(facilities.active, true),
        ),
      );
  });
