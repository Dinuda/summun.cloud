import type {
  CompanyExternalPluginConfig,
  CompanyExternalPluginConfigUpsertInput,
  CreateExternalEventSource,
  ExternalEventSource,
  ExternalMetaConnectResult,
  ExternalMetaLeadFormSummary,
  ExternalMetaOauthStartResult,
  ExternalMetaPageSummary,
  ExternalWhatsAppConnectResult,
  ExternalPluginMetadata,
  ExternalOpsSnapshot,
  MetaConnectFormsInput,
  MetaConnectPagesInput,
  MetaConnectSourceInput,
  WhatsAppConnectSourceInput,
  ReprocessExternalEventInput,
  RequestActionItemApproval,
  UpdateExternalEventSource,
} from "@paperclipai/shared";
import { api } from "./client";

export const externalEventSourcesApi = {
  list: (companyId: string, filters?: { pluginId?: string; provider?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (filters?.pluginId) query.set("pluginId", filters.pluginId);
    if (filters?.provider) query.set("provider", filters.provider);
    if (filters?.status) query.set("status", filters.status);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return api.get<ExternalEventSource[]>(`/companies/${companyId}/external-event-sources${suffix}`);
  },
  plugins: () => api.get<ExternalPluginMetadata[]>("/external-plugins"),
  get: (id: string) => api.get<ExternalEventSource>(`/external-event-sources/${id}`),
  create: (companyId: string, data: CreateExternalEventSource) =>
    api.post<ExternalEventSource>(`/companies/${companyId}/external-event-sources`, data),
  update: (id: string, data: UpdateExternalEventSource) =>
    api.patch<ExternalEventSource>(`/external-event-sources/${id}`, data),
  remove: (id: string) => api.delete<{ ok: true }>(`/external-event-sources/${id}`),
  pause: (id: string) => api.post<ExternalEventSource>(`/external-event-sources/${id}/pause`, {}),
  resume: (id: string) => api.post<ExternalEventSource>(`/external-event-sources/${id}/resume`, {}),
  reprocess: (companyId: string, data: ReprocessExternalEventInput) =>
    api.post(`/companies/${companyId}/external-events/reprocess`, data),
  metaOps: (companyId: string, limit = 20) =>
    api.get<ExternalOpsSnapshot>(`/companies/${companyId}/meta-ops?limit=${encodeURIComponent(String(limit))}`),
  externalOps: (companyId: string, limit = 20) =>
    api.get<ExternalOpsSnapshot>(`/companies/${companyId}/external-ops?limit=${encodeURIComponent(String(limit))}`),
  requestActionItemApproval: (actionItemId: string, data: RequestActionItemApproval) =>
    api.post(`/external-action-items/${actionItemId}/request-approval`, data),
  listMetaPages: (companyId: string, input: MetaConnectPagesInput) => {
    const query = new URLSearchParams({
      userAccessTokenSecretId: input.userAccessTokenSecretId,
    });
    return api.get<ExternalMetaPageSummary[]>(
      `/companies/${companyId}/external-event-sources/meta/pages?${query.toString()}`,
    );
  },
  listMetaLeadForms: (companyId: string, input: MetaConnectFormsInput) => {
    const query = new URLSearchParams({
      userAccessTokenSecretId: input.userAccessTokenSecretId,
      pageId: input.pageId,
    });
    return api.get<ExternalMetaLeadFormSummary[]>(
      `/companies/${companyId}/external-event-sources/meta/forms?${query.toString()}`,
    );
  },
  connectMetaSource: (companyId: string, data: MetaConnectSourceInput) =>
    api.post<ExternalMetaConnectResult>(`/companies/${companyId}/external-event-sources/meta/connect`, data),
  getCompanyPluginConfig: (companyId: string, pluginId: string) =>
    api.get<CompanyExternalPluginConfig>(`/companies/${companyId}/external-plugin-configs/${pluginId}`),
  upsertCompanyPluginConfig: (
    companyId: string,
    pluginId: string,
    data: CompanyExternalPluginConfigUpsertInput,
  ) => api.put<CompanyExternalPluginConfig>(`/companies/${companyId}/external-plugin-configs/${pluginId}`, data),
  startMetaOauth: (companyId: string, input?: { returnTo?: string }) => {
    const query = new URLSearchParams();
    if (input?.returnTo) query.set("returnTo", input.returnTo);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return api.get<ExternalMetaOauthStartResult>(
      `/companies/${companyId}/external-event-sources/meta/oauth/start${suffix}`,
    );
  },
  connectWhatsAppBusinessSource: (companyId: string, data: WhatsAppConnectSourceInput) =>
    api.post<ExternalWhatsAppConnectResult>(`/companies/${companyId}/external-event-sources/whatsapp/connect`, data),
};
