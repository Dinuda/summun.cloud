export interface Department {
  id: string;
  companyId: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string;
  color: string;
  headAgentId: string | null;
  templateType: DepartmentTemplateType;
  budgetMonthlyCents: number;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentMember {
  departmentId: string;
  agentId: string;
  role: DepartmentMemberRole;
  createdAt: string;
}

export interface DepartmentWithMembers extends Department {
  members: DepartmentMember[];
  headAgent: {
    id: string;
    name: string;
    icon: string | null;
  } | null;
}

export interface DepartmentCrewAgent {
  id: string;
  name: string;
  icon: string | null;
  role: string;
  status: string;
  departmentRole: DepartmentMemberRole;
  currentIntent: string | null;
  isActive: boolean;
  burnRatePerHour: number;
}

export interface ProcessorStage {
  id: string;
  label: string;
  description: string;
  count: number;
  items: ProcessorItem[];
}

export interface ProcessorItem {
  id: string;
  title: string;
  subtitle: string | null;
  agentId: string | null;
  agentName: string | null;
  confidence: number | null;
  intent: string | null;
  status: string;
  createdAt: string;
  costCents: number;
  sourceType: "lead" | "issue" | "action_item" | "external_event";
  sourceId: string;
}

export interface DepartmentVitals {
  departmentId: string;
  signalsToday: number;
  conversionRate: number;
  avgResponseMinutes: number;
  costPerSignalCents: number;
  budgetUsedCents: number;
  budgetTotalCents: number;
  budgetUtilizationPercent: number;
  burnRatePerHourCents: number;
  channelHealth: ChannelHealth[];
  trend: {
    signalVolumeChangePercent: number;
    qualityScoreChangePercent: number;
  };
}

export interface ChannelHealth {
  channelType: string;
  label: string;
  status: "active" | "configured" | "inactive";
  lastEventAt: string | null;
  eventsToday: number;
}

export interface DepartmentProcessor {
  departmentId: string;
  stages: ProcessorStage[];
  throughput: {
    signalsPerDay: number;
    avgTimePerSignalMinutes: number;
    bottleneckStage: string | null;
    bottleneckReason: string | null;
  };
}

export type DepartmentTemplateType =
  | "sales"
  | "support"
  | "engineering"
  | "marketing"
  | "operations"
  | "custom";

export type DepartmentMemberRole = "head" | "member";

export interface DepartmentTemplate {
  type: DepartmentTemplateType;
  name: string;
  description: string;
  icon: string;
  color: string;
  defaultStages: { id: string; label: string; description: string }[];
  suggestedAgentRoles: { role: string; title: string }[];
  suggestedChannels: string[];
}

export interface SignalTransformation {
  signalId: string;
  signalType: "lead" | "issue" | "action_item";
  title: string;
  departmentId: string;
  stages: TransformationStage[];
}

export interface TransformationStage {
  id: string;
  label: string;
  status: "completed" | "active" | "pending";
  timestamp: string | null;
  durationSeconds: number | null;
  costCents: number;
  agent: {
    id: string;
    name: string;
  } | null;
  raw: Record<string, unknown> | null;
  transformed: Record<string, unknown> | null;
  reasoning: string | null;
  action: string | null;
}

export const DEPARTMENT_TEMPLATES: DepartmentTemplate[] = [
  {
    type: "sales",
    name: "Sales",
    description: "Lead capture, qualification, outreach, and conversion",
    icon: "trending-up",
    color: "#10b981",
    defaultStages: [
      { id: "captured", label: "Captured", description: "Raw signals ingested from channels" },
      { id: "interpreted", label: "Interpreted", description: "Intent and context extracted by agents" },
      { id: "decided", label: "Decided", description: "Quality assessed, action determined" },
      { id: "acted", label: "Acted", description: "Outreach sent, conversations started" },
    ],
    suggestedAgentRoles: [
      { role: "director", title: "Sales Director" },
      { role: "qualifier", title: "Lead Qualifier" },
      { role: "outreach", title: "Outreach Agent" },
    ],
    suggestedChannels: ["meta_leadgen", "meta_whatsapp_business"],
  },
  {
    type: "support",
    name: "Support",
    description: "Ticket triage, diagnosis, resolution, and follow-up",
    icon: "headphones",
    color: "#f59e0b",
    defaultStages: [
      { id: "received", label: "Received", description: "Incoming requests from channels" },
      { id: "triaged", label: "Triaged", description: "Categorized, severity assessed" },
      { id: "resolving", label: "Resolving", description: "Solution being applied" },
      { id: "closed", label: "Closed", description: "Resolved and confirmed" },
    ],
    suggestedAgentRoles: [
      { role: "lead", title: "Support Lead" },
      { role: "triage", title: "Triage Agent" },
      { role: "resolution", title: "Resolution Agent" },
    ],
    suggestedChannels: ["meta_whatsapp_business"],
  },
  {
    type: "engineering",
    name: "Engineering",
    description: "Issue analysis, implementation, review, and shipping",
    icon: "code",
    color: "#6366f1",
    defaultStages: [
      { id: "filed", label: "Filed", description: "Issues created and scoped" },
      { id: "analyzed", label: "Analyzed", description: "Root cause identified, approach decided" },
      { id: "building", label: "Building", description: "Implementation in progress" },
      { id: "shipped", label: "Shipped", description: "Deployed and verified" },
    ],
    suggestedAgentRoles: [
      { role: "lead", title: "Tech Lead" },
      { role: "developer", title: "Developer Agent" },
      { role: "reviewer", title: "Code Reviewer" },
    ],
    suggestedChannels: [],
  },
  {
    type: "marketing",
    name: "Marketing",
    description: "Campaign management, content creation, and analytics",
    icon: "megaphone",
    color: "#ec4899",
    defaultStages: [
      { id: "launched", label: "Launched", description: "Campaigns and content deployed" },
      { id: "measuring", label: "Measuring", description: "Performance data being collected" },
      { id: "optimizing", label: "Optimizing", description: "A/B tests and adjustments" },
      { id: "scaled", label: "Scaled", description: "Successful campaigns amplified" },
    ],
    suggestedAgentRoles: [
      { role: "strategist", title: "Marketing Strategist" },
      { role: "creator", title: "Content Creator" },
      { role: "analyst", title: "Analytics Agent" },
    ],
    suggestedChannels: ["meta_leadgen"],
  },
];
