import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  facilities,
  inspections,
  organizations,
  requirements,
  requirementStatus,
  requirementVersions,
  silos,
} from "./schema";

export const licenseStatus = pgEnum("license_status", [
  "trial",
  "active",
  "suspended",
  "expired",
  "cancelled",
]);

/**
 * Current operational state of a requirement in one facility/silo.
 * Historical inspection answers remain immutable in inspection_items; this table
 * is the current projection used by dashboards and task management.
 */
export const requirementStates = pgTable(
  "requirement_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    siloId: uuid("silo_id").references(() => silos.id, { onDelete: "cascade" }),
    applicable: boolean("applicable").notNull().default(true),
    status: requirementStatus("status").notNull().default("pendente"),
    responsibleUserId: text("responsible_user_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    lastAssessedAt: timestamp("last_assessed_at", { withTimezone: true }),
    updatedBy: text("updated_by").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("requirement_states_facility_idx").on(table.facilityId),
    index("requirement_states_requirement_idx").on(table.requirementId),
    uniqueIndex("requirement_states_facility_scope_uidx")
      .on(table.organizationId, table.facilityId, table.requirementId)
      .where(sql`${table.siloId} is null`),
    uniqueIndex("requirement_states_silo_scope_uidx")
      .on(table.organizationId, table.facilityId, table.requirementId, table.siloId)
      .where(sql`${table.siloId} is not null`),
  ],
);

/**
 * Frozen checklist definition captured when an inspection starts.
 * It prevents later edits to requirement titles, source metadata or active
 * versions from silently changing what the inspector was asked to assess.
 */
export const inspectionChecklistSnapshots = pgTable(
  "inspection_checklist_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    inspectionId: uuid("inspection_id")
      .notNull()
      .references(() => inspections.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "restrict" }),
    requirementVersionId: uuid("requirement_version_id")
      .notNull()
      .references(() => requirementVersions.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inspection_checklist_snapshot_inspection_idx").on(table.inspectionId),
    uniqueIndex("inspection_checklist_snapshot_req_uidx").on(
      table.inspectionId,
      table.requirementId,
    ),
  ],
);

export const licenses = pgTable(
  "licenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    plan: text("plan").notNull().default("professional"),
    status: licenseStatus("status").notNull().default("trial"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    maxFacilities: integer("max_facilities").notNull().default(1),
    maxUsers: integer("max_users").notNull().default(5),
    offlineGraceDays: integer("offline_grace_days").notNull().default(30),
    licenseKeyHash: text("license_key_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("licenses_org_idx").on(table.organizationId),
    uniqueIndex("licenses_key_hash_uidx").on(table.licenseKeyHash),
  ],
);

/**
 * Registered desktop installations. The bearer token is never stored in clear
 * text on the server; only its SHA-256 digest is persisted.
 */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id").references(() => facilities.id, { onDelete: "set null" }),
    userId: text("user_id"),
    deviceFingerprintHash: text("device_fingerprint_hash").notNull(),
    authTokenHash: text("auth_token_hash"),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    appVersion: text("app_version").notNull(),
    syncProtocolVersion: integer("sync_protocol_version").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastPackAt: timestamp("last_pack_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("devices_org_idx").on(table.organizationId),
    index("devices_facility_idx").on(table.facilityId),
    uniqueIndex("devices_org_fingerprint_uidx").on(
      table.organizationId,
      table.deviceFingerprintHash,
    ),
    uniqueIndex("devices_token_hash_uidx").on(table.authTokenHash),
  ],
);

/** Short-lived, single-use pairing codes generated by an authenticated user. */
export const devicePairingCodes = pgTable(
  "device_pairing_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    codeHash: text("code_hash").notNull(),
    createdBy: text("created_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("device_pairing_codes_scope_idx").on(table.organizationId, table.facilityId),
    uniqueIndex("device_pairing_codes_hash_uidx").on(table.codeHash),
  ],
);

/** Idempotency receipts for desktop sync events. */
export const offlineSyncReceipts = pgTable(
  "offline_sync_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    entityId: uuid("entity_id"),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("offline_sync_receipts_scope_idx").on(table.organizationId, table.facilityId),
    uniqueIndex("offline_sync_receipts_device_event_uidx").on(table.deviceId, table.eventId),
  ],
);