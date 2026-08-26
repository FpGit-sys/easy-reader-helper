import { eq } from "drizzle-orm";
import { z } from "zod";
import { makeAuditEventValues } from "../src/server/audit";
import { getDb, getPool } from "../src/server/db/client";
import { auditEvents, facilities, memberships, organizations } from "../src/server/db/schema";
import { licenses } from "../src/server/db/schema.extensions";

const argsSchema = z.object({
  email: z.string().email(),
  organization: z.string().trim().min(2).max(200),
  facility: z.string().trim().min(2).max(200),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(80).optional(),
  trialDays: z.coerce.number().int().min(1).max(365).default(30),
});

function parseArgs(argv: string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Valor ausente para --${key}`);
    values[key] = value;
    index += 1;
  }
  return argsSchema.parse({
    email: values.email,
    organization: values.organization,
    facility: values.facility,
    city: values.city,
    state: values.state,
    trialDays: values["trial-days"],
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = getPool();

  // Better Auth owns its own authentication tables. We intentionally only read
  // the stable core fields needed to link an already-created admin user to the
  // SiloNR tenant. Password creation remains Better Auth's responsibility.
  const authUserResult = await pool.query<{ id: string; email: string; role: string | null }>(
    'select id, email, role from "user" where lower(email) = lower($1) limit 1',
    [args.email],
  );
  const authUser = authUserResult.rows[0];
  if (!authUser) {
    throw new Error(
      `Usuário ${args.email} não encontrado. Crie o primeiro administrador com a CLI oficial do Better Auth antes de provisionar o tenant.`,
    );
  }
  if (!authUser.role?.split(",").map((role) => role.trim()).includes("admin")) {
    throw new Error("O usuário informado não possui o papel administrativo do Better Auth.");
  }

  const db = getDb();
  const existingMembership = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.userId, authUser.id))
    .limit(1);
  if (existingMembership.length > 0) {
    throw new Error("Este usuário já está vinculado a um tenant do SiloNR. Operação cancelada.");
  }

  const organizationId = crypto.randomUUID();
  const facilityId = crypto.randomUUID();
  const validUntil = new Date(Date.now() + args.trialDays * 86_400_000);

  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({
      id: organizationId,
      name: args.organization,
    });
    await tx.insert(facilities).values({
      id: facilityId,
      organizationId,
      name: args.facility,
      city: args.city ?? null,
      state: args.state ?? null,
    });
    await tx.insert(memberships).values({
      organizationId,
      facilityId: null,
      userId: authUser.id,
      role: "admin_empresa",
      active: true,
    });
    await tx.insert(licenses).values({
      organizationId,
      plan: "professional",
      status: "trial",
      validUntil,
      maxFacilities: 1,
      maxUsers: 5,
      offlineGraceDays: 30,
    });
    await tx.insert(auditEvents).values(
      makeAuditEventValues({
        organizationId,
        facilityId,
        actorUserId: authUser.id,
        eventType: "tenant.provisioned",
        entityType: "organization",
        entityId: organizationId,
        after: {
          organizationName: args.organization,
          facilityName: args.facility,
          trialDays: args.trialDays,
          provisionedAdminEmail: authUser.email,
        },
        metadata: { source: "provision-tenant-cli" },
      }),
    );
  });

  console.log("SiloNR tenant provisionado com sucesso.");
  console.log(`Organização: ${args.organization}`);
  console.log(`Unidade: ${args.facility}`);
  console.log(`Administrador: ${authUser.email}`);
  console.log(`Trial válido até: ${validUntil.toISOString().slice(0, 10)}`);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Falha ao provisionar tenant: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => undefined);
  });
