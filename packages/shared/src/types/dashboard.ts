export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
  };
  pendingApprovals: number;
  staleTasks: number;
  metaOps?: {
    sources: {
      total: number;
      active: number;
      paused: number;
      failures: number;
      lastWebhookAt: string | null;
    };
    events24h: {
      received: number;
      processed: number;
      rejected: number;
      duplicate: number;
      failed: number;
    };
    actionItems: {
      pendingReview: number;
      pendingApproval: number;
      approved: number;
      rejected: number;
      cancelled: number;
    };
    pendingApprovals: number;
  };
}
