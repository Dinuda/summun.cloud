CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"goal_id" uuid,
	"title" text NOT NULL,
	"summary" text,
	"body" text NOT NULL,
	"scope" text DEFAULT 'project' NOT NULL,
	"kind" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_type" text DEFAULT 'auto_ingest' NOT NULL,
	"source_entity" text,
	"source_entity_id" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"content_hash" text NOT NULL,
	"quality" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_ingestion_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_table" text NOT NULL,
	"last_ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_ingestion_cursors" ADD CONSTRAINT "knowledge_ingestion_cursors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_entries_company_scope_kind_idx" ON "knowledge_entries" USING btree ("company_id","scope","kind");--> statement-breakpoint
CREATE INDEX "knowledge_entries_company_project_idx" ON "knowledge_entries" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "knowledge_entries_company_created_idx" ON "knowledge_entries" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entries_dedup_idx" ON "knowledge_entries" USING btree ("company_id","source_entity","source_entity_id");--> statement-breakpoint
CREATE INDEX "knowledge_entries_content_hash_idx" ON "knowledge_entries" USING btree ("company_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_ingestion_cursors_company_source_idx" ON "knowledge_ingestion_cursors" USING btree ("company_id","source_table");