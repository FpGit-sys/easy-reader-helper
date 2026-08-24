import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { memberships } from "@/server/db/schema";
import { assertPermission, type Permission, type Role } from "@/server/rbac";

export interface AccessScope {
  userId: string;
  organizationId: string;
  facilityId?: string | null;
  role: Role;
}

const ROLE_WEIGHT: Record<Role, number> = {
  super_admin: 100,
  admin_empresa: 80,
  gestor_unidade: 60,
  responsavel_tecnico: 50,
  inspetor: 30,
  leitor: 10,
};

export async function resolveAccessScope(input: {
  userId: string;
  organizationId: string;
  facilityId?: string | null;
}): Promise<AccessScope> {
  const db = getDb();
  const conditions = [
    eq(memberships.userId, input.userId),
    eq(memberships.organizationId, input.organizationId),
    eq(memberships.active, true),
  ];

  if (input.facilityId) {
    conditions.push(or(isNull(memberships.facilityId), eq(memberships.facilityId, input.facilityId))!);
  } else {
    conditions.push(isNull(memberships.facilityId));
  }

  const rows = await db
    .select({ role: memberships.role, facilityId: memberships.facilityId })
    .from(memberships)
    .where(and(...conditions));

  if (rows.length === 0) {
    throw new Error("FORBIDDEN:TENANT_SCOPE");
  }

  const best = rows.sort((a, b) => ROLE_WEIGHT[b.role] - ROLE_WEIGHT[a.role])[0];
  if (!best) throw new Error("FORBIDDEN:TENANT_SCOPE");

  return {
    userId: input.userId,
    organizationId: input.organizationId,
    facilityId: input.facilityId ?? best.facilityId,
    role: best.role,
  };
}

export async function requirePermission(input: {
  userId: string;
  organizationId: string;
  facilityId?: string | null;
  permission: Permission;
}) {
  const scope = await resolveAccessScope(input);
  assertPermission(scope.role, input.permission);
  return scope;
}
