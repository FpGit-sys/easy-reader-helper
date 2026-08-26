import { z } from "zod";
import { makeAuditEventValues } from "../src/server/audit";
import { getAuth } from "../src/server/auth";
import { getDb, getPool } from "../src/server/db/client";
import { auditEvents, facilities, memberships, organizations } from "../src/server/db/schema";
import { licenses } from "../src/server/db/schema.extensions";

const argsSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(2).max(120),
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
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Valor ausente para ${token}`);
    values[token.slice(2)] = value;
    index += 1;
  }
  return argsSchema.parse({
    email: values.email,
    name: values.name,
    organization: values.organization,
    facility: values.facility,
    city: values.city,
    state: values.state,
    trialDays: values["trial-days"],
  });
}

async function main() {
  if (process.env.SILONR_BOOTSTRAP_CONFIRM !== "BOOTSTRAP_SILONR_LOCAL") {
    throw new Error("Confirmação explícita ausente.");
  }
  const password = z.string().min(12).max(128).parse(process.env.SILONR_BOOTSTRAP_PASSWORD);
  const args = parseArgs(process.argv.slice(2));
  const pool = getPool();
  const counts = await pool.query<{ users: string; organizations: string }>(
    'select (select count(*) from "user")::text as users, (select count(*) from organizations)::text as organizations',
  );
  if (counts.rows[0]?.users !== "0" || counts.rows[0]?.organizations !== "0") {
    throw new Error("Bootstrap permitido somente em uma instalação local vazia.");
  }

  await getAuth().api.signUpEmail({ body: { email: args.email, name: args.name, password } });
  const userResult = await pool.query<{ id: string; email: string }>(
    'update "user" set role = $1, "updatedAt" = now() where lower(email) = lower($2) returning id, email',
    ["admin", args.email],
  );
  const authUser = userResult.rows[0];
  if (!authUser) throw new Error("Usuário administrativo não foi criado.");

  const db = getDb();
  const organizationId = crypto.randomUUID();
  const facilityId = crypto.randomUUID();
  const validUntil = new Date(Date.now() + args.trialDays * 86_400_000);
  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({ id: organizationId, name: args.organization });
    await tx.insert(facilities).values({ id: facilityId, organizationId, name: args.facility, city: args.city ?? null, state: args.state ?? null });
    await tx.insert(memberships).values({ organizationId, facilityId: null, userId: authUser.id, role: "admin_empresa", active: true });
    await tx.insert(licenses).values({ organizationId, plan: "professional", status: "trial", validUntil, maxFacilities: 1, maxUsers: 5, offlineGraceDays: 30 });
    await tx.insert(auditEvents).values(makeAuditEventValues({
      organizationId,
      facilityId,
      actorUserId: authUser.id,
      eventType: "tenant.provisioned",
      entityType: "organization",
      entityId: organizationId,
      after: { organizationName: args.organization, facilityName: args.facility, trialDays: args.trialDays, provisionedAdminEmail: authUser.email },
      metadata: { source: "local-bootstrap-cli" },
    }));
  });
  console.log(`Instalação local provisionada para ${authUser.email}; trial até ${validUntil.toISOString().slice(0, 10)}.`);
}

main()
  .catch((error) => {
    console.error(`Falha no bootstrap local: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => undefined);
  });
