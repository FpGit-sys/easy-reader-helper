import { createHash } from "node:crypto";
import { getDb } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";

export interface AuditEventInput {
  organizationId: string;
  facilityId?: string | null;
  actorUserId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

function hashIp(ip: string | null | undefined) {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex");
}

export function makeAuditEventValues(input: AuditEventInput) {
  return {
    organizationId: input.organizationId,
    facilityId: input.facilityId ?? null,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    ipHash: hashIp(input.ip),
    userAgent: input.userAgent ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    metadata: input.metadata ?? {},
  } satisfies typeof auditEvents.$inferInsert;
}

/**
 * Application code only exposes INSERT for audit events. There is intentionally
 * no update/delete helper. Database credentials used by the runtime should also
 * be denied UPDATE/DELETE on this table in hardened deployments.
 *
 * For business mutations that must be atomic with their audit event, insert
 * `makeAuditEventValues(input)` using the same Drizzle transaction.
 */
export async function writeAuditEvent(input: AuditEventInput) {
  const db = getDb();
  const [event] = await db
    .insert(auditEvents)
    .values(makeAuditEventValues(input))
    .returning({ id: auditEvents.id, occurredAt: auditEvents.occurredAt });

  if (!event) throw new Error("AUDIT_WRITE_FAILED");
  return event;
}
