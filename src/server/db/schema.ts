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

export const membershipRole = pgEnum("membership_role", [
  "super_admin",
  "admin_empresa",
  "gestor_unidade",
  "responsavel_tecnico",
  "inspetor",
  "leitor",
]);

export const requirementStatus = pgEnum("requirement_status", [
  "atendido",
  "pendente",
  "critico",
  "nao_aplicavel",
]);

export const requirementLifecycle = pgEnum("requirement_lifecycle", [
  "rascunho",
  "em_revisao",
  "validado",
  "publicado",
  "obsoleto",
]);

export const severity = pgEnum("severity", ["baixa", "media", "alta"]);
export const inspectionStatus = pgEnum("inspection_status", ["em_andamento", "concluida", "cancelada"]);
export const actionStatus = pgEnum("action_status", [
  "nao_iniciada",
  "em_andamento",
  "aguardando_evidencia",
  "concluida",
  "cancelada",
]);
export const nonconformityStatus = pgEnum("nonconformity_status", [
  "aberta",
  "em_tratamento",
  "resolvida",
  "cancelada",
]);
export const sourceType = pgEnum("source_type", [
  "interno",
  "externa_nao_verificada",
  "externa_verificada",
]);
export const evidenceType = pgEnum("evidence_type", ["foto", "documento", "registro"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    document: text("document"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex("organizations_document_uidx").on(table.document)],
);

export const facilities = pgTable(
  "facilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    city: text("city"),
    state: text("state"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("facilities_organization_idx").on(table.organizationId)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id").references(() => facilities.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: membershipRole("role").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("memberships_user_idx").on(table.userId),
    index("memberships_org_idx").on(table.organizationId),
    uniqueIndex("memberships_scope_uidx").on(table.organizationId, table.facilityId, table.userId),
  ],
);

export const silos = pgTable(
  "silos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    capacityTonnes: integer("capacity_tonnes").notNull().default(0),
    inspectionPeriodDays: integer("inspection_period_days").notNull().default(90),
    notes: text("notes").notNull().default(""),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("silos_facility_idx").on(table.facilityId),
    uniqueIndex("silos_facility_code_uidx").on(table.facilityId, table.code),
  ],
);

export const requirementSources = pgTable(
  "requirement_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: sourceType("type").notNull(),
    title: text("title").notNull(),
    issuer: text("issuer"),
    version: text("version"),
    section: text("section"),
    officialUrl: text("official_url"),
    consultedAt: timestamp("consulted_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    notes: text("notes").notNull().default(""),
    ...timestamps,
  },
  (table) => [index("requirement_sources_org_idx").on(table.organizationId)],
);

export const requirements = pgTable(
  "requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    lifecycle: requirementLifecycle("lifecycle").notNull().default("rascunho"),
    activeVersionId: uuid("active_version_id"),
    ...timestamps,
  },
  (table) => [uniqueIndex("requirements_org_code_uidx").on(table.organizationId, table.code)],
);

export const requirementVersions = pgTable(
  "requirement_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    description: text("description").notNull(),
    severity: severity("severity").notNull(),
    evidenceRequired: boolean("evidence_required").notNull().default(false),
    internalPeriodDays: integer("internal_period_days"),
    sourceId: uuid("source_id").references(() => requirementSources.id, { onDelete: "set null" }),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("requirement_versions_req_idx").on(table.requirementId),
    uniqueIndex("requirement_versions_version_uidx").on(table.requirementId, table.version),
  ],
);

export const requirementSilos = pgTable(
  "requirement_silos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    siloId: uuid("silo_id")
      .notNull()
      .references(() => silos.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("requirement_silos_uidx").on(table.requirementId, table.siloId)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    siloId: uuid("silo_id").references(() => silos.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    responsibleUserId: text("responsible_user_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    activeVersionId: uuid("active_version_id"),
    ...timestamps,
  },
  (table) => [index("documents_facility_idx").on(table.facilityId)],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("document_versions_document_idx").on(table.documentId),
    uniqueIndex("document_versions_number_uidx").on(table.documentId, table.version),
  ],
);

export const inspections = pgTable(
  "inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    siloId: uuid("silo_id")
      .notNull()
      .references(() => silos.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    type: text("type").notNull(),
    status: inspectionStatus("status").notNull().default("em_andamento"),
    inspectorUserId: text("inspector_user_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes").notNull().default(""),
    deviceId: text("device_id"),
    syncRevision: integer("sync_revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("inspections_facility_idx").on(table.facilityId),
    uniqueIndex("inspections_facility_code_uidx").on(table.facilityId, table.code),
  ],
);

export const inspectionItems = pgTable(
  "inspection_items",
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
    result: requirementStatus("result").notNull(),
    notes: text("notes").notNull().default(""),
    answeredBy: text("answered_by").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [index("inspection_items_inspection_idx").on(table.inspectionId)],
);

export const nonconformities = pgTable(
  "nonconformities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    siloId: uuid("silo_id").references(() => silos.id, { onDelete: "set null" }),
    requirementId: uuid("requirement_id").references(() => requirements.id, { onDelete: "set null" }),
    inspectionId: uuid("inspection_id").references(() => inspections.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    severity: severity("severity").notNull(),
    status: nonconformityStatus("status").notNull().default("aberta"),
    responsibleUserId: text("responsible_user_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("nonconformities_facility_idx").on(table.facilityId),
    uniqueIndex("nonconformities_facility_code_uidx").on(table.facilityId, table.code),
  ],
);

export const correctiveActions = pgTable(
  "corrective_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    nonconformityId: uuid("nonconformity_id").references(() => nonconformities.id, {
      onDelete: "set null",
    }),
    siloId: uuid("silo_id").references(() => silos.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    responsibleUserId: text("responsible_user_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    priority: severity("priority").notNull(),
    status: actionStatus("status").notNull().default("nao_iniciada"),
    notes: text("notes").notNull().default(""),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("corrective_actions_facility_idx").on(table.facilityId),
    uniqueIndex("corrective_actions_facility_code_uidx").on(table.facilityId, table.code),
  ],
);

export const evidences = pgTable(
  "evidences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    siloId: uuid("silo_id").references(() => silos.id, { onDelete: "set null" }),
    type: evidenceType("type").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    storageKey: text("storage_key"),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    capturedBy: text("captured_by").notNull(),
    deviceId: text("device_id"),
    latitudeE6: integer("latitude_e6"),
    longitudeE6: integer("longitude_e6"),
    ...timestamps,
  },
  (table) => [index("evidences_facility_idx").on(table.facilityId)],
);

export const evidenceLinks = pgTable(
  "evidence_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidences.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id").references(() => requirements.id, { onDelete: "cascade" }),
    inspectionId: uuid("inspection_id").references(() => inspections.id, { onDelete: "cascade" }),
    inspectionItemId: uuid("inspection_item_id").references(() => inspectionItems.id, {
      onDelete: "cascade",
    }),
    nonconformityId: uuid("nonconformity_id").references(() => nonconformities.id, {
      onDelete: "cascade",
    }),
    correctiveActionId: uuid("corrective_action_id").references(() => correctiveActions.id, {
      onDelete: "cascade",
    }),
    ...timestamps,
  },
  (table) => [index("evidence_links_evidence_idx").on(table.evidenceId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    facilityId: uuid("facility_id").references(() => facilities.id, { onDelete: "restrict" }),
    actorUserId: text("actor_user_id").notNull(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("audit_events_org_time_idx").on(table.organizationId, table.occurredAt),
    index("audit_events_entity_idx").on(table.entityType, table.entityId),
  ],
);
