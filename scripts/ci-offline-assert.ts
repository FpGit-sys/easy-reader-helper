import { eq } from "drizzle-orm";
import { getDb, getPool } from "../src/server/db/client";
import {
  evidences,
  inspections,
  nonconformities,
} from "../src/server/db/schema";
import { offlineSyncReceipts } from "../src/server/db/schema.extensions";

const INSPECTION_ID = "61000000-0000-4000-8000-000000000001";
const EVIDENCE_ID = "62000000-0000-4000-8000-000000000001";

async function main() {
  const db = getDb();

  const [inspection] = await db
    .select({
      id: inspections.id,
      status: inspections.status,
      syncRevision: inspections.syncRevision,
      deviceId: inspections.deviceId,
    })
    .from(inspections)
    .where(eq(inspections.id, INSPECTION_ID))
    .limit(1);

  if (!inspection) throw new Error("E2E_INSPECTION_NOT_PERSISTED");
  if (inspection.status !== "concluida") {
    throw new Error(`E2E_INSPECTION_NOT_COMPLETED:${inspection.status}`);
  }
  if (inspection.syncRevision !== 2) {
    throw new Error(`E2E_UNEXPECTED_SYNC_REVISION:${inspection.syncRevision}`);
  }
  if (!inspection.deviceId) throw new Error("E2E_INSPECTION_DEVICE_MISSING");

  const [evidence] = await db
    .select({ id: evidences.id, sha256: evidences.sha256, deviceId: evidences.deviceId })
    .from(evidences)
    .where(eq(evidences.id, EVIDENCE_ID))
    .limit(1);
  if (!evidence) throw new Error("E2E_EVIDENCE_NOT_PERSISTED");
  if (!/^[a-f0-9]{64}$/.test(evidence.sha256)) throw new Error("E2E_EVIDENCE_HASH_INVALID");
  if (evidence.deviceId !== inspection.deviceId) throw new Error("E2E_EVIDENCE_DEVICE_MISMATCH");

  const findings = await db
    .select({ id: nonconformities.id, status: nonconformities.status })
    .from(nonconformities)
    .where(eq(nonconformities.inspectionId, INSPECTION_ID));
  if (findings.length !== 1) {
    throw new Error(`E2E_EXPECTED_ONE_FINDING:${findings.length}`);
  }
  if (findings[0]?.status !== "aberta") {
    throw new Error(`E2E_FINDING_STATUS_INVALID:${findings[0]?.status}`);
  }

  const receipts = await db
    .select({ status: offlineSyncReceipts.result })
    .from(offlineSyncReceipts)
    .where(eq(offlineSyncReceipts.entityId, INSPECTION_ID));
  if (receipts.length !== 3) {
    throw new Error(`E2E_EXPECTED_THREE_SYNC_RECEIPTS:${receipts.length}`);
  }
  const statuses = receipts.map((row) => (row.status as { status?: string }).status).sort();
  if (statuses.filter((status) => status === "applied").length !== 2) {
    throw new Error(`E2E_EXPECTED_TWO_APPLIED_RECEIPTS:${statuses.join(",")}`);
  }
  if (!statuses.includes("conflict")) {
    throw new Error(`E2E_CONFLICT_RECEIPT_MISSING:${statuses.join(",")}`);
  }

  console.log(
    JSON.stringify({
      inspectionId: inspection.id,
      status: inspection.status,
      syncRevision: inspection.syncRevision,
      evidenceId: evidence.id,
      findings: findings.length,
      syncReceipts: receipts.length,
      receiptStatuses: statuses,
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
