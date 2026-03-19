CREATE TABLE "company_external_plugin_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_external_plugin_configs" ADD CONSTRAINT "company_external_plugin_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_external_plugin_configs_company_plugin_uq" ON "company_external_plugin_configs" USING btree ("company_id","plugin_id");--> statement-breakpoint
CREATE INDEX "company_external_plugin_configs_company_idx" ON "company_external_plugin_configs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_external_plugin_configs_company_updated_idx" ON "company_external_plugin_configs" USING btree ("company_id","updated_at");
