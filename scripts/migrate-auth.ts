import { getMigrations } from "better-auth/db/migration";
import { getAuth } from "../src/server/auth";
import { getPool } from "../src/server/db/client";

async function main() {
  const auth = getAuth();
  const { runMigrations, toBeCreated, toBeAdded } = await getMigrations(auth.options);

  if (toBeCreated.length === 0 && toBeAdded.length === 0) {
    console.log("Better Auth schema already up to date.");
    return;
  }

  console.log(
    `Applying Better Auth schema: ${toBeCreated.length} table(s), ${toBeAdded.length} column(s).`,
  );
  await runMigrations();
  console.log("Better Auth schema migrated successfully.");
}

main()
  .catch((error) => {
    console.error("Better Auth migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => undefined);
  });
