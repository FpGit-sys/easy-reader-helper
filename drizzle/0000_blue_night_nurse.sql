CREATE TYPE "public"."action_status" AS ENUM('nao_iniciada', 'em_andamento', 'aguardando_evidencia', 'concluida', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('foto', 'documento', 'registro');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('em_andamento', 'concluida', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('super_admin', 'admin_empresa', 'gestor_unidade', 'responsavel_tecnico', 'inspetor', 'leitor');--> statement-breakpoint
CREATE TYPE "public"."nonconformity_status" AS ENUM('aberta', 'em_tratamento', 'resolvida', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."requirement_lifecycle" AS ENUM('rascunho', 'em_revisao', 'validado', 'publicado', 'obsoleto');--> statement-breakpoint
CREATE TYPE "public"."requirement_status" AS ENUM('atendido', 'pendente', 'critico', 'nao_aplicavel');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('baixa', 'media', 'alta');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('interno', 'externa_nao_verificada', 'externa_verificada');--> statement-breakpoint
CREATE TYPE "public"."license_status" AS ENUM('trial', 'active', 'suspended', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid,
	"actor_user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrective_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"nonconformity_id" uuid,
	"silo_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"responsible_user_id" text,
	"due_at" timestamp with time zone,
	"priority" "severity" NOT NULL,
	"status" "action_status" DEFAULT 'nao_iniciada' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"silo_id" uuid,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"responsible_user_id" text,
	"issued_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"active_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"requirement_id" uuid,
	"inspection_id" uuid,
	"inspection_item_id" uuid,
	"nonconformity_id" uuid,
	"corrective_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"silo_id" uuid,
	"type" "evidence_type" NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"storage_key" text,
	"original_filename" text,
	"mime_type" text,
	"size_bytes" integer,
	"sha256" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_by" text NOT NULL,
	"device_id" text,
	"latitude_e6" integer,
	"longitude_e6" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"state" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"requirement_version_id" uuid NOT NULL,
	"result" "requirement_status" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"answered_by" text NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"silo_id" uuid NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"status" "inspection_status" DEFAULT 'em_andamento' NOT NULL,
	"inspector_user_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"device_id" text,
	"sync_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid,
	"user_id" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nonconformities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"silo_id" uuid,
	"requirement_id" uuid,
	"inspection_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" "severity" NOT NULL,
	"status" "nonconformity_status" DEFAULT 'aberta' NOT NULL,
	"responsible_user_id" text,
	"due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"document" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_silos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"silo_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "source_type" NOT NULL,
	"title" text NOT NULL,
	"issuer" text,
	"version" text,
	"section" text,
	"official_url" text,
	"consulted_at" timestamp with time zone,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"description" text NOT NULL,
	"severity" "severity" NOT NULL,
	"evidence_required" boolean DEFAULT false NOT NULL,
	"internal_period_days" integer,
	"source_id" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"published_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"lifecycle" "requirement_lifecycle" DEFAULT 'rascunho' NOT NULL,
	"active_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "silos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"capacity_tonnes" integer DEFAULT 0 NOT NULL,
	"inspection_period_days" integer DEFAULT 90 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid,
	"user_id" text,
	"device_fingerprint_hash" text NOT NULL,
	"auth_token_hash" text,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text NOT NULL,
	"sync_protocol_version" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_pack_at" timestamp with time zone,
	"last_sync_error" text,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inspection_checklist_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"requirement_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan" text DEFAULT 'professional' NOT NULL,
	"status" "license_status" DEFAULT 'trial' NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"max_facilities" integer DEFAULT 1 NOT NULL,
	"max_users" integer DEFAULT 5 NOT NULL,
	"offline_grace_days" integer DEFAULT 30 NOT NULL,
	"license_key_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offline_sync_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"entity_id" uuid,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"silo_id" uuid,
	"applicable" boolean DEFAULT true NOT NULL,
	"status" "requirement_status" DEFAULT 'pendente' NOT NULL,
	"responsible_user_id" text,
	"due_at" timestamp with time zone,
	"last_assessed_at" timestamp with time zone,
	"updated_by" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_nonconformity_id_nonconformities_id_fk" FOREIGN KEY ("nonconformity_id") REFERENCES "public"."nonconformities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_silo_id_silos_id_fk" FOREIGN KEY ("silo_id") REFERENCES "public"."silos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_silo_id_silos_id_fk" FOREIGN KEY ("silo_id") REFERENCES "public"."silos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_evidence_id_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_inspection_item_id_inspection_items_id_fk" FOREIGN KEY ("inspection_item_id") REFERENCES "public"."inspection_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_nonconformity_id_nonconformities_id_fk" FOREIGN KEY ("nonconformity_id") REFERENCES "public"."nonconformities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_corrective_action_id_corrective_actions_id_fk" FOREIGN KEY ("corrective_action_id") REFERENCES "public"."corrective_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_silo_id_silos_id_fk" FOREIGN KEY ("silo_id") REFERENCES "public"."silos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_requirement_version_id_requirement_versions_id_fk" FOREIGN KEY ("requirement_version_id") REFERENCES "public"."requirement_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_silo_id_silos_id_fk" FOREIGN KEY ("silo_id") REFERENCES "public"."silos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_silo_id_silos_id_fk" FOREIGN KEY ("silo_id") REFERENCES "public"."silos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonconformities" ADD CONSTRAINT "nonconformities_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_silos" ADD CONSTRAINT "requirement_silos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_silos" ADD CONSTRAINT "requirement_silos_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_silos" ADD CONSTRAINT "requirement_silos_silo_id_silos_id_fk" FOREIGN KEY ("silo_id") REFERENCES "public"."silos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_sources" ADD CONSTRAINT "requirement_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_versions" ADD CONSTRAINT "requirement_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_versions" ADD CONSTRAINT "requirement_versions_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_versions" ADD CONSTRAINT "requirement_versions_source_id_requirement_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."requirement_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silos" ADD CONSTRAINT "silos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silos" ADD CONSTRAINT "silos_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_checklist_snapshots" ADD CONSTRAINT "inspection_checklist_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_checklist_snapshots" ADD CONSTRAINT "inspection_checklist_snapshots_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_checklist_snapshots" ADD CONSTRAINT "inspection_checklist_snapshots_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_checklist_snapshots" ADD CONSTRAINT "inspection_checklist_snapshots_requirement_version_id_requirement_versions_id_fk" FOREIGN KEY ("requirement_version_id") REFERENCES "public"."requirement_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sync_receipts" ADD CONSTRAINT "offline_sync_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sync_receipts" ADD CONSTRAINT "offline_sync_receipts_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_sync_receipts" ADD CONSTRAINT "offline_sync_receipts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_states" ADD CONSTRAINT "requirement_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_states" ADD CONSTRAINT "requirement_states_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_states" ADD CONSTRAINT "requirement_states_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_states" ADD CONSTRAINT "requirement_states_silo_id_silos_id_fk" FOREIGN KEY ("silo_id") REFERENCES "public"."silos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_time_idx" ON "audit_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "corrective_actions_facility_idx" ON "corrective_actions" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "corrective_actions_facility_code_uidx" ON "corrective_actions" USING btree ("facility_id","code");--> statement-breakpoint
CREATE INDEX "document_versions_document_idx" ON "document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_number_uidx" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "documents_facility_idx" ON "documents" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "evidence_links_evidence_idx" ON "evidence_links" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "evidences_facility_idx" ON "evidences" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "facilities_organization_idx" ON "facilities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "inspection_items_inspection_idx" ON "inspection_items" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "inspections_facility_idx" ON "inspections" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_facility_code_uidx" ON "inspections" USING btree ("facility_id","code");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "memberships" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_scope_uidx" ON "memberships" USING btree ("organization_id","facility_id","user_id");--> statement-breakpoint
CREATE INDEX "nonconformities_facility_idx" ON "nonconformities" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nonconformities_facility_code_uidx" ON "nonconformities" USING btree ("facility_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_document_uidx" ON "organizations" USING btree ("document");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_silos_uidx" ON "requirement_silos" USING btree ("requirement_id","silo_id");--> statement-breakpoint
CREATE INDEX "requirement_sources_org_idx" ON "requirement_sources" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "requirement_versions_req_idx" ON "requirement_versions" USING btree ("requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_versions_version_uidx" ON "requirement_versions" USING btree ("requirement_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "requirements_org_code_uidx" ON "requirements" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "silos_facility_idx" ON "silos" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "silos_facility_code_uidx" ON "silos" USING btree ("facility_id","code");--> statement-breakpoint
CREATE INDEX "device_pairing_codes_scope_idx" ON "device_pairing_codes" USING btree ("organization_id","facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_pairing_codes_hash_uidx" ON "device_pairing_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "devices_org_idx" ON "devices" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "devices_facility_idx" ON "devices" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_org_fingerprint_uidx" ON "devices" USING btree ("organization_id","device_fingerprint_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_hash_uidx" ON "devices" USING btree ("auth_token_hash");--> statement-breakpoint
CREATE INDEX "inspection_checklist_snapshot_inspection_idx" ON "inspection_checklist_snapshots" USING btree ("inspection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_checklist_snapshot_req_uidx" ON "inspection_checklist_snapshots" USING btree ("inspection_id","requirement_id");--> statement-breakpoint
CREATE INDEX "licenses_org_idx" ON "licenses" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "licenses_key_hash_uidx" ON "licenses" USING btree ("license_key_hash");--> statement-breakpoint
CREATE INDEX "offline_sync_receipts_scope_idx" ON "offline_sync_receipts" USING btree ("organization_id","facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_sync_receipts_device_event_uidx" ON "offline_sync_receipts" USING btree ("device_id","event_id");--> statement-breakpoint
CREATE INDEX "requirement_states_facility_idx" ON "requirement_states" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "requirement_states_requirement_idx" ON "requirement_states" USING btree ("requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_states_facility_scope_uidx" ON "requirement_states" USING btree ("organization_id","facility_id","requirement_id") WHERE "requirement_states"."silo_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_states_silo_scope_uidx" ON "requirement_states" USING btree ("organization_id","facility_id","requirement_id","silo_id") WHERE "requirement_states"."silo_id" is not null;