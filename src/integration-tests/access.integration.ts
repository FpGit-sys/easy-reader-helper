import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/server/db/client";
import { facilities, memberships, organizations } from "@/server/db/schema";
import { resolveAccessScope } from "@/server/access";

const ids = {
  orgA: "10000000-0000-4000-8000-000000000001",
  orgB: "10000000-0000-4000-8000-000000000002",
  facilityA1: "20000000-0000-4000-8000-000000000001",
  facilityA2: "20000000-0000-4000-8000-000000000002",
  facilityB1: "20000000-0000-4000-8000-000000000003",
};

const users = {
  adminA: "integration-admin-a",
  inspectorA: "integration-inspector-a",
  inactiveA: "integration-inactive-a",
  adminB: "integration-admin-b",
};

beforeAll(async () => {
  const db = getDb();
  await db.delete(organizations);

  await db.insert(organizations).values([
    { id: ids.orgA, name: "Tenant A" },
    { id: ids.orgB, name: "Tenant B" },
  ]);

  await db.insert(facilities).values([
    { id: ids.facilityA1, organizationId: ids.orgA, name: "A1" },
    { id: ids.facilityA2, organizationId: ids.orgA, name: "A2" },
    { id: ids.facilityB1, organizationId: ids.orgB, name: "B1" },
  ]);

  await db.insert(memberships).values([
    {
      organizationId: ids.orgA,
      facilityId: null,
      userId: users.adminA,
      role: "admin_empresa",
      active: true,
    },
    {
      organizationId: ids.orgA,
      facilityId: ids.facilityA1,
      userId: users.inspectorA,
      role: "inspetor",
      active: true,
    },
    {
      organizationId: ids.orgA,
      facilityId: ids.facilityA1,
      userId: users.inactiveA,
      role: "inspetor",
      active: false,
    },
    {
      organizationId: ids.orgB,
      facilityId: null,
      userId: users.adminB,
      role: "admin_empresa",
      active: true,
    },
  ]);
});

afterAll(async () => {
  await getDb().delete(organizations);
  await getPool().end();
});

describe("isolamento multiempresa no banco", () => {
  it("permite administrador da organização acessar suas unidades", async () => {
    const scope = await resolveAccessScope({
      userId: users.adminA,
      organizationId: ids.orgA,
      facilityId: ids.facilityA2,
    });

    expect(scope.organizationId).toBe(ids.orgA);
    expect(scope.facilityId).toBe(ids.facilityA2);
    expect(scope.role).toBe("admin_empresa");
  });

  it("bloqueia tentativa de usar organizationId de outro cliente", async () => {
    await expect(
      resolveAccessScope({
        userId: users.adminA,
        organizationId: ids.orgB,
        facilityId: ids.facilityB1,
      }),
    ).rejects.toThrow("FORBIDDEN:TENANT_SCOPE");
  });

  it("bloqueia usuário limitado a uma unidade quando troca facilityId", async () => {
    await expect(
      resolveAccessScope({
        userId: users.inspectorA,
        organizationId: ids.orgA,
        facilityId: ids.facilityA2,
      }),
    ).rejects.toThrow("FORBIDDEN:TENANT_SCOPE");
  });

  it("permite usuário da unidade somente dentro do escopo contratado", async () => {
    const scope = await resolveAccessScope({
      userId: users.inspectorA,
      organizationId: ids.orgA,
      facilityId: ids.facilityA1,
    });

    expect(scope.role).toBe("inspetor");
    expect(scope.facilityId).toBe(ids.facilityA1);
  });

  it("ignora membership inativa", async () => {
    await expect(
      resolveAccessScope({
        userId: users.inactiveA,
        organizationId: ids.orgA,
        facilityId: ids.facilityA1,
      }),
    ).rejects.toThrow("FORBIDDEN:TENANT_SCOPE");
  });
});
