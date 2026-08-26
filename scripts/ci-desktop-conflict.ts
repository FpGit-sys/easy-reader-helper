import { Pool } from "pg";

const inspectionId = process.env.SILONR_E2E_CONFLICT_INSPECTION_ID;
const databaseUrl = process.env.DATABASE_URL;

if (!inspectionId) throw new Error("SILONR_E2E_CONFLICT_INSPECTION_ID is required");
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });

try {
  const result = await pool.query<{ sync_revision: number }>(
    `UPDATE inspections
       SET sync_revision = sync_revision + 1,
           notes = 'Concorrência simulada pelo CI',
           updated_at = now()
     WHERE id = $1
     RETURNING sync_revision`,
    [inspectionId],
  );

  if (result.rowCount !== 1 || result.rows[0]?.sync_revision !== 2) {
    throw new Error(`Expected inspection ${inspectionId} to move to revision 2`);
  }

  console.log(`Desktop E2E conflict fixture moved ${inspectionId} to server revision 2.`);
} finally {
  await pool.end();
}
