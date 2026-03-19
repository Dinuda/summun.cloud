CREATE TABLE "external_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"workflow_run_id" uuid,
	"leadgen_id" text NOT NULL,
	"page_id" text,
	"form_id" text,
	"ad_id" text,
	"adgroup_id" text,
	"campaign_id" text,
	"created_time" timestamp with time zone,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"field_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_event_sources" ADD COLUMN "plugin_id" text DEFAULT 'meta_leadgen' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_event_sources" ADD COLUMN "plugin_version" text;--> statement-breakpoint
ALTER TABLE "external_event_sources" ADD COLUMN "source_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "external_leads" ADD CONSTRAINT "external_leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_leads" ADD CONSTRAINT "external_leads_source_id_external_event_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."external_event_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_leads" ADD CONSTRAINT "external_leads_event_id_external_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."external_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_leads" ADD CONSTRAINT "external_leads_workflow_run_id_external_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."external_workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_leads_source_leadgen_uq" ON "external_leads" USING btree ("source_id","leadgen_id");--> statement-breakpoint
CREATE INDEX "external_leads_company_status_created_idx" ON "external_leads" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "external_leads_company_source_created_idx" ON "external_leads" USING btree ("company_id","source_id","created_at");--> statement-breakpoint
CREATE INDEX "external_event_sources_company_plugin_status_idx" ON "external_event_sources" USING btree ("company_id","plugin_id","status");