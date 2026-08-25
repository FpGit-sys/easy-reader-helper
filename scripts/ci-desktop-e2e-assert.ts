import { Pool } from "pg";

const completedId = process.env.SILONR_E2E_COMPLETED_INSPECTION_ID;
const conflictId = process.env.SILONR_E2E_CONFLICT_INSPECTION_ID;
const databaseUrl = process.env.DATABASE_URL;

if (!completedId) throw new Error("SILONR_E2E_COMPLETED_INSPECTION_ID is required");
if (!conflictId) throw new Error("SILONR_E2E_CONFLICT_INSPECTION_ID is required");
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });

try {
  const completed = await pool.query<{
    status: string;
    sync_revision: number;
    evidence_count: string;
    finding_count: string;
  }>(
    `SELECT i.status,
            i.sync_revision,
            (SELECT count(*)::text
               FROM evidence_links el
              WHERE el.inspection_id = i.id) AS evidence_count,
            (SELECT count(*)::text
               FROM nonconformities nc
              WHERE nc.inspection_id = i.id) AS finding_count
       FROM inspections i
      WHERE i.id = $1`,
    [completedId],
  );

  const row = completed.rows[0];
  if (!row) throw new Error(`Completed inspection ${completedId} was not persisted`);
  if (row.status !== "concluida" || row.sync_revision !== 2) {
    throw new Error(`Unexpected completed inspection state: ${JSON.stringify(row)}`);
  }
  if (Number(row.evidence_count) < 1 || Number(row.finding_count) < 1) {
    throw new Error(`Expected evidence and nonconformity for completed inspection: ${JSON.stringify(row)}`);
  }

  const conflicted = await pool.query<{ status: string; sync_revision: number; notes: string }>(
    `SELECT status, sync_revision, notes FROM inspections WHERE id = $1`,
    [conflictId],
  );
  const conflict = conflicted.rows[0];
  if (!conflict) throw new Error(`Conflict inspection ${conflictId} was not persisted`);
  if (
    conflict.status !== "em_andamento" ||
    conflict.sync_revision !== 2 ||
    conflict.notes !== "Concorrência simulada pelo CI"
  ) {
    throw new Error(`Stale desktop event overwrote concurrent server state: ${JSON.stringify(conflict)}`);
  }

  console.log("Desktop E2E database assertions passed.");
} finally {
  await pool.end();
}
