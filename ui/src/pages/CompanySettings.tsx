import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { companiesApi } from "../api/companies";
import { accessApi } from "../api/access";
import { agentsApi } from "../api/agents";
import { externalEventSourcesApi } from "../api/externalEventSources";
import { secretsApi } from "../api/secrets";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Settings, Check } from "lucide-react";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import {
  externalRulesConfigSchema,
  type CompanySecret,
  type CreateExternalEventSource,
  type ExternalEventSource,
  type ExternalMetaLeadFormSummary,
  type ExternalMetaPageSummary,
  type ExternalPluginConfigField,
  type ExternalPluginMetadata,
  type MetaConnectSourceInput,
  type UpdateExternalEventSource,
} from "@paperclipai/shared";
import {
  Field,
  ToggleField,
  HintIcon
} from "../components/agent-config-primitives";

type AgentSnippetInput = {
  onboardingTextUrl: string;
  connectionCandidates?: string[] | null;
  testResolutionUrl?: string | null;
};

export function CompanySettings() {
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId
  } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  // General settings local state
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setBrandColor(selectedCompany.brandColor ?? "");
  }, [selectedCompany]);

  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSnippet, setInviteSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [snippetCopyDelightId, setSnippetCopyDelightId] = useState(0);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceReviewerAgentId, setSourceReviewerAgentId] = useState("");
  const [sourceRulesJson, setSourceRulesJson] = useState(
    JSON.stringify({ mode: "any", rules: [] }, null, 2),
  );
  const [sourceTemplate, setSourceTemplate] = useState("");
  const [sourcePluginId, setSourcePluginId] = useState("");
  const [sourceConfigValues, setSourceConfigValues] = useState<Record<string, string>>({});
  const [sourceFormError, setSourceFormError] = useState<string | null>(null);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [copiedWebhookSourceId, setCopiedWebhookSourceId] = useState<string | null>(null);
  const [metaUserAccessTokenSecretId, setMetaUserAccessTokenSecretId] = useState("");
  const [metaPageId, setMetaPageId] = useState("");
  const [metaFormId, setMetaFormId] = useState("");
  const [metaPages, setMetaPages] = useState<ExternalMetaPageSummary[]>([]);
  const [metaForms, setMetaForms] = useState<ExternalMetaLeadFormSummary[]>([]);
  const [metaConnectMessage, setMetaConnectMessage] = useState<string | null>(null);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId ?? ""),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: plugins } = useQuery({
    queryKey: queryKeys.external.plugins,
    queryFn: () => externalEventSourcesApi.plugins(),
    enabled: !!selectedCompanyId,
  });

  const { data: externalSources, isLoading: sourcesLoading } = useQuery({
    queryKey: queryKeys.external.sources(selectedCompanyId ?? "", sourcePluginId || undefined),
    queryFn: () =>
      externalEventSourcesApi.list(selectedCompanyId!, sourcePluginId ? { pluginId: sourcePluginId } : undefined),
    enabled: !!selectedCompanyId,
  });

  const { data: companySecrets } = useQuery({
    queryKey: queryKeys.secrets.list(selectedCompanyId ?? ""),
    queryFn: () => secretsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const activePlugin = useMemo(
    () => (plugins ?? []).find((plugin) => plugin.pluginId === sourcePluginId) ?? null,
    [plugins, sourcePluginId],
  );

  useEffect(() => {
    if (!plugins || plugins.length === 0) return;
    if (sourcePluginId) return;
    const plugin = plugins[0];
    setSourcePluginId(plugin.pluginId);
    setSourceConfigValues(buildDefaultSourceConfigValues(plugin));
  }, [plugins, sourcePluginId]);

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      brandColor !== (selectedCompany.brandColor ?? ""));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
      brandColor: string | null;
    }) => companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createOpenClawInvitePrompt(selectedCompanyId!),
    onSuccess: async (invite) => {
      setInviteError(null);
      const base = window.location.origin.replace(/\/+$/, "");
      const onboardingTextLink =
        invite.onboardingTextUrl ??
        invite.onboardingTextPath ??
        `/api/invites/${invite.token}/onboarding.txt`;
      const absoluteUrl = onboardingTextLink.startsWith("http")
        ? onboardingTextLink
        : `${base}${onboardingTextLink}`;
      setSnippetCopied(false);
      setSnippetCopyDelightId(0);
      let snippet: string;
      try {
        const manifest = await accessApi.getInviteOnboarding(invite.token);
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates:
            manifest.onboarding.connectivity?.connectionCandidates ?? null,
          testResolutionUrl:
            manifest.onboarding.connectivity?.testResolutionEndpoint?.url ??
            null
        });
      } catch {
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates: null,
          testResolutionUrl: null
        });
      }
      setInviteSnippet(snippet);
      try {
        await navigator.clipboard.writeText(snippet);
        setSnippetCopied(true);
        setSnippetCopyDelightId((prev) => prev + 1);
        setTimeout(() => setSnippetCopied(false), 2000);
      } catch {
        /* clipboard may not be available */
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.sidebarBadges(selectedCompanyId!)
      });
    },
    onError: (err) => {
      setInviteError(
        err instanceof Error ? err.message : "Failed to create invite"
      );
    }
  });

  useEffect(() => {
    setInviteError(null);
    setInviteSnippet(null);
    setSnippetCopied(false);
    setSnippetCopyDelightId(0);
    resetSourceForm();
  }, [selectedCompanyId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const oauthStatus = url.searchParams.get("meta_oauth");
    if (!oauthStatus) return;

    const oauthCompanyId = url.searchParams.get("meta_oauth_company_id");
    if (oauthCompanyId && oauthCompanyId !== selectedCompanyId) {
      setSelectedCompanyId(oauthCompanyId);
    }

    if (oauthStatus === "success") {
      setSourcePluginId("meta_leadgen");
      const userTokenSecretId = url.searchParams.get("meta_user_token_secret_id");
      if (userTokenSecretId) setMetaUserAccessTokenSecretId(userTokenSecretId);
      setMetaConnectMessage("Meta login complete. Load pages to continue.");
      setSourceFormError(null);
    } else {
      const message = url.searchParams.get("meta_oauth_error") ?? "Meta OAuth failed.";
      setSourceFormError(message);
      setMetaConnectMessage(null);
    }

    const keysToDelete = [
      "meta_oauth",
      "meta_oauth_company_id",
      "meta_user_token_secret_id",
      "meta_oauth_error",
    ];
    for (const key of keysToDelete) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [selectedCompanyId, setSelectedCompanyId]);

  function resetSourceForm() {
    const plugin = plugins?.find((item) => item.pluginId === sourcePluginId) ?? plugins?.[0] ?? null;
    setEditingSourceId(null);
    setSourceName("");
    setSourceReviewerAgentId("");
    setSourceRulesJson(JSON.stringify({ mode: "any", rules: [] }, null, 2));
    setSourceTemplate("");
    setSourcePluginId(plugin?.pluginId ?? "");
    setSourceConfigValues(plugin ? buildDefaultSourceConfigValues(plugin) : {});
    setSourceFormError(null);
    setMetaUserAccessTokenSecretId("");
    setMetaPageId("");
    setMetaFormId("");
    setMetaPages([]);
    setMetaForms([]);
    setMetaConnectMessage(null);
  }

  function hydrateSourceForm(source: ExternalEventSource) {
    const plugin = plugins?.find((item) => item.pluginId === source.pluginId) ?? null;
    const sourceMeta = asRecord(source.metadata);
    const metaConnection = asRecord(sourceMeta?.metaConnection);
    setEditingSourceId(source.id);
    setSourceName(source.name);
    setSourceReviewerAgentId(source.reviewerAgentId ?? "");
    setSourceRulesJson(JSON.stringify(source.rulesConfig ?? { mode: "any", rules: [] }, null, 2));
    setSourceTemplate(source.llmReviewTemplate ?? "");
    setSourcePluginId(source.pluginId);
    setSourceConfigValues(buildSourceConfigValuesForEdit(source, plugin));
    setSourceFormError(null);
    setMetaPageId(typeof metaConnection?.pageId === "string" ? metaConnection.pageId : "");
    setMetaFormId(typeof metaConnection?.formId === "string" ? metaConnection.formId : "");
    setMetaPages([]);
    setMetaForms([]);
    setMetaConnectMessage(null);
  }

  function formatTime(value: string | Date | null | undefined) {
    if (!value) return "never";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "never";
    return date.toLocaleString();
  }

  function webhookUrlForSource(source: ExternalEventSource) {
    if (source.pluginId === "meta_leadgen") {
      return `${window.location.origin}/api/webhooks/meta_leadgen/company/${source.companyId}`;
    }
    return `${window.location.origin}/api/webhooks/${source.pluginId}/${source.id}`;
  }

  async function handleCopyWebhookUrl(source: ExternalEventSource) {
    const url = webhookUrlForSource(source);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedWebhookSourceId(source.id);
      setTimeout(() => setCopiedWebhookSourceId((current) => (current === source.id ? null : current)), 1800);
    } catch {
      setCopiedWebhookSourceId(null);
    }
  }

  const pauseSourceMutation = useMutation({
    mutationFn: (sourceId: string) => externalEventSourcesApi.pause(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.external.sources(selectedCompanyId ?? "", sourcePluginId || undefined),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId ?? "") });
    },
  });

  const resumeSourceMutation = useMutation({
    mutationFn: (sourceId: string) => externalEventSourcesApi.resume(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.external.sources(selectedCompanyId ?? "", sourcePluginId || undefined),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId ?? "") });
    },
  });

  const deleteSourceMutation = useMutation({
    mutationFn: (sourceId: string) => externalEventSourcesApi.remove(sourceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.external.sources(selectedCompanyId ?? "", sourcePluginId || undefined),
      });
      await queryClient.invalidateQueries({
        queryKey: ["external", "meta-ops", selectedCompanyId ?? ""],
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard(selectedCompanyId ?? ""),
      });
      if (editingSourceId) {
        const remaining = (externalSources ?? []).filter((source) => source.id !== editingSourceId);
        if (remaining.length === 0) {
          resetSourceForm();
        }
      }
    },
    onError: (err) => {
      setSourceFormError(err instanceof Error ? err.message : "Failed to delete source.");
    },
  });

  const listMetaPagesMutation = useMutation({
    mutationFn: (input: { userAccessTokenSecretId: string }) =>
      externalEventSourcesApi.listMetaPages(selectedCompanyId!, input),
    onSuccess: (pages) => {
      setMetaPages(pages);
      if (pages.length === 0) {
        setMetaPageId("");
        setMetaForms([]);
        setMetaFormId("");
        return;
      }
      setMetaPageId((current) => (current && pages.some((page) => page.id === current) ? current : pages[0]!.id));
    },
    onError: (err) => {
      setSourceFormError(err instanceof Error ? err.message : "Failed to load Meta pages.");
    },
  });

  const listMetaFormsMutation = useMutation({
    mutationFn: (input: { userAccessTokenSecretId: string; pageId: string }) =>
      externalEventSourcesApi.listMetaLeadForms(selectedCompanyId!, input),
    onSuccess: (forms) => {
      setMetaForms(forms);
      setMetaFormId((current) => (current && forms.some((form) => form.id === current) ? current : ""));
    },
    onError: (err) => {
      setSourceFormError(err instanceof Error ? err.message : "Failed to load Meta forms.");
    },
  });

  const connectMetaSourceMutation = useMutation({
    mutationFn: (payload: MetaConnectSourceInput) =>
      externalEventSourcesApi.connectMetaSource(selectedCompanyId!, payload),
    onSuccess: async (result) => {
      setMetaConnectMessage(
        `Connected ${result.page.name}${result.formId ? ` (form ${result.formId})` : ""}. Source is ready.`,
      );
      hydrateSourceForm(result.source);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.external.sources(selectedCompanyId ?? "", sourcePluginId || undefined),
      });
      await queryClient.invalidateQueries({
        queryKey: ["external", "meta-ops", selectedCompanyId ?? ""],
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard(selectedCompanyId ?? ""),
      });
    },
    onError: (err) => {
      setSourceFormError(err instanceof Error ? err.message : "Failed to connect Meta source.");
    },
  });

  const startMetaOauthMutation = useMutation({
    mutationFn: () =>
      externalEventSourcesApi.startMetaOauth(selectedCompanyId!, {
        returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      }),
    onSuccess: (result) => {
      window.location.assign(result.authorizeUrl);
    },
    onError: (err) => {
      setSourceFormError(err instanceof Error ? err.message : "Failed to start Meta OAuth.");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: ({
      companyId,
      nextCompanyId
    }: {
      companyId: string;
      nextCompanyId: string | null;
    }) => companiesApi.archive(companyId).then(() => ({ nextCompanyId })),
    onSuccess: async ({ nextCompanyId }) => {
      if (nextCompanyId) {
        setSelectedCompanyId(nextCompanyId);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats
      });
    }
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      brandColor: brandColor || null
    });
  }

  async function handleSaveExternalSource() {
    if (!selectedCompanyId) return;
    const trimmedName = sourceName.trim();
    if (!trimmedName) {
      setSourceFormError("Source name is required.");
      return;
    }

    let parsedRules: CreateExternalEventSource["rulesConfig"];
    try {
      parsedRules = externalRulesConfigSchema.parse(JSON.parse(sourceRulesJson));
    } catch {
      setSourceFormError("Rules config must be valid JSON.");
      return;
    }

    if (!activePlugin) {
      setSourceFormError("Select a plugin before saving.");
      return;
    }
    if (activePlugin.pluginId === "meta_leadgen" && !editingSourceId) {
      setSourceFormError("Use Meta quick connect to create the first Meta source.");
      return;
    }

    let sourceConfig: Record<string, unknown>;
    try {
      sourceConfig = buildSourceConfigPayload(activePlugin, sourceConfigValues);
    } catch (err) {
      setSourceFormError(err instanceof Error ? err.message : "Source config is invalid.");
      return;
    }

    setSourceSaving(true);
    setSourceFormError(null);
    try {
      const updatePayload: UpdateExternalEventSource = {
        pluginId: activePlugin.pluginId,
        name: trimmedName,
        reviewerAgentId: sourceReviewerAgentId || null,
        rulesConfig: parsedRules,
        llmReviewTemplate: sourceTemplate.trim() || null,
        sourceConfig,
      };
      if (editingSourceId) {
        await externalEventSourcesApi.update(editingSourceId, updatePayload);
      } else {
        const createPayload: CreateExternalEventSource = {
          pluginId: activePlugin.pluginId,
          name: trimmedName,
          status: "active",
          reviewerAgentId: sourceReviewerAgentId || null,
          rulesConfig: parsedRules,
          llmReviewTemplate: sourceTemplate.trim() || null,
          sourceConfig,
        };
        await externalEventSourcesApi.create(selectedCompanyId, createPayload);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.external.sources(selectedCompanyId, sourcePluginId || undefined),
      });
      await queryClient.invalidateQueries({
        queryKey: ["external", "meta-ops", selectedCompanyId],
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard(selectedCompanyId),
      });
      resetSourceForm();
    } catch (err) {
      setSourceFormError(err instanceof Error ? err.message : "Failed to save source.");
    } finally {
      setSourceSaving(false);
    }
  }

  async function handleLoadMetaPages() {
    if (!selectedCompanyId) return;
    const secretId = metaUserAccessTokenSecretId.trim();
    if (!secretId) {
      setSourceFormError("Select the user access token secret first.");
      return;
    }
    setSourceFormError(null);
    setMetaConnectMessage(null);
    await listMetaPagesMutation.mutateAsync({ userAccessTokenSecretId: secretId });
  }

  async function handleLoadMetaForms() {
    if (!selectedCompanyId) return;
    const secretId = metaUserAccessTokenSecretId.trim();
    if (!secretId) {
      setSourceFormError("Select the user access token secret first.");
      return;
    }
    if (!metaPageId) {
      setSourceFormError("Select a Meta page first.");
      return;
    }
    setSourceFormError(null);
    setMetaConnectMessage(null);
    await listMetaFormsMutation.mutateAsync({
      userAccessTokenSecretId: secretId,
      pageId: metaPageId,
    });
  }

  async function handleAutoConnectMetaSource() {
    if (!selectedCompanyId) return;
    if (activePlugin?.pluginId !== "meta_leadgen") {
      setSourceFormError("Meta auto-connect is only available for the Meta Leadgen plugin.");
      return;
    }

    const trimmedName = sourceName.trim();
    if (!trimmedName) {
      setSourceFormError("Source name is required.");
      return;
    }

    const userAccessTokenSecretId = metaUserAccessTokenSecretId.trim();
    if (!userAccessTokenSecretId) {
      setSourceFormError("User access token secret is required.");
      return;
    }
    if (!metaPageId) {
      setSourceFormError("Select a Meta page first.");
      return;
    }

    let parsedRules: CreateExternalEventSource["rulesConfig"];
    try {
      parsedRules = externalRulesConfigSchema.parse(JSON.parse(sourceRulesJson));
    } catch {
      setSourceFormError("Rules config must be valid JSON.");
      return;
    }

    setSourceFormError(null);
    setMetaConnectMessage(null);

    const payload: MetaConnectSourceInput = {
      sourceId: editingSourceId ?? undefined,
      sourceName: trimmedName,
      reviewerAgentId: sourceReviewerAgentId || null,
      rulesConfig: parsedRules,
      llmReviewTemplate: sourceTemplate.trim() || null,
      userAccessTokenSecretId,
      pageId: metaPageId,
      formId: metaFormId || null,
      graphApiVersion: (sourceConfigValues.graphApiVersion ?? "").trim() || "v22.0",
    };

    await connectMetaSourceMutation.mutateAsync(payload);
  }

  function handleStartMetaOauth() {
    if (!selectedCompanyId) return;
    setSourceFormError(null);
    setMetaConnectMessage(null);
    startMetaOauthMutation.mutate();
  }

  const manualMetaCreateBlocked = activePlugin?.pluginId === "meta_leadgen" && !editingSourceId;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Company Settings</h1>
      </div>

      {/* General */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <Field label="Company name" hint="The display name for your company.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <Field
            label="Description"
            hint="Optional description shown in the company profile."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional company description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                brandColor={brandColor || null}
                className="rounded-[14px]"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Field
                label="Brand color"
                hint="Sets the hue for the company icon. Leave empty for auto-generated color."
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandColor || "#6366f1"}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={brandColor}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
                        setBrandColor(v);
                      }
                    }}
                    placeholder="Auto"
                    className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  />
                  {brandColor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrandColor("")}
                      className="text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={generalMutation.isPending || !companyName.trim()}
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                ? generalMutation.error.message
                : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Hiring */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
          />
        </div>
      </div>

      {/* External Plugins */}
      <div className="space-y-4">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          External Sources
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="space-y-2 rounded-md border border-border/80 bg-muted/20 px-3 py-3">
            <p className="text-sm font-medium">Managed Meta App</p>
            <p className="text-xs text-muted-foreground">
              This setup uses instance-managed Meta credentials. Connect with Meta login below, then select page/form.
            </p>
            <p className="text-xs text-muted-foreground">
              If connect fails immediately, configure <code>SUMMUN_META_MANAGED_APP_ID</code>,
              {" "}
              <code>SUMMUN_META_MANAGED_APP_SECRET</code>, and
              {" "}
              <code>SUMMUN_META_MANAGED_VERIFY_TOKEN</code> on the server.
            </p>
          </div>

          <Field
            label="Plugin"
            hint="Choose the ingestion plugin to configure for this source."
          >
            <select
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              value={sourcePluginId}
              onChange={(e) => {
                const nextPluginId = e.target.value;
                const plugin = (plugins ?? []).find((item) => item.pluginId === nextPluginId) ?? null;
                setSourcePluginId(nextPluginId);
                setSourceConfigValues(plugin ? buildDefaultSourceConfigValues(plugin) : {});
                setMetaPages([]);
                setMetaForms([]);
                setMetaPageId("");
                setMetaFormId("");
                setMetaConnectMessage(null);
              }}
              disabled={!!editingSourceId}
            >
              <option value="">Select plugin</option>
              {(plugins ?? []).map((plugin) => (
                <option key={plugin.pluginId} value={plugin.pluginId}>
                  {plugin.name} ({plugin.pluginId})
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Source name"
            hint="Human-friendly label for this webhook source."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="Meta Ads - Growth Account"
            />
          </Field>

          <Field
            label="Reviewer agent"
            hint="Agent assigned to review generated action items."
          >
            <select
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              value={sourceReviewerAgentId}
              onChange={(e) => setSourceReviewerAgentId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {(agents ?? []).map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Rules config (JSON)"
            hint='Deterministic rules (for example: {"mode":"any","rules":[...]}).'
          >
            <textarea
              className="h-44 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none"
              value={sourceRulesJson}
              onChange={(e) => setSourceRulesJson(e.target.value)}
            />
          </Field>

          <Field
            label="LLM review template"
            hint="Template provided to the reviewer context when a rule matches."
          >
            <textarea
              className="h-24 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              value={sourceTemplate}
              onChange={(e) => setSourceTemplate(e.target.value)}
              placeholder="Review signal {{ruleTitle}} and decide if approval is required."
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(activePlugin?.sourceConfigFields ?? []).map((field) => (
              <PluginConfigFieldInput
                key={field.key}
                field={field}
                value={sourceConfigValues[field.key] ?? ""}
                companySecrets={companySecrets ?? []}
                onChange={(next) =>
                  setSourceConfigValues((prev) => ({
                    ...prev,
                    [field.key]: next,
                  }))
                }
              />
            ))}
          </div>

          {activePlugin?.pluginId === "meta_leadgen" && (
            <div className="space-y-3 rounded-md border border-border/80 bg-muted/20 px-3 py-3">
              <p className="text-sm font-medium">Meta quick connect</p>
              <p className="text-xs text-muted-foreground">
                Load pages/forms from Meta, subscribe webhook automatically, and create/update this source in one step.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleStartMetaOauth}
                  disabled={startMetaOauthMutation.isPending}
                >
                  {startMetaOauthMutation.isPending ? "Redirecting..." : "Connect with Meta login"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Uses instance-managed Meta credentials configured on the server.
                </span>
              </div>
              <Field
                label="User Access Token Secret"
                hint="Secret containing a Meta user access token with page management permissions."
              >
                <div className="space-y-2">
                  <select
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    value={metaUserAccessTokenSecretId}
                    onChange={(e) => setMetaUserAccessTokenSecretId(e.target.value)}
                  >
                    <option value="">Select secret</option>
                    {(companySecrets ?? []).map((secret) => (
                      <option key={secret.id} value={secret.id}>
                        {secret.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                    type="text"
                    value={metaUserAccessTokenSecretId}
                    onChange={(e) => setMetaUserAccessTokenSecretId(e.target.value)}
                    placeholder="or paste secret UUID"
                  />
                </div>
              </Field>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleLoadMetaPages}
                  disabled={listMetaPagesMutation.isPending}
                >
                  {listMetaPagesMutation.isPending ? "Loading pages..." : "Load Meta pages"}
                </Button>
                {metaPages.length > 0 && (
                  <span className="text-xs text-muted-foreground">{metaPages.length} page(s) found</span>
                )}
              </div>

              <Field label="Meta page" hint="Choose the Facebook Page connected to your lead form.">
                <select
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                  value={metaPageId}
                  onChange={(e) => {
                    setMetaPageId(e.target.value);
                    setMetaForms([]);
                    setMetaFormId("");
                  }}
                >
                  <option value="">Select page</option>
                  {metaPages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name} ({page.id}){page.hasManageLeads ? "" : " - missing MANAGE_LEADS"}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleLoadMetaForms}
                  disabled={!metaPageId || listMetaFormsMutation.isPending}
                >
                  {listMetaFormsMutation.isPending ? "Loading forms..." : "Load lead forms"}
                </Button>
                {metaForms.length > 0 && (
                  <span className="text-xs text-muted-foreground">{metaForms.length} form(s) found</span>
                )}
              </div>

              <Field
                label="Lead form (optional)"
                hint="Optional form filter for metadata and operations display."
              >
                <select
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                  value={metaFormId}
                  onChange={(e) => setMetaFormId(e.target.value)}
                >
                  <option value="">All forms</option>
                  {metaForms.map((form) => (
                    <option key={form.id} value={form.id}>
                      {form.name} ({form.status})
                    </option>
                  ))}
                </select>
              </Field>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleAutoConnectMetaSource}
                  disabled={connectMetaSourceMutation.isPending}
                >
                  {connectMetaSourceMutation.isPending ? "Connecting..." : "Auto-connect Meta source"}
                </Button>
                {metaConnectMessage && <span className="text-xs text-emerald-600">{metaConnectMessage}</span>}
              </div>
            </div>
          )}

          {sourceFormError && (
            <p className="text-xs text-destructive">{sourceFormError}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleSaveExternalSource}
              disabled={sourceSaving || manualMetaCreateBlocked}
            >
              {sourceSaving
                ? "Saving..."
                : editingSourceId
                  ? "Update source"
                  : manualMetaCreateBlocked
                    ? "Use Auto-connect Meta source"
                    : "Create source"}
            </Button>
            {editingSourceId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={resetSourceForm}
              >
                Cancel edit
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-md border border-border">
          <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
            Existing sources
          </div>
          {sourcesLoading ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">Loading sources...</div>
          ) : (externalSources ?? []).length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">No external sources configured.</div>
          ) : (
            <div className="divide-y divide-border">
              {(externalSources ?? []).map((source) => (
                <div key={source.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{source.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Plugin: {source.pluginId} ·
                      {" "}
                      Status: {source.status} · Reviewer:{" "}
                      {agents?.find((agent) => agent.id === source.reviewerAgentId)?.name ??
                        (source.reviewerAgentId ? source.reviewerAgentId.slice(0, 8) : "unassigned")}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono break-all">
                      Source ID: {source.id}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono break-all">
                      Webhook URL: {webhookUrlForSource(source)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Last webhook: {formatTime(source.lastWebhookAt)} · Last status: {source.lastWebhookStatus ?? "none"}
                      {source.lastWebhookError ? ` · Error: ${source.lastWebhookError}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleCopyWebhookUrl(source)}>
                      {copiedWebhookSourceId === source.id ? "Copied URL" : "Copy URL"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => hydrateSourceForm(source)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const confirmed = window.confirm(`Delete source "${source.name}"?`);
                        if (!confirmed) return;
                        deleteSourceMutation.mutate(source.id);
                      }}
                      disabled={deleteSourceMutation.isPending}
                    >
                      Delete
                    </Button>
                    {source.status === "active" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => pauseSourceMutation.mutate(source.id)}
                        disabled={pauseSourceMutation.isPending}
                      >
                        Pause
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resumeSourceMutation.mutate(source.id)}
                        disabled={resumeSourceMutation.isPending}
                      >
                        Resume
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Invites */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Invites
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              Generate an OpenClaw agent invite snippet.
            </span>
            <HintIcon text="Creates a short-lived OpenClaw agent invite and renders a copy-ready prompt." />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending}
            >
              {inviteMutation.isPending
                ? "Generating..."
                : "Generate OpenClaw Invite Prompt"}
            </Button>
          </div>
          {inviteError && (
            <p className="text-sm text-destructive">{inviteError}</p>
          )}
          {inviteSnippet && (
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  OpenClaw Invite Prompt
                </div>
                {snippetCopied && (
                  <span
                    key={snippetCopyDelightId}
                    className="flex items-center gap-1 text-xs text-green-600 animate-pulse"
                  >
                    <Check className="h-3 w-3" />
                    Copied
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-1.5">
                <textarea
                  className="h-[28rem] w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none"
                  value={inviteSnippet}
                  readOnly
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteSnippet);
                        setSnippetCopied(true);
                        setSnippetCopyDelightId((prev) => prev + 1);
                        setTimeout(() => setSnippetCopied(false), 2000);
                      } catch {
                        /* clipboard may not be available */
                      }
                    }}
                  >
                    {snippetCopied ? "Copied snippet" : "Copy snippet"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">
          Danger Zone
        </div>
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this company to hide it from the sidebar. This persists in
            the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedCompany.status === "archived"
              }
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Archive company "${selectedCompany.name}"? It will be hidden from the sidebar.`
                );
                if (!confirmed) return;
                const nextCompanyId =
                  companies.find(
                    (company) =>
                      company.id !== selectedCompanyId &&
                      company.status !== "archived"
                  )?.id ?? null;
                archiveMutation.mutate({
                  companyId: selectedCompanyId,
                  nextCompanyId
                });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedCompany.status === "archived"
                ? "Already archived"
                : "Archive company"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive company"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toFormValue(field: ExternalPluginConfigField, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (field.type === "secret_ref") {
    const record = asRecord(value);
    return typeof record?.secretId === "string" ? record.secretId : "";
  }
  if (field.type === "boolean") {
    return value ? "true" : "false";
  }
  if (field.type === "json") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }
  return String(value);
}

function buildDefaultSourceConfigValues(plugin: ExternalPluginMetadata): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of plugin.sourceConfigFields) {
    if (field.defaultValue !== undefined) {
      values[field.key] = toFormValue(field, field.defaultValue);
      continue;
    }
    values[field.key] = field.type === "boolean" ? "false" : "";
  }
  return values;
}

function buildSourceConfigValuesForEdit(
  source: ExternalEventSource,
  plugin: ExternalPluginMetadata | null,
): Record<string, string> {
  if (!plugin) return {};

  const values = buildDefaultSourceConfigValues(plugin);
  const sourceConfig = asRecord(source.sourceConfig) ?? {};
  const mergedConfig: Record<string, unknown> = { ...sourceConfig };

  for (const field of plugin.sourceConfigFields) {
    values[field.key] = toFormValue(field, mergedConfig[field.key]);
  }
  return values;
}

function buildSourceConfigPayload(
  plugin: ExternalPluginMetadata,
  values: Record<string, string>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const field of plugin.sourceConfigFields) {
    const raw = (values[field.key] ?? "").trim();
    if (!raw) {
      if (field.required) throw new Error(`${field.label} is required.`);
      continue;
    }

    switch (field.type) {
      case "secret_ref":
        output[field.key] = { type: "secret_ref", secretId: raw, version: "latest" };
        break;
      case "number": {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) throw new Error(`${field.label} must be a number.`);
        output[field.key] = parsed;
        break;
      }
      case "boolean":
        output[field.key] = raw.toLowerCase() === "true" || raw === "1";
        break;
      case "json":
        try {
          output[field.key] = JSON.parse(raw);
        } catch {
          throw new Error(`${field.label} must be valid JSON.`);
        }
        break;
      case "string":
      default:
        output[field.key] = raw;
        break;
    }
  }

  return output;
}

function PluginConfigFieldInput(props: {
  field: ExternalPluginConfigField;
  value: string;
  companySecrets: CompanySecret[];
  onChange: (value: string) => void;
}) {
  const { field, value, companySecrets, onChange } = props;

  if (field.type === "secret_ref") {
    return (
      <Field label={field.label} hint={field.description}>
        <div className="space-y-2">
          <select
            className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Select secret</option>
            {companySecrets.map((secret) => (
              <option key={secret.id} value={secret.id}>
                {secret.name}
              </option>
            ))}
          </select>
          <input
            className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="or paste secret UUID"
          />
        </div>
      </Field>
    );
  }

  if (field.type === "boolean") {
    return (
      <Field label={field.label} hint={field.description}>
        <select
          className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
          value={value || "false"}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      </Field>
    );
  }

  if (field.type === "json") {
    return (
      <Field label={field.label} hint={field.description}>
        <textarea
          className="h-24 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="{}"
        />
      </Field>
    );
  }

  return (
    <Field label={field.label} hint={field.description}>
      <input
        className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
        type={field.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function buildAgentSnippet(input: AgentSnippetInput) {
  const candidateUrls = buildCandidateOnboardingUrls(input);
  const resolutionTestUrl = buildResolutionTestUrl(input);

  const candidateList =
    candidateUrls.length > 0
      ? candidateUrls.map((u) => `- ${u}`).join("\n")
      : "- (No candidate URLs available yet.)";

  const connectivityBlock =
    candidateUrls.length === 0
      ? `No candidate URLs are available. Ask your user to configure a reachable hostname in Summun, then retry.
Suggested steps:
- choose a hostname that resolves to the Summun host from your runtime
- run: pnpm summun allowed-hostname <host>
- restart Summun
- verify with: curl -fsS http://<host>:3100/api/health
- regenerate this invite snippet`
      : `If none are reachable, ask your user to add a reachable hostname in Summun, restart, and retry.
Suggested command:
- pnpm summun allowed-hostname <host>
Then verify with: curl -fsS <base-url>/api/health`;

  const resolutionLine = resolutionTestUrl
    ? `\nYou MUST test Summun-to-gateway reachability, call: ${resolutionTestUrl}?url=<urlencoded-gateway-url> (using the hostname that worked above). Do not assume your 172.x is necessarily reachable from Summun. Test it. `
    : "";

  return `You're invited to join a Summun organization.

The URLs you should try are:
${candidateList}

Connectivity guidance:
If you are running on a different machine than Summun, Summun must be reachable at one of the hostnames used above.
Verify the hostname works from your runtime with: GET <base-url>/api/health

${connectivityBlock}

For your "agentName", just use your own agent name (OpenClaw or whatever your name is) and send it directly.
You also need to send a gateway URL that Summun can access. Check your config and include that URL.${resolutionLine}

---

This onboarding flow is for OpenClaw Gateway.
When you submit the join request, use:
- \`adapterType: "openclaw_gateway"\`
- \`agentDefaultsPayload.url\` as your \`ws://\` or \`wss://\` gateway URL
- \`agentDefaultsPayload.headers["x-openclaw-token"]\` with your gateway token
- (legacy accepted) \`agentDefaultsPayload.headers["x-openclaw-auth"]\`
- Keep device auth enabled (recommended). If \`devicePrivateKeyPem\` is omitted, Summun will generate and persist one during join so pairing approvals remain stable.
- Only use \`disableDeviceAuth=true\` for special environments where pairing cannot be completed.

Do NOT use \`/v1/responses\` or \`/hooks/*\` in this join flow.

Before you do anything, please respond to your user that you understand the instructions and you're going to work on them. Then do the step above in another session called "summun-onboarding" and then tell your user when you're done. Update your user in intermediate steps along the way so they know what's going on.

Then after you've connected to Summun (exchanged keys etc.) you MUST review and follow the onboarding instructions in onboarding.txt they give you.

`;
}

function buildCandidateOnboardingUrls(input: AgentSnippetInput): string[] {
  const candidates = (input.connectionCandidates ?? [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const urls = new Set<string>();
  let onboardingUrl: URL | null = null;

  try {
    onboardingUrl = new URL(input.onboardingTextUrl);
    urls.add(onboardingUrl.toString());
  } catch {
    const trimmed = input.onboardingTextUrl.trim();
    if (trimmed) {
      urls.add(trimmed);
    }
  }

  if (!onboardingUrl) {
    for (const candidate of candidates) {
      urls.add(candidate);
    }
    return Array.from(urls);
  }

  const onboardingPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
  for (const candidate of candidates) {
    try {
      const base = new URL(candidate);
      urls.add(`${base.origin}${onboardingPath}`);
    } catch {
      urls.add(candidate);
    }
  }

  return Array.from(urls);
}

function buildResolutionTestUrl(input: AgentSnippetInput): string | null {
  const explicit = input.testResolutionUrl?.trim();
  if (explicit) return explicit;

  try {
    const onboardingUrl = new URL(input.onboardingTextUrl);
    const testPath = onboardingUrl.pathname.replace(
      /\/onboarding\.txt$/,
      "/test-resolution"
    );
    return `${onboardingUrl.origin}${testPath}`;
  } catch {
    return null;
  }
}
