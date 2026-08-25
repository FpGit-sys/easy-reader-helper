import { eq } from "drizzle-orm";
import { getAuth } from "../src/server/auth";
import { getDb, getPool } from "../src/server/db/client";
import {
  facilities,
  memberships,
  organizations,
  requirementSilos,
  requirementSources,
  requirements,
  requirementVersions,
  silos,
} from "../src/server/db/schema";
import { devicePairingCodes, licenses } from "../src/server/db/schema.extensions";
import { pairingCodeHash } from "../src/server/offline/crypto";

const ADMIN_EMAIL = "ci-admin@silonr.test";
const ADMIN_PASSWORD = "Silonr-CI-Password-2026!";
export const CI_PAIRING_CODE = "CI2026-ACTIVE-OFFLINE";

const ids = {
  organizationA: "30000000-0000-4000-8000-000000000001",
  organizationB: "30000000-0000-4000-8000-000000000002",
  facilityA: "40000000-0000-4000-8000-000000000001",
  facilityB: "40000000-0000-4000-8000-000000000002",
  siloA: "50000000-0000-4000-8000-000000000001",
  sourceA: "51000000-0000-4000-8000-000000000001",
  requirementA: "52000000-0000-4000-8000-000000000001",
  requirementVersionA: "53000000-0000-4000-8000-000000000001",
  requirementSiloA: "54000000-0000-4000-8000-000000000001",
};

async function main() {
  const auth = getAuth();
  await auth.api.createUser({
    body: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      name: "CI Admin",
      role: "admin",
    },
  });

  const pool = getPool();
  const authUserResult = await pool.query<{ id: string }>(
    'select id from "user" where lower(email) = lower($1) limit 1',
    [ADMIN_EMAIL],
  );
  const userId = authUserResult.rows[0]?.id;
  if (!userId) throw new Error("CI_AUTH_USER_NOT_CREATED");

  const db = getDb();
  await db.delete(organizations).where(eq(organizations.id, ids.organizationA));
  await db.delete(organizations).where(eq(organizations.id, ids.organizationB));

  await db.insert(organizations).values([
    { id: ids.organizationA, name: "CI Tenant A" },
    { id: ids.organizationB, name: "CI Tenant B" },
  ]);
  await db.insert(facilities).values([
    {
      id: ids.facilityA,
      organizationId: ids.organizationA,
      name: "CI Unidade A",
      city: "Rio Verde",
      state: "GO",
    },
    {
      id: ids.facilityB,
      organizationId: ids.organizationB,
      name: "CI Unidade B",
      city: "Cristalina",
      state: "GO",
    },
  ]);
  await db.insert(memberships).values({
    organizationId: ids.organizationA,
    facilityId: null,
    userId,
    role: "admin_empresa",
    active: true,
  });
  await db.insert(licenses).values({
    organizationId: ids.organizationA,
    plan: "professional",
    status: "trial",
    validUntil: new Date(Date.now() + 7 * 86_400_000),
    maxFacilities: 2,
    maxUsers: 5,
    offlineGraceDays: 30,
  });

  await db.insert(silos).values({
    id: ids.siloA,
    organizationId: ids.organizationA,
    facilityId: ids.facilityA,
    code: "CI-S01",
    name: "Silo CI 01",
    type: "metálico",
    capacityTonnes: 10_000,
    inspectionPeriodDays: 30,
    notes: "Silo determinístico para o E2E offline.",
    active: true,
  });

  await db.insert(requirementSources).values({
    id: ids.sourceA,
    organizationId: ids.organizationA,
    type: "interno",
    title: "Critério interno de teste CI",
    notes: "Fonte interna fictícia usada somente pelo pipeline automatizado.",
  });

  await db.insert(requirements).values({
    id: ids.requirementA,
    organizationId: ids.organizationA,
    code: "CI-REQ-001",
    title: "Registrar evidência fotográfica de teste",
    category: "E2E offline",
    lifecycle: "rascunho",
  });

  await db.insert(requirementVersions).values({
    id: ids.requirementVersionA,
    organizationId: ids.organizationA,
    requirementId: ids.requirementA,
    version: 1,
    description:
      "Critério fictício para provar snapshot, evidência, conflito, idempotência e conclusão offline no CI.",
    severity: "alta",
    evidenceRequired: true,
    internalPeriodDays: 30,
    sourceId: ids.sourceA,
    publishedBy: userId,
    publishedAt: new Date(),
  });

  await db
    .update(requirements)
    .set({
      activeVersionId: ids.requirementVersionA,
      lifecycle: "publicado",
      updatedAt: new Date(),
    })
    .where(eq(requirements.id, ids.requirementA));

  await db.insert(requirementSilos).values({
    id: ids.requirementSiloA,
    organizationId: ids.organizationA,
    requirementId: ids.requirementA,
    siloId: ids.siloA,
  });

  await db.insert(devicePairingCodes).values({
    organizationId: ids.organizationA,
    facilityId: ids.facilityA,
    userId,
    codeHash: pairingCodeHash(CI_PAIRING_CODE),
    createdBy: userId,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });

  console.log(
    JSON.stringify({
      email: ADMIN_EMAIL,
      organizationA: ids.organizationA,
      organizationB: ids.organizationB,
      facilityA: ids.facilityA,
      facilityB: ids.facilityB,
      siloA: ids.siloA,
      requirementA: ids.requirementA,
      requirementVersionA: ids.requirementVersionA,
      pairingCode: CI_PAIRING_CODE,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => undefined);
  });
