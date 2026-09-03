import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { getPool } from "../src/server/db/client";
import { getServerEnv } from "../src/server/env";
import { resolveObjectPath } from "../src/server/files/filesystem-storage";

async function main() {
  const { rows } = await getPool().query<{ storage_key: string; sha256: string }>(
    "select storage_key, sha256 from document_versions union all select storage_key, sha256 from evidences where storage_key is not null",
  );
  for (const row of rows) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(
      resolveObjectPath(getServerEnv().FILE_STORAGE_PATH, row.storage_key),
    ))
      hash.update(chunk);
    if (hash.digest("hex") !== row.sha256) throw new Error("Restored file hash mismatch");
  }
  console.log("Verified " + rows.length + " database file references.");
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Storage verification failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
