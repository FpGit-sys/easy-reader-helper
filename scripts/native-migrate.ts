import { getMigrations } from "better-auth/db/migration";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getCliAuth } from "../src/server/auth-cli";
import { getDb, getPool } from "../src/server/db/client";

async function main() {
  const folder = process.env.SILONR_MIGRATIONS_PATH;
  if (!folder) throw new Error("SILONR_MIGRATIONS_PATH is required");
  await migrate(getDb(), { migrationsFolder: folder });
  const { runMigrations } = await getMigrations(getCliAuth().options);
  await runMigrations();
  console.log("Database and authentication migrations completed.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
