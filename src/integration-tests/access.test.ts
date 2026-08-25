import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requirePermission, resolveAccessScope } from "@/server/access";
import { getDb, getPool } from "@/server/db/client";
import { facilities, memberships, organizations } from "@/server/db/schema";
import { devices, licenses } from "@/server/db/schema.extensions";
import { tokenHash } from "@/server/offline/crypto";
import { requireDevice } from "@/server/offline/device-auth";

const ids = {
  orgA: "10000000-0000-4000-8000-000000000001",
  orgB: "10000000-0000-4000-8000-000000000002",
  facilityA1: "20000000-0000-4000-8000-000000000001",
  facilityA2: "20000000-0000-4000-8000-000000000002",
  facilityB1: "20000000-0000-4000-8000-000000000003",
  activeDevice: "50000000-0000-4000-8000-000000000001",
  revokedDevice: "50000000-0000-4000-8000-000000000002",
};

const users = {
  adminA: "integration-admin-a",
  inspectorA: "integration-inspector-a",
  inactiveA: "integration-inactive-a",
  adminB: "integration-admin-b",
};

const ACTIVE_DEVICE_TOKEN = "slnr_integration_active_device_token_123456789";
const REVOKED_DEVICE_TOKEN = "slnr_integration_revoked_device_token_123456";

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

  await db.insert(licenses).values([
    {
      organizationId: ids.orgA,
      status: "active",
      plan: "integration",
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      offlineGraceDays: 30,
    },
    {
      organizationId: ids.orgB,
      status: "active",
      plan: "integration",
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      offlineGraceDays: 30,
    },
  ]);

  await db.insert(devices).values([
    {
      id: ids.activeDevice,
      organizationId: ids.orgA,
      facilityId: ids.facilityA1,
      userId: users.inspectorA,
      deviceFingerprintHash: "a".repeat(64),
      authTokenHash: tokenHash(ACTIVE_DEVICE_TOKEN),
      name: "Desktop A1",
      platform: "windows",
      appVersion: "integration",
      syncProtocolVersion: 1,
    },
    {
      id: ids.revokedDevice,
      organizationId: ids.orgA,
      facilityId: ids.facilityA1,
      userId: users.inspectorA,
      deviceFingerprintHash: "b".repeat(64),
      authTokenHash: tokenHash(REVOKED_DEVICE_TOKEN),
      name: "Desktop revogado",
      platform: "windows",
      appVersion: "integration",
      syncProtocolVersion: 1,
      revokedAt: new Date("2026-08-24T00:00:00.000Z"),
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

  it("aplica RBAC depois de resolver o tenant no servidor", async () => {
    await expect(
      requirePermission({
        userId: users.inspectorA,
        organizationId: ids.orgA,
        facilityId: ids.facilityA1,
        permission: "inspections.execute",
      }),
    ).resolves.toMatchObject({ role: "inspetor" });

    await expect(
      requirePermission({
        userId: users.inspectorA,
        organizationId: ids.orgA,
        facilityId: ids.facilityA1,
        permission: "users.manage",
      }),
    ).rejects.toThrow("FORBIDDEN:users.manage");
  });

  it("não deixa uma permissão válida atravessar para outro tenant", async () => {
    await expect(
      requirePermission({
        userId: users.adminA,
        organizationId: ids.orgB,
        facilityId: ids.facilityB1,
        permission: "users.manage",
      }),
    ).rejects.toThrow("FORBIDDEN:TENANT_SCOPE");
  });
});

describe("autenticação do computador offline", () => {
  it("resolve token do desktop somente para usuário, empresa e unidade vinculados", async () => {
    const request = new Request("https://silonr.test/api/offline/bootstrap", {
      headers: { authorization: `Bearer ${ACTIVE_DEVICE_TOKEN}` },
    });

    await expect(requireDevice(request)).resolves.toMatchObject({
      deviceId: ids.activeDevice,
      organizationId: ids.orgA,
      facilityId: ids.facilityA1,
      userId: users.inspectorA,
      facilityName: "A1",
      offlineGraceDays: 30,
    });
  });

  it("rejeita token de dispositivo inexistente", async () => {
    const request = new Request("https://silonr.test/api/offline/bootstrap", {
      headers: { authorization: "Bearer slnr_token_que_nao_existe" },
    });
    await expect(requireDevice(request)).rejects.toThrow("UNAUTHORIZED:DEVICE_SCOPE");
  });

  it("rejeita dispositivo revogado mesmo que o token antigo seja reapresentado", async () => {
    const request = new Request("https://silonr.test/api/offline/bootstrap", {
      headers: { authorization: `Bearer ${REVOKED_DEVICE_TOKEN}` },
    });
    await expect(requireDevice(request)).rejects.toThrow("UNAUTHORIZED:DEVICE_SCOPE");
  });

  it("revalida RBAC do usuário a cada uso do token do desktop", async () => {
    const db = getDb();
    await db
      .update(memberships)
      .set({ active: false })
      .where(eqMembershipUser(users.inspectorA));

    const request = new Request("https://silonr.test/api/offline/bootstrap", {
      headers: { authorization: `Bearer ${ACTIVE_DEVICE_TOKEN}` },
    });
    await expect(requireDevice(request)).rejects.toThrow("FORBIDDEN:TENANT_SCOPE");

    await db
      .update(memberships)
      .set({ active: true })
      .where(eqMembershipUser(users.inspectorA));
  });
});

function eqMembershipUser(userId: string) {
  return memberships.userId === userId;
}
