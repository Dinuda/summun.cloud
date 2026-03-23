import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { agentsApi } from "../api/agents";
import { externalEventSourcesApi } from "../api/externalEventSources";
import { secretsApi } from "../api/secrets";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Field } from "../components/agent-config-primitives";
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

// xyflow imports
import '@xyflow/react/dist/style.css';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Position,
  Handle,
  ReactFlowProvider,
  MarkerType,
} from '@xyflow/react';

// Heroicons Context
const SparklesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-indigo-400">
    <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
  </svg>
);

const MetaIcon = () => (
  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#1877f2] font-bold text-white shadow-sm ring-1 ring-white/10">
    f
  </span>
);

const SummunIcon = () => (
  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white shadow-sm ring-1 ring-white/10">
    S
  </span>
);

// Custom CustomNode Component for xyflow
const CustomIntegrationNode = ({ data, selected }: any) => {
  const { title, subtitle, icon: Icon, status, disabled } = data;
  
  return (
    <div className={`relative min-w-[320px] rounded-2xl border transition-all duration-300 
        ${selected ? 'border-primary shadow-xl shadow-primary/10 bg-card' : 'border-border/60 bg-card/80 shadow-md'}
        ${disabled ? 'opacity-50 grayscale-[0.5] cursor-not-allowed' : 'hover:border-primary/50 cursor-pointer'}
        backdrop-blur-md p-5 pb-6
      `}>
      {/* Target Handle (Top) */}
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-muted border-2 border-background" />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Icon />
          <div>
            <h2 className="text-sm font-bold tracking-tight text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
        </div>
      </div>
      
      <div className="mt-4 flex items-center justify-end">
          {status === 'connected' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-500 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
              Connected
            </span>
          )}
          {status === 'action_needed' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-500 border border-amber-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]"></span>
              Action Needed
            </span>
          )}
          {status === 'pending' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border border-border">
              Pending previous
            </span>
          )}
      </div>

      {/* Source Handle (Bottom) */}
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-primary border-2 border-background" />
    </div>
  );
};

const nodeTypes = {
  integrationNode: CustomIntegrationNode,
};

// Builder Component wrapped
export function CompanyIntegrationsBuilder() {
    return (
        <ReactFlowProvider>
             <CompanyIntegrationsBuilderInner />
        </ReactFlowProvider>
    )
}

function CompanyIntegrationsBuilderInner() {
  const { selectedCompany, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const isHandlingOauthRef = useRef(
    typeof window !== 'undefined' && new URL(window.location.href).searchParams.has("meta_oauth")
  );

  // Draw State
  const [activeCard, setActiveCard] = useState<"meta_setup" | "summun_setup" | null>("meta_setup");
  
  // Builder form states
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("Meta Lead Source");
  const [sourceReviewerAgentId, setSourceReviewerAgentId] = useState("");
  const [sourceRulesJson, setSourceRulesJson] = useState(JSON.stringify({ mode: "any", rules: [] }, null, 2));
  const [sourceTemplate, setSourceTemplate] = useState("");
  const [sourcePluginId, setSourcePluginId] = useState("meta_leadgen");
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

  // Queries
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
    queryKey: queryKeys.external.sources(selectedCompanyId ?? ""),
    queryFn: () => externalEventSourcesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: companySecrets } = useQuery({
    queryKey: queryKeys.secrets.list(selectedCompanyId ?? ""),
    queryFn: () => secretsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const activePlugin = useMemo(() => {
    if (!plugins || plugins.length === 0) return null;
    return (
      plugins.find((plugin) => plugin.pluginId === sourcePluginId) ??
      plugins.find((plugin) => plugin.pluginId === "meta_leadgen") ??
      plugins[0] ??
      null
    );
  }, [plugins, sourcePluginId]);

  useEffect(() => {
    if (!plugins || plugins.length === 0) return;
    const metaPlugin = plugins.find((plugin) => plugin.pluginId === "meta_leadgen") ?? plugins[0] ?? null;
    if (!metaPlugin) return;

    if (!sourcePluginId) {
      setSourcePluginId(metaPlugin.pluginId);
      setSourceConfigValues(buildDefaultSourceConfigValues(metaPlugin));
      return;
    }

    if (!plugins.some((plugin) => plugin.pluginId === sourcePluginId)) {
      setSourcePluginId(metaPlugin.pluginId);
      setSourceConfigValues(buildDefaultSourceConfigValues(metaPlugin));
    }
  }, [plugins, sourcePluginId]);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Integrations" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  useEffect(() => {
    if (isHandlingOauthRef.current) return;
    resetSourceForm();
  }, [selectedCompanyId]);

  // Auto-hydrate existing Meta source to persist 'Connected' state on page visit
  useEffect(() => {
    if (isHandlingOauthRef.current || !plugins || plugins.length === 0 || !externalSources) return;
    
    // Only auto-hydrate if we aren't currently editing and haven't already hydrated auth tokens
    if (!editingSourceId && !metaUserAccessTokenSecretId) {
      const primaryMetaSource = externalSources.find((s) => s.pluginId === "meta_leadgen");
      if (primaryMetaSource) {
        hydrateSourceForm(primaryMetaSource);
        setActiveCard(null); // Keep the config drawer closed
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSources, plugins]);

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
      setActiveCard("meta_setup");
    } else {
      const message = url.searchParams.get("meta_oauth_error") ?? "Meta OAuth failed.";
      setSourceFormError(message);
      setMetaConnectMessage(null);
    }

    const keysToDelete = ["meta_oauth", "meta_oauth_company_id", "meta_user_token_secret_id", "meta_oauth_error"];
    for (const key of keysToDelete) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    
    // Release the lock after OAuth is fully processed
    setTimeout(() => {
        isHandlingOauthRef.current = false;
    }, 100);
  }, [selectedCompanyId, setSelectedCompanyId]);

  // Status computation for UI rendering
  const hasMetaTokenSecret = metaUserAccessTokenSecretId.trim().length > 0;
  const hasMetaPageSelection = metaPageId.trim().length > 0;
  const hasConnectedMetaSource = (externalSources ?? []).some((source) => source.pluginId === "meta_leadgen");
  
  const setupDone = hasMetaTokenSecret;
  const configureDone = hasMetaPageSelection;
  const testDone = hasConnectedMetaSource;


  // Flow state mapped to actual application state
  const initialNodes = [
    {
      id: "meta_setup",
      type: "integrationNode",
      position: { x: 250, y: 150 },
      data: {
        title: "1. Facebook Lead Ads",
        subtitle: "Captures new leads from Meta campaigns",
        icon: MetaIcon,
        status: setupDone ? 'connected' : 'action_needed',
        disabled: false
      },
    },
    {
      id: "summun_setup",
      type: "integrationNode",
      position: { x: 250, y: 350 },
      data: {
        title: "2. Summun Pipeline",
        subtitle: "Where your leads are processed & reviewed",
        icon: SummunIcon,
        status: testDone ? 'connected' : 'pending',
        disabled: !testDone
      },
    },
  ];

  const initialEdges = [
    {
      id: "e1",
      source: "meta_setup",
      target: "summun_setup",
      animated: testDone, // ONLY animate when data is flowing (i.e. testDone is true)
      style: { stroke: testDone ? '#10b981' : '#6366f1', strokeWidth: 2, strokeDasharray: '4 4' },
      markerEnd: { type: MarkerType.ArrowClosed, color: testDone ? '#10b981' : '#6366f1' },
    },
  ];

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync flow state with app state changes
  useEffect(() => {
    setNodes(nds => nds.map(node => {
        if (node.id === "meta_setup") {
            return {
                ...node,
                data: { ...node.data, status: setupDone ? 'connected' : 'action_needed' }
            };
        }
        if (node.id === "summun_setup") {
             return {
                ...node,
                data: { ...node.data, status: testDone ? 'connected' : 'pending', disabled: !testDone }
            };
        }
        return node;
    }));
    setEdges(eds => eds.map(edge => {
        if(edge.id === "e1") {
             return {
                 ...edge, 
                 animated: testDone,
                 style: { stroke: testDone ? '#10b981' : '#6366f1', strokeWidth: 2, strokeDasharray: testDone ? '4 4' : 'none' }
             }
        }
        return edge;
    }))
  }, [setupDone, testDone, setNodes, setEdges]);


  const onNodeClick = useCallback((_: any, node: any) => {
     if (node.data.disabled) return;
     setActiveCard(node.id === activeCard ? null : node.id);
  }, [activeCard]);

  // Mutations
  const deleteSourceMutation = useMutation({
    mutationFn: (sourceId: string) => externalEventSourcesApi.remove(sourceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.external.sources(selectedCompanyId ?? "") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.external.metaOps(selectedCompanyId ?? "") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId ?? "") });
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
      setActiveCard("summun_setup");
      await queryClient.invalidateQueries({ queryKey: queryKeys.external.sources(selectedCompanyId ?? "") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.external.metaOps(selectedCompanyId ?? "") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId ?? "") });
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

  function resetSourceForm() {
    const plugin = plugins?.find((item) => item.pluginId === "meta_leadgen") ?? plugins?.[0] ?? null;
    setEditingSourceId(null);
    setSourceName("Meta Lead Source");
    setSourceReviewerAgentId("");
    setSourceRulesJson(JSON.stringify({ mode: "any", rules: [] }, null, 2));
    setSourceTemplate("");
    setSourcePluginId(plugin?.pluginId ?? "meta_leadgen");
    setSourceConfigValues(plugin ? buildDefaultSourceConfigValues(plugin) : {});
    setSourceFormError(null);
    setMetaUserAccessTokenSecretId("");
    setMetaPageId("");
    setMetaFormId("");
    setMetaPages([]);
    setMetaForms([]);
    setMetaConnectMessage(null);
    setActiveCard("meta_setup");
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
    
    if (typeof metaConnection?.userAccessTokenSecretId === "string") {
        setMetaUserAccessTokenSecretId(metaConnection.userAccessTokenSecretId);
    }

    setMetaPageId(typeof metaConnection?.pageId === "string" ? metaConnection.pageId : "");
    setMetaFormId(typeof metaConnection?.formId === "string" ? metaConnection.formId : "");
    setMetaPages([]);
    setMetaForms([]);
    setMetaConnectMessage(null);
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.external.sources(selectedCompanyId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.external.metaOps(selectedCompanyId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId) });
      setActiveCard(null); // Collapse drawer on save
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
      setSourceFormError("Authenticate with Meta first.");
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
      setSourceFormError("Authenticate with Meta first.");
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

    const trimmedName = sourceName.trim() || "Meta Lead Source";
    const userAccessTokenSecretId = metaUserAccessTokenSecretId.trim();
    if (!userAccessTokenSecretId) {
      setSourceFormError("Authentication is required.");
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

  // Effect to automatically load pages if token exists and pages not loaded
  useEffect(() => {
    if (metaUserAccessTokenSecretId && metaPages.length === 0 && !listMetaPagesMutation.isPending) {
        handleLoadMetaPages();
    }
  }, [metaUserAccessTokenSecretId]);

   // Effect to automatically load forms if page selected and forms not loaded
   useEffect(() => {
    if (metaUserAccessTokenSecretId && metaPageId && metaForms.length === 0 && !listMetaFormsMutation.isPending) {
        handleLoadMetaForms();
    }
  }, [metaPageId]);


  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground flex items-center justify-center p-12">
        <p>No company selected. Select a company from the switcher above.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full overflow-hidden relative">
        
       {/* React Flow Canvas Area */}
       <div className="flex-1 h-full relative" style={{ backgroundColor: '#F9FAFB' }}>
           {/* Floating Copilot Command Bar */}
           <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 w-full max-w-xl px-4 pointer-events-none">
                <div className="relative group shadow-lg shadow-black/5 hover:shadow-indigo-500/10 transition-shadow duration-300 rounded-2xl pointer-events-auto">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <SparklesIcon />
                    </div>
                    <input
                        type="text"
                        readOnly
                        value="facebook insta leads to whatsapp"
                        className="w-full rounded-2xl border border-muted bg-white/80 backdrop-blur-md pl-11 pr-4 py-3 text-sm font-medium text-foreground outline-none transition-colors group-hover:bg-white"
                    />
                    <div className="absolute inset-y-0 right-0 pr-2 flex items-center">
                        <span className="rounded-full bg-indigo-500/10 px-3 py-1 text-[10px] font-semibold tracking-wider uppercase text-indigo-500 border border-indigo-500/20">
                            Copilot Active
                        </span>
                    </div>
                </div>
            </div>

            <ReactFlow
                nodes={nodes.map(n => ({ ...n, selected: n.id === activeCard }))}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 2 }}
                minZoom={0.5}
                maxZoom={1.5}
                className="bg-muted/5"
            >
                <Background color="#ccc" gap={24} size={2} />
                <Controls className="fill-foreground bg-background border-border" />
            </ReactFlow>

             {/* Webhook Activity Feed (Floating Bottom Left) */}
            {externalSources && externalSources.length > 0 && (
                <div className="absolute bottom-6 left-6 z-10 max-w-sm pointer-events-none">
                    <div className="rounded-xl border border-border bg-white/90 shadow-lg backdrop-blur-sm overflow-hidden pointer-events-auto">
                        <div className="px-4 py-3 border-b border-border bg-muted/10 flex items-center justify-between">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Endpoints</h3>
                        </div>
                        <div className="divide-y divide-border">
                            {externalSources.map(source => (
                                <div key={source.id} className="flex flex-col gap-2 px-4 py-3 hover:bg-muted/5 transition-colors">
                                    <div className="flex items-center justify-between">
                                        <h4 className="font-medium text-xs">{source.name}</h4>
                                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleCopyWebhookUrl(source)} title="Copy Webhook URL">
                                            {copiedWebhookSourceId === source.id ? (
                                                <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                            ) : (
                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                                            )}
                                        </Button>
                                    </div>
                                    <code className="bg-muted/50 px-2 py-1 flex rounded text-[10px] truncate max-w-[250px] text-muted-foreground">{webhookUrlForSource(source)}</code>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
       </div>

       {/* Slider Configuration Drawer */}
       <div 
          className={`h-full bg-background border-l border-border transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] z-20 flex flex-col`}
          style={{ width: activeCard ? '420px' : '0px', opacity: activeCard ? 1 : 0 }}
        >
            {activeCard && (
                <div className="flex flex-col h-full w-[420px]"> {/* Fixed width inner container prevents weird text wrapping during animation */}
                    {/* Header */}
                    <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-card shrink-0">
                        <h2 className="font-semibold text-foreground">
                            {activeCard === 'meta_setup' ? 'Configure Meta Source' : 'Configure Pipeline'}
                        </h2>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-muted" onClick={() => setActiveCard(null)}>
                            <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </Button>
                    </div>

                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                        {sourceFormError && (
                            <div className="mb-6 rounded-lg bg-destructive/10 p-3 text-sm text-destructive border border-destructive/20">
                                {sourceFormError}
                            </div>
                        )}

                        {activeCard === 'meta_setup' && (
                            <div className="space-y-8 pb-10">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-xs font-bold">1</div>
                                        <label className="text-sm font-medium">Connect Account</label>
                                    </div>
                                    
                                    <div className="p-4 rounded-xl border border-muted bg-muted/10 shadow-sm">
                                        {setupDone ? (
                                            <div className="flex flex-col w-full">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm font-medium text-foreground">Meta Account Connected</span>
                                                    <Button size="sm" variant="ghost" className="text-muted-foreground h-8 hover:text-destructive" onClick={() => setMetaUserAccessTokenSecretId("")}>
                                                        Disconnect
                                                    </Button>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">Managed credentials are active</p>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col gap-4">
                                                <p className="text-sm text-muted-foreground">Log in with your Meta account to connect your pages and forms. Managed securely by Summun.</p>
                                                <Button onClick={handleStartMetaOauth} disabled={startMetaOauthMutation.isPending} className="bg-[#1877f2] hover:bg-[#1877f2]/90 text-white shadow-md w-full">
                                                    {startMetaOauthMutation.isPending ? "Connecting..." : "Continue with Facebook"}
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className={`space-y-4 transition-all duration-300 ${setupDone ? 'opacity-100 translate-y-0' : 'opacity-30 pointer-events-none translate-y-2'}`}>
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-xs font-bold">2</div>
                                        <label className="text-sm font-medium">Select Source Page</label>
                                    </div>
                                    
                                    {listMetaPagesMutation.isPending ? (
                                        <div className="p-3 text-sm text-muted-foreground border border-muted bg-muted/10 rounded-xl animate-pulse">Loading connected pages...</div>
                                    ) : metaPages.length > 0 ? (
                                        <select
                                            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                                            value={metaPageId}
                                            onChange={(e) => {
                                                setMetaPageId(e.target.value);
                                                setMetaForms([]);
                                                setMetaFormId("");
                                            }}
                                        >
                                            <option value="">Select a Facebook Page...</option>
                                            {metaPages.map((page) => (
                                                <option key={page.id} value={page.id}>
                                                    {page.name} {!page.hasManageLeads && "(Needs MANAGE_LEADS permission)"}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <div className="p-4 text-sm text-muted-foreground border border-muted bg-muted/10 rounded-xl">
                                            No pages connected. Ensure you grant permissions in the OAuth step.
                                        </div>
                                    )}
                                </div>

                                <div className={`space-y-4 transition-all duration-300 ${configureDone ? 'opacity-100 translate-y-0' : 'opacity-30 pointer-events-none translate-y-2'}`}>
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-xs font-bold">3</div>
                                        <label className="text-sm font-medium">Select Lead Form (Optional)</label>
                                    </div>
                                    
                                    {listMetaFormsMutation.isPending ? (
                                        <div className="p-3 text-sm text-muted-foreground border border-muted bg-muted/10 rounded-xl animate-pulse">Loading active forms...</div>
                                    ) : (
                                        <select
                                            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                                            value={metaFormId}
                                            onChange={(e) => setMetaFormId(e.target.value)}
                                        >
                                            <option value="">Capture from all forms on page</option>
                                            {metaForms.map((form) => (
                                                <option key={form.id} value={form.id}>
                                                    {form.name} ({form.status})
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>

                                <div className={`pt-4 border-t border-border transition-all duration-300 ${configureDone ? 'opacity-100' : 'opacity-0'}`}>
                                     <Button 
                                        className="w-full shadow-md z-1"
                                        size="lg" 
                                        onClick={handleAutoConnectMetaSource} 
                                        disabled={connectMetaSourceMutation.isPending || !metaPageId}
                                    >
                                        {connectMetaSourceMutation.isPending ? "Connecting Source..." : "Confirm & Connect Data Source"}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {activeCard === 'summun_setup' && (
                             <div className="space-y-6 pb-10">
                                <div className="space-y-3">
                                    <label className="text-sm font-medium">Pipeline Name</label>
                                    <input
                                        className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                                        type="text"
                                        value={sourceName}
                                        onChange={(e) => setSourceName(e.target.value)}
                                        placeholder="E.g. Website Growth Campaign Leads"
                                    />
                                </div>
                                
                                <div className="space-y-3">
                                    <label className="text-sm font-medium">Assign Reviewer Agent</label>
                                    <select
                                        className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm"
                                        value={sourceReviewerAgentId}
                                        onChange={(e) => setSourceReviewerAgentId(e.target.value)}
                                    >
                                        <option value="">Unassigned (Auto-process leads)</option>
                                        {(agents ?? []).map((agent) => (
                                            <option key={agent.id} value={agent.id}>
                                                {agent.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <details className="group rounded-xl border border-muted/50 bg-muted/10 mt-6 mt-8 overflow-hidden">
                                     <summary className="cursor-pointer font-medium p-4 text-sm flex items-center justify-between select-none">
                                         Advanced Developer Config
                                         <span className="text-muted-foreground group-open:rotate-180 transition-transform bg-background rounded p-1">
                                             <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                             </svg>
                                         </span>
                                     </summary>
                                     <div className="p-4 border-t border-muted/50 bg-muted/5 space-y-4">
                                          <div className="space-y-2">
                                             <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rules Config (JSON)</label>
                                             <textarea
                                                 className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus:border-indigo-500/30 transition-colors"
                                                 rows={4}
                                                 value={sourceRulesJson}
                                                 onChange={(e) => setSourceRulesJson(e.target.value)}
                                             />
                                          </div>
                                           <div className="space-y-2">
                                             <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">LLM Review Template</label>
                                             <textarea
                                                 className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus:border-indigo-500/30 transition-colors"
                                                 rows={3}
                                                 value={sourceTemplate}
                                                 onChange={(e) => setSourceTemplate(e.target.value)}
                                             />
                                          </div>
                                     </div>
                                </details>

                                <div className="pt-6 border-t border-border mt-8">
                                    <Button 
                                        className="w-full shadow-md shrink-0"
                                        size="lg" 
                                        onClick={handleSaveExternalSource} 
                                        disabled={sourceSaving}
                                    >
                                        {sourceSaving ? "Publishing Pipeline..." : "Publish Pipeline"}
                                    </Button>
                                </div>
                             </div>
                        )}
                    </div>
                </div>
            )}
       </div>
    </div>
  );
}

// Helpers
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
