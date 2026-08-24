import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  facilities,
  organizations,
  requirements,
  requirementStatus,
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
    uniqueIndex("requirement_states_scope_uidx").on(
      table.organizationId,
      table.facilityId,
      table.requirementId,
      table.siloId,
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
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    appVersion: text("app_version").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("devices_org_idx").on(table.organizationId),
    uniqueIndex("devices_org_fingerprint_uidx").on(
      table.organizationId,
      table.deviceFingerprintHash,
    ),
  ],
);
