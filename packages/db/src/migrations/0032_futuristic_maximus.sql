CREATE TABLE "department_members" (
	"department_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_members_department_id_agent_id_pk" PRIMARY KEY("department_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'building2',
	"color" text DEFAULT '#6366f1',
	"head_agent_id" uuid,
	"template_type" text DEFAULT 'custom' NOT NULL,
	"budget_monthly_cents" jsonb DEFAULT '0'::jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_agent_id_agents_id_fk" FOREIGN KEY ("head_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "department_members_agent_idx" ON "department_members" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "departments_company_slug_idx" ON "departments" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX "departments_company_created_idx" ON "departments" USING btree ("company_id","created_at");