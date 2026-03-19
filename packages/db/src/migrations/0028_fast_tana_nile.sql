CREATE TABLE "external_action_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"issue_id" uuid,
	"approval_id" uuid,
	"reviewer_agent_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"dedupe_key" text NOT NULL,
	"evidence" jsonb,
	"recommendation" jsonb,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_event_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text DEFAULT 'meta_ads' NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reviewer_agent_id" uuid,
	"rules_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"llm_review_template" text,
	"verification_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb,
	"last_webhook_at" timestamp with time zone,
	"last_webhook_status" text,
	"last_webhook_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"provider_event_id" text,
	"idempotency_key" text NOT NULL,
	"delivery_attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"payload" jsonb NOT NULL,
	"headers" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"workflow_type" text DEFAULT 'process_external_event' NOT NULL,
	"engine" text DEFAULT 'inline' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"context" jsonb,
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_action_items" ADD CONSTRAINT "external_action_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_action_items" ADD CONSTRAINT "external_action_items_source_id_external_event_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."external_event_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_action_items" ADD CONSTRAINT "external_action_items_event_id_external_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."external_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_action_items" ADD CONSTRAINT "external_action_items_workflow_run_id_external_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."external_workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_action_items" ADD CONSTRAINT "external_action_items_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_action_items" ADD CONSTRAINT "external_action_items_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_action_items" ADD CONSTRAINT "external_action_items_reviewer_agent_id_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_event_sources" ADD CONSTRAINT "external_event_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_event_sources" ADD CONSTRAINT "external_event_sources_reviewer_agent_id_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_source_id_external_event_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."external_event_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_workflow_runs" ADD CONSTRAINT "external_workflow_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_workflow_runs" ADD CONSTRAINT "external_workflow_runs_source_id_external_event_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."external_event_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_workflow_runs" ADD CONSTRAINT "external_workflow_runs_event_id_external_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."external_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_action_items_company_source_dedupe_idx" ON "external_action_items" USING btree ("company_id","source_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "external_action_items_company_status_created_idx" ON "external_action_items" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "external_action_items_company_reviewer_status_idx" ON "external_action_items" USING btree ("company_id","reviewer_agent_id","status");--> statement-breakpoint
CREATE INDEX "external_event_sources_company_provider_status_idx" ON "external_event_sources" USING btree ("company_id","provider","status");--> statement-breakpoint
CREATE INDEX "external_event_sources_company_updated_idx" ON "external_event_sources" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_events_source_idempotency_idx" ON "external_events" USING btree ("source_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "external_events_company_source_received_idx" ON "external_events" USING btree ("company_id","source_id","received_at");--> statement-breakpoint
CREATE INDEX "external_events_company_status_received_idx" ON "external_events" USING btree ("company_id","status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_workflow_runs_event_attempt_idx" ON "external_workflow_runs" USING btree ("event_id","attempt");--> statement-breakpoint
CREATE INDEX "external_workflow_runs_company_status_created_idx" ON "external_workflow_runs" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "external_workflow_runs_company_source_created_idx" ON "external_workflow_runs" USING btree ("company_id","source_id","created_at");