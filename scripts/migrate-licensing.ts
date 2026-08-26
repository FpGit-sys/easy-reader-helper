import { getPool } from "../src/server/db/client";

async function main() {
  await getPool().query(`
    create table if not exists silonr_license_leases (
      organization_id uuid primary key references organizations(id) on delete cascade,
      central_license_id uuid not null unique,
      installation_id uuid not null unique,
      installation_secret_ciphertext text not null,
      entitlement_token text not null,
      entitlement_expires_at timestamptz not null,
      subscription_valid_until timestamptz,
      grace_until timestamptz not null,
      central_status text not null check (central_status in ('available','trial','active','past_due','suspended','expired','cancelled')),
      entitlement_version bigint not null,
      last_checked_at timestamptz not null,
      last_server_time timestamptz not null,
      last_error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists silonr_license_leases_expiry_idx
      on silonr_license_leases (entitlement_expires_at);
  `);
  console.log("SiloNR licensing schema migrated successfully.");
}

main()
  .catch((error) => {
    console.error("SiloNR licensing migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => undefined);
  });
