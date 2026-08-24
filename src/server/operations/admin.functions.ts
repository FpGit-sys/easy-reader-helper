import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePermission } from "@/server/access";
import { writeAuditEvent } from "@/server/audit";
import { getAuth } from "@/server/auth";
import { getDb, getPool } from "@/server/db/client";
import { facilities, memberships, organizations } from "@/server/db/schema";
import { licenses } from "@/server/db/schema.extensions";
import { requireSessionUser } from "@/server/session";
import type { Role } from "@/server/rbac";

const organizationScopeSchema = z.object({
  organizationId: z.string().uuid(),
});

const facilityFieldsSchema = z.object({
  name: z.string().trim().min(2).max(200),
  city: z.string().trim().max(120).nullable(),
  state: z.string().trim().max(80).nullable(),
});

const memberRoleSchema = z.enum([
  "admin_empresa",
  "gestor_unidade",
  "responsavel_tecnico",
  "inspetor",
  "leitor",
]);

const updateOrganizationSchema = organizationScopeSchema.extend({
  name: z.string().trim().min(2).max(200),
  legalName: z.string().trim().max(240).nullable(),
  document: z.string().trim().max(32).nullable(),
});

const createFacilitySchema = organizationScopeSchema.extend({ facility: facilityFieldsSchema });
const updateFacilitySchema = organizationScopeSchema.extend({
  facilityId: z.string().uuid(),
  facility: facilityFieldsSchema,
});
const archiveFacilitySchema = organizationScopeSchema.extend({ facilityId: z.string().uuid() });

const createMemberSchema = organizationScopeSchema.extend({
  name: z.string().trim().min(2).max(160),
  email: z.string().email().max(320).transform((value) => value.toLowerCase()),
  temporaryPassword: z.string().min(12).max(128),
  role: memberRoleSchema,
  facilityId: z.string().uuid().nullable(),
});

const updateMemberSchema = organizationScopeSchema.extend({
  membershipId: z.string().uuid(),
  role: memberRoleSchema,
  facilityId: z.string().uuid().nullable(),
  active: z.boolean(),
});

async function authorizeOrganization(organizationId: string, permission: "organization.manage" | "users.manage") {
  const session = await requireSessionUser();
  const scope = await requirePermission({
    userId: session.user.id,
    organizationId,
    facilityId: null,
    permission,
  });
  return { session, scope };
}

function validateRoleScope(role: z.infer<typeof memberRoleSchema>, facilityId: string | null) {
  if (role === "admin_empresa" && facilityId) throw new Error("ADMIN_ROLE_MUST_BE_ORGANIZATION_WIDE");
  if ((role === "gestor_unidade" || role === "inspetor") && !facilityId) {
    throw new Error("ROLE_REQUIRES_FACILITY");
  }
}

async function assertFacilityBelongsToOrganization(organizationId: string, facilityId: string | null) {
  if (!facilityId) return;
  const [facility] = await getDb()
    .select({ id: facilities.id })
    .from(facilities)
    .where(
      and(
        eq(facilities.id, facilityId),
        eq(facilities.organizationId, organizationId),
        eq(facilities.active, true),
      ),
    )
    .limit(1);
  if (!facility) throw new Error("INVALID_FACILITY_SCOPE");
}

async function getCurrentLicense(organizationId: string) {
  const [license] = await getDb()
    .select()
    .from(licenses)
    .where(eq(licenses.organizationId, organizationId))
    .orderBy(desc(licenses.createdAt))
    .limit(1);
  return license ?? null;
}

async function countActiveUsers(organizationId: string) {
  const rows = await getDb()
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.active, true)));
  return new Set(rows.map((row) => row.userId)).size;
}

async function assertUserLimit(organizationId: string, userId?: string) {
  const license = await getCurrentLicense(organizationId);
  if (!license) return;
  if (userId) {
    const existing = await getDb()
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.active, true),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;
  }
  const current = await countActiveUsers(organizationId);
  if (current >= license.maxUsers) throw new Error("LICENSE_USER_LIMIT_REACHED");
}

async function assertFacilityLimit(organizationId: string) {
  const license = await getCurrentLicense(organizationId);
  if (!license) return;
  const rows = await getDb()
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.organizationId, organizationId), eq(facilities.active, true)));
  if (rows.length >= license.maxFacilities) throw new Error("LICENSE_FACILITY_LIMIT_REACHED");
}

export const getProductionAdministration = createServerFn({ method: "GET" })
  .validator(organizationScopeSchema)
  .handler(async ({ data }) => {
    const { session } = await authorizeOrganization(data.organizationId, "users.manage");
    const db = getDb();

    const [[organization], facilityRows, membershipRows, license] = await Promise.all([
      db
        .select({
          id: organizations.id,
          name: organizations.name,
          legalName: organizations.legalName,
          document: organizations.document,
          active: organizations.active,
        })
        .from(organizations)
        .where(eq(organizations.id, data.organizationId))
        .limit(1),
      db
        .select({
          id: facilities.id,
          name: facilities.name,
          city: facilities.city,
          state: facilities.state,
          active: facilities.active,
        })
        .from(facilities)
        .where(eq(facilities.organizationId, data.organizationId))
        .orderBy(desc(facilities.active), asc(facilities.name)),
      db
        .select({
          id: memberships.id,
          userId: memberships.userId,
          role: memberships.role,
          facilityId: memberships.facilityId,
          active: memberships.active,
          createdAt: memberships.createdAt,
        })
        .from(memberships)
        .where(eq(memberships.organizationId, data.organizationId))
        .orderBy(desc(memberships.active), asc(memberships.createdAt)),
      getCurrentLicense(data.organizationId),
    ]);

    if (!organization) throw new Error("NOT_FOUND:ORGANIZATION");

    const userIds = [...new Set(membershipRows.map((row) => row.userId))];
    const authUsers = userIds.length
      ? await getPool().query<{
          id: string;
          name: string | null;
          email: string;
          emailVerified: boolean;
          role: string | null;
        }>(
          'select id, name, email, "emailVerified", role from "user" where id = any($1::text[])',
          [userIds],
        )
      : { rows: [] as Array<{ id: string; name: string | null; email: string; emailVerified: boolean; role: string | null }> };

    const usersById = new Map(authUsers.rows.map((user) => [user.id, user]));
    const facilitiesById = new Map(facilityRows.map((facility) => [facility.id, facility]));
    const activeUserCount = new Set(
      membershipRows.filter((row) => row.active).map((row) => row.userId),
    ).size;
    const activeFacilityCount = facilityRows.filter((facility) => facility.active).length;

    return {
      organization,
      facilities: facilityRows,
      members: membershipRows.map((member) => {
        const user = usersById.get(member.userId);
        return {
          id: member.id,
          userId: member.userId,
          name: user?.name?.trim() || "Usuário",
          email: user?.email ?? "",
          emailVerified: user?.emailVerified ?? false,
          authRole: user?.role ?? "user",
          role: member.role,
          facilityId: member.facilityId,
          facilityName: member.facilityId ? facilitiesById.get(member.facilityId)?.name ?? "Unidade" : null,
          active: member.active,
          createdAt: member.createdAt.toISOString(),
          isCurrentUser: member.userId === session.user.id,
        };
      }),
      license: license
        ? {
            plan: license.plan,
            status: license.status,
            validFrom: license.validFrom.toISOString(),
            validUntil: license.validUntil?.toISOString() ?? null,
            maxFacilities: license.maxFacilities,
            maxUsers: license.maxUsers,
            offlineGraceDays: license.offlineGraceDays,
          }
        : null,
      usage: {
        activeFacilities: activeFacilityCount,
        activeUsers: activeUserCount,
      },
    };
  });

export const updateProductionOrganization = createServerFn({ method: "POST" })
  .validator(updateOrganizationSchema)
  .handler(async ({ data }) => {
    const { session } = await authorizeOrganization(data.organizationId, "organization.manage");
    const db = getDb();
    const [before] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, data.organizationId))
      .limit(1);
    if (!before) throw new Error("NOT_FOUND:ORGANIZATION");

    const [after] = await db
      .update(organizations)
      .set({
        name: data.name,
        legalName: data.legalName || null,
        document: data.document || null,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, data.organizationId))
      .returning();
    if (!after) throw new Error("ORGANIZATION_UPDATE_FAILED");

    await writeAuditEvent({
      organizationId: data.organizationId,
      actorUserId: session.user.id,
      eventType: "organization.updated",
      entityType: "organization",
      entityId: data.organizationId,
      before: { name: before.name, legalName: before.legalName, document: before.document },
      after: { name: after.name, legalName: after.legalName, document: after.document },
    });
    return { ok: true };
  });

export const createProductionFacility = createServerFn({ method: "POST" })
  .validator(createFacilitySchema)
  .handler(async ({ data }) => {
    const { session } = await authorizeOrganization(data.organizationId, "organization.manage");
    await assertFacilityLimit(data.organizationId);
    const [created] = await getDb()
      .insert(facilities)
      .values({
        organizationId: data.organizationId,
        name: data.facility.name,
        city: data.facility.city || null,
        state: data.facility.state || null,
      })
      .returning();
    if (!created) throw new Error("FACILITY_CREATE_FAILED");

    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: created.id,
      actorUserId: session.user.id,
      eventType: "facility.created",
      entityType: "facility",
      entityId: created.id,
      after: { name: created.name, city: created.city, state: created.state },
    });
    return { id: created.id };
  });

export const updateProductionFacility = createServerFn({ method: "POST" })
  .validator(updateFacilitySchema)
  .handler(async ({ data }) => {
    const { session } = await authorizeOrganization(data.organizationId, "users.manage");
    const db = getDb();
    const [before] = await db
      .select()
      .from(facilities)
      .where(
        and(
          eq(facilities.id, data.facilityId),
          eq(facilities.organizationId, data.organizationId),
        ),
      )
      .limit(1);
    if (!before) throw new Error("NOT_FOUND:FACILITY");

    const [after] = await db
      .update(facilities)
      .set({
        name: data.facility.name,
        city: data.facility.city || null,
        state: data.facility.state || null,
        updatedAt: new Date(),
      })
      .where(eq(facilities.id, before.id))
      .returning();
    if (!after) throw new Error("FACILITY_UPDATE_FAILED");

    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: after.id,
      actorUserId: session.user.id,
      eventType: "facility.updated",
      entityType: "facility",
      entityId: after.id,
      before: { name: before.name, city: before.city, state: before.state },
      after: { name: after.name, city: after.city, state: after.state },
    });
    return { ok: true };
  });

export const archiveProductionFacility = createServerFn({ method: "POST" })
  .validator(archiveFacilitySchema)
  .handler(async ({ data }) => {
    const { session } = await authorizeOrganization(data.organizationId, "organization.manage");
    const db = getDb();
    const activeFacilities = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.organizationId, data.organizationId), eq(facilities.active, true)));
    if (activeFacilities.length <= 1) throw new Error("LAST_FACILITY_REQUIRED");

    const [target] = await db
      .select()
      .from(facilities)
      .where(
        and(
          eq(facilities.id, data.facilityId),
          eq(facilities.organizationId, data.organizationId),
          eq(facilities.active, true),
        ),
      )
      .limit(1);
    if (!target) throw new Error("NOT_FOUND:FACILITY");

    const directMembers = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, data.organizationId),
          eq(memberships.facilityId, data.facilityId),
          eq(memberships.active, true),
        ),
      )
      .limit(1);
    if (directMembers.length > 0) throw new Error("FACILITY_HAS_ACTIVE_MEMBERS");

    await db
      .update(facilities)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(facilities.id, target.id));

    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: target.id,
      actorUserId: session.user.id,
      eventType: "facility.archived",
      entityType: "facility",
      entityId: target.id,
      before: { active: true, name: target.name },
      after: { active: false, name: target.name },
    });
    return { ok: true };
  });

export const createProductionMember = createServerFn({ method: "POST" })
  .validator(createMemberSchema)
  .handler(async ({ data }) => {
    const { session } = await authorizeOrganization(data.organizationId, "users.manage");
    validateRoleScope(data.role, data.facilityId);
    await assertFacilityBelongsToOrganization(data.organizationId, data.facilityId);

    const pool = getPool();
    const existingAuthResult = await pool.query<{ id: string; email: string }>(
      'select id, email from "user" where lower(email) = lower($1) limit 1',
      [data.email],
    );
    let userId = existingAuthResult.rows[0]?.id ?? null;

    if (userId) {
      const assigned = await getDb()
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.userId, userId))
        .limit(1);
      if (assigned.length > 0) throw new Error("USER_ACCOUNT_ALREADY_ASSIGNED");
    } else {
      await assertUserLimit(data.organizationId);
      await getAuth().api.createUser({
        body: {
          email: data.email,
          password: data.temporaryPassword,
          name: data.name,
          role: "user",
        },
      });
      const createdAuthResult = await pool.query<{ id: string }>(
        'select id from "user" where lower(email) = lower($1) limit 1',
        [data.email],
      );
      userId = createdAuthResult.rows[0]?.id ?? null;
      if (!userId) throw new Error("AUTH_USER_CREATE_FAILED");
    }

    await assertUserLimit(data.organizationId, userId);

    const duplicate = await getDb()
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, data.organizationId),
          eq(memberships.userId, userId),
          data.facilityId ? eq(memberships.facilityId, data.facilityId) : isNull(memberships.facilityId),
        ),
      )
      .limit(1);
    if (duplicate.length > 0) throw new Error("MEMBERSHIP_ALREADY_EXISTS");

    const [membership] = await getDb()
      .insert(memberships)
      .values({
        organizationId: data.organizationId,
        facilityId: data.facilityId,
        userId,
        role: data.role,
        active: true,
      })
      .returning({ id: memberships.id });
    if (!membership) throw new Error("MEMBERSHIP_CREATE_FAILED");

    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: data.facilityId,
      actorUserId: session.user.id,
      eventType: "membership.created",
      entityType: "membership",
      entityId: membership.id,
      after: {
        userId,
        email: data.email,
        role: data.role,
        facilityId: data.facilityId,
        active: true,
      },
      metadata: { temporaryPasswordStored: false },
    });

    return { id: membership.id, userId };
  });

export const updateProductionMember = createServerFn({ method: "POST" })
  .validator(updateMemberSchema)
  .handler(async ({ data }) => {
    const { session, scope } = await authorizeOrganization(data.organizationId, "users.manage");
    validateRoleScope(data.role, data.facilityId);
    await assertFacilityBelongsToOrganization(data.organizationId, data.facilityId);

    const db = getDb();
    const [before] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.id, data.membershipId),
          eq(memberships.organizationId, data.organizationId),
        ),
      )
      .limit(1);
    if (!before) throw new Error("NOT_FOUND:MEMBERSHIP");
    if (before.role === "super_admin" && scope.role !== "super_admin") {
      throw new Error("FORBIDDEN:SUPER_ADMIN_MEMBERSHIP");
    }
    if (
      before.userId === session.user.id &&
      (!data.active || data.role !== "admin_empresa" || data.facilityId !== null)
    ) {
      throw new Error("SELF_ADMIN_MEMBERSHIP_PROTECTED");
    }

    if (data.active && !before.active) await assertUserLimit(data.organizationId, before.userId);

    if (before.active && before.role === "admin_empresa" && before.facilityId === null) {
      const otherAdmins = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, data.organizationId),
            eq(memberships.active, true),
            eq(memberships.role, "admin_empresa"),
            isNull(memberships.facilityId),
            ne(memberships.id, before.id),
          ),
        );
      if (otherAdmins.length === 0 && (!data.active || data.role !== "admin_empresa" || data.facilityId !== null)) {
        throw new Error("LAST_ORGANIZATION_ADMIN_REQUIRED");
      }
    }

    const [after] = await db
      .update(memberships)
      .set({
        role: data.role,
        facilityId: data.facilityId,
        active: data.active,
        updatedAt: new Date(),
      })
      .where(eq(memberships.id, before.id))
      .returning();
    if (!after) throw new Error("MEMBERSHIP_UPDATE_FAILED");

    await writeAuditEvent({
      organizationId: data.organizationId,
      facilityId: data.facilityId ?? before.facilityId,
      actorUserId: session.user.id,
      eventType: "membership.updated",
      entityType: "membership",
      entityId: after.id,
      before: {
        userId: before.userId,
        role: before.role,
        facilityId: before.facilityId,
        active: before.active,
      },
      after: {
        userId: after.userId,
        role: after.role,
        facilityId: after.facilityId,
        active: after.active,
      },
    });
    return { ok: true };
  });
