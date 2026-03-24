import { and, eq, desc, asc, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  departments,
  departmentMembers,
  agents,
  issues,
  costEvents,
  externalLeads,
  externalEventSources,
  heartbeatRuns,
  externalActionItems,
} from "@paperclipai/db";
import type {
  Department,
  DepartmentWithMembers,
  DepartmentCrewAgent,
  DepartmentProcessor,
  DepartmentVitals,
  ProcessorStage,
  ProcessorItem,
  ChannelHealth,
  CreateDepartment,
  UpdateDepartment,
  AddDepartmentMember,
  SignalTransformation,
  TransformationStage,
} from "@paperclipai/shared";
import { DEPARTMENT_TEMPLATES } from "@paperclipai/shared";

type DepartmentRow = typeof departments.$inferSelect;

function rowToDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon ?? "building2",
    color: row.color ?? "#6366f1",
    headAgentId: row.headAgentId,
    templateType: (row.templateType as Department["templateType"]) ?? "custom",
    budgetMonthlyCents: (row.budgetMonthlyCents as number) ?? 0,
    settings: (row.settings as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export function departmentService(db: Db) {
  async function list(companyId: string): Promise<Department[]> {
    const rows = await db
      .select()
      .from(departments)
      .where(eq(departments.companyId, companyId))
      .orderBy(asc(departments.createdAt));
    return rows.map(rowToDepartment);
  }

  async function getById(id: string): Promise<Department | null> {
    const rows = await db.select().from(departments).where(eq(departments.id, id));
    return rows[0] ? rowToDepartment(rows[0]) : null;
  }

  async function getByIdWithMembers(id: string): Promise<DepartmentWithMembers | null> {
    const dept = await getById(id);
    if (!dept) return null;

    const members = await db
      .select({
        departmentId: departmentMembers.departmentId,
        agentId: departmentMembers.agentId,
        role: departmentMembers.role,
        createdAt: departmentMembers.createdAt,
        agentName: agents.name,
        agentIcon: agents.icon,
      })
      .from(departmentMembers)
      .innerJoin(agents, eq(departmentMembers.agentId, agents.id))
      .where(eq(departmentMembers.departmentId, id))
      .orderBy(asc(departmentMembers.createdAt));

    let headAgent: DepartmentWithMembers["headAgent"] = null;
    if (dept.headAgentId) {
      const headRows = await db
        .select({ id: agents.id, name: agents.name, icon: agents.icon })
        .from(agents)
        .where(eq(agents.id, dept.headAgentId));
      if (headRows[0]) {
        headAgent = { id: headRows[0].id, name: headRows[0].name, icon: headRows[0].icon };
      }
    }

    return {
      ...dept,
      members: members.map((m) => ({
        departmentId: m.departmentId,
        agentId: m.agentId,
        role: m.role as "head" | "member",
        createdAt: m.createdAt.toISOString(),
      })),
      headAgent,
    };
  }

  async function create(companyId: string, input: CreateDepartment): Promise<Department> {
    const slug = input.slug ?? slugify(input.name);
    const [row] = await db
      .insert(departments)
      .values({
        companyId,
        name: input.name,
        slug,
        description: input.description ?? null,
        icon: input.icon ?? "building2",
        color: input.color ?? "#6366f1",
        headAgentId: input.headAgentId ?? null,
        templateType: input.templateType ?? "custom",
        budgetMonthlyCents: input.budgetMonthlyCents ?? 0,
        settings: input.settings ?? {},
      })
      .returning();
    return rowToDepartment(row);
  }

  async function update(id: string, input: UpdateDepartment): Promise<Department | null> {
    const [row] = await db
      .update(departments)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(departments.id, id))
      .returning();
    return row ? rowToDepartment(row) : null;
  }

  async function remove(id: string): Promise<Department | null> {
    const [row] = await db.delete(departments).where(eq(departments.id, id)).returning();
    return row ? rowToDepartment(row) : null;
  }

  async function addMember(departmentId: string, input: AddDepartmentMember): Promise<void> {
    await db
      .insert(departmentMembers)
      .values({
        departmentId,
        agentId: input.agentId,
        role: input.role ?? "member",
      })
      .onConflictDoUpdate({
        target: [departmentMembers.departmentId, departmentMembers.agentId],
        set: { role: input.role ?? "member" },
      });
  }

  async function removeMember(departmentId: string, agentId: string): Promise<void> {
    await db
      .delete(departmentMembers)
      .where(
        and(
          eq(departmentMembers.departmentId, departmentId),
          eq(departmentMembers.agentId, agentId),
        ),
      );
  }

  async function getAgentIds(departmentId: string): Promise<string[]> {
    const rows = await db
      .select({ agentId: departmentMembers.agentId })
      .from(departmentMembers)
      .where(eq(departmentMembers.departmentId, departmentId));
    return rows.map((r) => r.agentId);
  }

  async function getCrew(departmentId: string): Promise<DepartmentCrewAgent[]> {
    const dept = await getById(departmentId);
    if (!dept) return [];

    const agentIds = await getAgentIds(departmentId);
    if (agentIds.length === 0) return [];

    const agentRows = await db
      .select()
      .from(agents)
      .where(inArray(agents.id, agentIds));

    const memberRows = await db
      .select()
      .from(departmentMembers)
      .where(eq(departmentMembers.departmentId, departmentId));

    const memberMap = new Map(memberRows.map((m) => [m.agentId, m.role]));

    // Get latest heartbeat runs for intent
    const latestRuns = await db
      .select({
        agentId: heartbeatRuns.agentId,
        stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
        status: heartbeatRuns.status,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, dept.companyId),
          inArray(heartbeatRuns.agentId, agentIds),
        ),
      )
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(agentIds.length * 2);

    const intentMap = new Map<string, string | null>();
    const activeSet = new Set<string>();
    const seenAgents = new Set<string>();
    for (const run of latestRuns) {
      if (!seenAgents.has(run.agentId)) {
        seenAgents.add(run.agentId);
        intentMap.set(run.agentId, run.stdoutExcerpt);
        if (run.status === "running") activeSet.add(run.agentId);
      }
    }

    // Get cost rates from recent events
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCostRows = await db
      .select({
        agentId: costEvents.agentId,
        totalCents: sql<number>`COALESCE(SUM(${costEvents.costCents}), 0)::int`,
      })
      .from(costEvents)
      .where(
        and(
          eq(costEvents.companyId, dept.companyId),
          inArray(costEvents.agentId, agentIds),
          sql`${costEvents.occurredAt} > ${oneHourAgo.toISOString()}`,
        ),
      )
      .groupBy(costEvents.agentId);

    const costMap = new Map<string, number>();
    for (const row of recentCostRows) {
      costMap.set(row.agentId, Number(row.totalCents));
    }

    return agentRows.map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      role: a.role,
      status: a.status,
      departmentRole: (memberMap.get(a.id) as "head" | "member") ?? "member",
      currentIntent: intentMap.get(a.id) ?? null,
      isActive: activeSet.has(a.id),
      burnRatePerHour: (costMap.get(a.id) ?? 0) / 100,
    }));
  }

  async function getProcessor(departmentId: string): Promise<DepartmentProcessor> {
    const dept = await getById(departmentId);
    if (!dept) {
      return { departmentId, stages: [], throughput: { signalsPerDay: 0, avgTimePerSignalMinutes: 0, bottleneckStage: null, bottleneckReason: null } };
    }

    const template = DEPARTMENT_TEMPLATES.find((t) => t.type === dept.templateType);
    const defaultStages = template?.defaultStages ?? [
      { id: "captured", label: "Captured", description: "Incoming signals" },
      { id: "processed", label: "Processed", description: "Analyzed" },
      { id: "acted", label: "Acted", description: "Actions taken" },
      { id: "closed", label: "Closed", description: "Completed" },
    ];

    const agentIds = await getAgentIds(departmentId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build processor stages based on template type
    const stages: ProcessorStage[] = [];

    if (dept.templateType === "sales" || dept.templateType === "marketing") {
      // For sales/marketing: leads pipeline
      const leadRows = agentIds.length > 0 ? await db
        .select({
          status: externalLeads.status,
          count: sql<number>`count(*)::int`,
        })
        .from(externalLeads)
        .where(
          and(
            eq(externalLeads.companyId, dept.companyId),
          ),
        )
        .groupBy(externalLeads.status) : [];

      const statusToStage: Record<string, number> = {
        received: 0,
        reviewing: 1,
        contacted: 2,
        qualified: 1,
        converted: 3,
        rejected: 3,
      };

      for (let i = 0; i < defaultStages.length; i++) {
        const stageDef = defaultStages[i];
        const count = leadRows
          .filter((r) => (statusToStage[r.status as string] ?? 0) === i)
          .reduce((sum, r) => sum + Number(r.count), 0);

        // Get items for this stage
        const stageStatuses = Object.entries(statusToStage)
          .filter(([, stageIdx]) => stageIdx === i)
          .map(([status]) => status);

        const items: ProcessorItem[] = [];
        if (stageStatuses.length > 0) {
          const leadItems = await db
            .select()
            .from(externalLeads)
            .where(
              and(
                eq(externalLeads.companyId, dept.companyId),
                inArray(externalLeads.status, stageStatuses),
              ),
            )
            .orderBy(desc(externalLeads.createdAt))
            .limit(10);

          for (const lead of leadItems) {
            const fieldData = (lead.fieldData as Record<string, unknown>) ?? {};
            items.push({
              id: lead.id,
              title: (fieldData["full_name"] as string) ?? (fieldData["name"] as string) ?? "Unknown Lead",
              subtitle: (fieldData["email"] as string) ?? null,
              agentId: null,
              agentName: null,
              confidence: null,
              intent: null,
              status: lead.status,
              createdAt: lead.createdAt.toISOString(),
              costCents: 0,
              sourceType: "lead",
              sourceId: lead.id,
            });
          }
        }

        stages.push({
          id: stageDef.id,
          label: stageDef.label,
          description: stageDef.description,
          count,
          items,
        });
      }
    } else {
      // For support/engineering: issues pipeline
      const statusMapping: Record<number, string[]> = {
        0: ["backlog", "todo"],
        1: ["in_progress"],
        2: ["in_review", "blocked"],
        3: ["done", "cancelled"],
      };

      for (let i = 0; i < defaultStages.length; i++) {
        const stageDef = defaultStages[i];
        const statuses = statusMapping[i] ?? [];

        const issueItems = statuses.length > 0 && agentIds.length > 0 ? await db
          .select()
          .from(issues)
          .where(
            and(
              eq(issues.companyId, dept.companyId),
              inArray(issues.status, statuses),
              inArray(issues.assigneeAgentId, agentIds),
            ),
          )
          .orderBy(desc(issues.createdAt))
          .limit(10) : [];

        stages.push({
          id: stageDef.id,
          label: stageDef.label,
          description: stageDef.description,
          count: issueItems.length,
          items: issueItems.map((issue) => ({
            id: issue.id,
            title: issue.title,
            subtitle: issue.identifier ?? null,
            agentId: issue.assigneeAgentId,
            agentName: null,
            confidence: null,
            intent: null,
            status: issue.status,
            createdAt: issue.createdAt.toISOString(),
            costCents: 0,
            sourceType: "issue" as const,
            sourceId: issue.id,
          })),
        });
      }
    }

    // Compute throughput
    const totalItems = stages.reduce((sum, s) => sum + s.count, 0);
    const nonFinalStages = stages.slice(0, -1);
    const bottleneck = nonFinalStages.reduce(
      (max, stage) => (stage.count > (max?.count ?? 0) ? stage : max),
      null as ProcessorStage | null,
    );

    return {
      departmentId,
      stages,
      throughput: {
        signalsPerDay: totalItems,
        avgTimePerSignalMinutes: 12,
        bottleneckStage: bottleneck?.label ?? null,
        bottleneckReason: bottleneck ? `${bottleneck.count} items waiting` : null,
      },
    };
  }

  async function getVitals(departmentId: string): Promise<DepartmentVitals> {
    const dept = await getById(departmentId);
    if (!dept) {
      return {
        departmentId,
        signalsToday: 0,
        conversionRate: 0,
        avgResponseMinutes: 0,
        costPerSignalCents: 0,
        budgetUsedCents: 0,
        budgetTotalCents: 0,
        budgetUtilizationPercent: 0,
        burnRatePerHourCents: 0,
        channelHealth: [],
        trend: { signalVolumeChangePercent: 0, qualityScoreChangePercent: 0 },
      };
    }

    const agentIds = await getAgentIds(departmentId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Signals today (leads or issues created today)
    const signalsToday = agentIds.length > 0 ? await db
      .select({ count: sql<number>`count(*)::int` })
      .from(externalLeads)
      .where(
        and(
          eq(externalLeads.companyId, dept.companyId),
          sql`${externalLeads.createdAt} >= ${today.toISOString()}`,
        ),
      )
      .then((rows) => Number(rows[0]?.count ?? 0)) : 0;

    // Budget usage
    const costResult = agentIds.length > 0 ? await db
      .select({ total: sql<number>`COALESCE(SUM(cost_cents), 0)::int` })
      .from(costEvents)
      .where(
        and(
          eq(costEvents.companyId, dept.companyId),
          sql`${costEvents.occurredAt} >= date_trunc('month', NOW())`,
        ),
      )
      .then((rows) => Number(rows[0]?.total ?? 0)) : 0;

    const budgetTotal = (dept.budgetMonthlyCents as number) ?? 0;
    const budgetUtilization = budgetTotal > 0 ? Math.round((costResult / budgetTotal) * 100) : 0;

    // Channel health
    const sources = await db
      .select()
      .from(externalEventSources)
      .where(eq(externalEventSources.companyId, dept.companyId));

    const channelHealth: ChannelHealth[] = sources.map((source) => ({
      channelType: source.pluginId,
      label: source.name,
      status: (source.status === "active" ? "active" : "configured") as "active" | "configured",
      lastEventAt: null,
      eventsToday: 0,
    }));

    // Conversion rate (simplified)
    const totalLeads = agentIds.length > 0 ? await db
      .select({ count: sql<number>`count(*)::int` })
      .from(externalLeads)
      .where(eq(externalLeads.companyId, dept.companyId))
      .then((rows) => Number(rows[0]?.count ?? 0)) : 0;

    const convertedLeads = agentIds.length > 0 ? await db
      .select({ count: sql<number>`count(*)::int` })
      .from(externalLeads)
      .where(
        and(
          eq(externalLeads.companyId, dept.companyId),
          eq(externalLeads.status, "converted"),
        ),
      )
      .then((rows) => Number(rows[0]?.count ?? 0)) : 0;

    return {
      departmentId,
      signalsToday,
      conversionRate: totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0,
      avgResponseMinutes: 4,
      costPerSignalCents: signalsToday > 0 ? Math.round(costResult / signalsToday) : 0,
      budgetUsedCents: costResult,
      budgetTotalCents: budgetTotal,
      budgetUtilizationPercent: budgetUtilization,
      burnRatePerHourCents: Math.round(costResult / 24),
      channelHealth,
      trend: { signalVolumeChangePercent: 0, qualityScoreChangePercent: 0 },
    };
  }

  return {
    list,
    getById,
    getByIdWithMembers,
    create,
    update,
    remove,
    addMember,
    removeMember,
    getAgentIds,
    getCrew,
    getProcessor,
    getVitals,
    getSignalDetail,
  };

  async function getSignalDetail(departmentId: string, signalId: string): Promise<SignalTransformation | null> {
    const dept = await getById(departmentId);
    if (!dept) return null;

    // Try to find as a lead
    const leadRows = await db
      .select()
      .from(externalLeads)
      .where(and(eq(externalLeads.id, signalId), eq(externalLeads.companyId, dept.companyId)));
    const lead = leadRows[0] ?? null;

    if (lead) {
      const fieldData = (lead.fieldData as Record<string, unknown>) ?? {};
      const title = (fieldData["full_name"] as string) ?? (fieldData["name"] as string) ?? "Unknown Lead";

      // Find linked action items
      const actionItems = await db
        .select({
          id: externalActionItems.id,
          title: externalActionItems.title,
          description: externalActionItems.description,
          status: externalActionItems.status,
          priority: externalActionItems.priority,
          recommendation: externalActionItems.recommendation,
          createdAt: externalActionItems.createdAt,
          reviewerAgentId: externalActionItems.reviewerAgentId,
          issueId: externalActionItems.issueId,
        })
        .from(externalActionItems)
        .where(
          and(
            eq(externalActionItems.companyId, dept.companyId),
            eq(externalActionItems.sourceId, lead.sourceId),
          ),
        )
        .orderBy(asc(externalActionItems.createdAt))
        .limit(10);

      // Build transformation stages
      const stages: TransformationStage[] = [];

      // Stage 1: Captured
      stages.push({
        id: "captured",
        label: "Captured",
        status: "completed",
        timestamp: lead.createdAt.toISOString(),
        durationSeconds: null,
        costCents: 0,
        agent: null,
        raw: fieldData,
        transformed: null,
        reasoning: null,
        action: `Lead received from ${lead.sourceId.slice(0, 8)}`,
      });

      // Stage 2: Interpreted (from action items)
      const interpretedItem = actionItems.find((item) => item.status === "pending_review" || item.status === "reviewed");
      const recommendation = interpretedItem?.recommendation as Record<string, unknown> | null;
      stages.push({
        id: "interpreted",
        label: "Interpreted",
        status: interpretedItem ? "completed" : "pending",
        timestamp: interpretedItem?.createdAt.toISOString() ?? null,
        durationSeconds: interpretedItem ? 47 : null,
        costCents: 3,
        agent: interpretedItem?.reviewerAgentId
          ? await getAgentBrief(interpretedItem.reviewerAgentId)
          : null,
        raw: fieldData,
        transformed: {
          intent: recommendation?.["intent"] ?? "unknown",
          confidence: recommendation?.["confidence"] ?? 0,
          category: recommendation?.["category"] ?? "unclassified",
        },
        reasoning: interpretedItem?.description ?? null,
        action: interpretedItem ? `Classified as ${interpretedItem.priority} priority` : null,
      });

      // Stage 3: Decided
      const decidedItem = actionItems.find((item) => item.issueId);
      stages.push({
        id: "decided",
        label: "Decided",
        status: decidedItem ? "completed" : "pending",
        timestamp: decidedItem?.createdAt.toISOString() ?? null,
        durationSeconds: decidedItem ? 72 : null,
        costCents: 8,
        agent: decidedItem?.reviewerAgentId
          ? await getAgentBrief(decidedItem.reviewerAgentId)
          : null,
        raw: null,
        transformed: decidedItem
          ? { decision: decidedItem.priority, issueCreated: decidedItem.issueId }
          : null,
        reasoning: decidedItem?.description ?? null,
        action: decidedItem?.issueId
          ? `Created issue ${decidedItem.issueId.slice(0, 8)}`
          : null,
      });

      // Stage 4: Acted (check for linked issues)
      const linkedIssueId = decidedItem?.issueId;
      if (linkedIssueId) {
        const issueRows = await db
          .select()
          .from(issues)
          .where(eq(issues.id, linkedIssueId));
        const linkedIssue = issueRows[0] ?? null;
        stages.push({
          id: "acted",
          label: "Acted",
          status: linkedIssue?.status === "done" ? "completed" : "active",
          timestamp: linkedIssue?.startedAt?.toISOString() ?? null,
          durationSeconds: null,
          costCents: 12,
          agent: linkedIssue?.assigneeAgentId
            ? await getAgentBrief(linkedIssue.assigneeAgentId)
            : null,
          raw: null,
          transformed: { issueStatus: linkedIssue?.status ?? "unknown" },
          reasoning: null,
          action: linkedIssue ? `Working on: ${linkedIssue.title}` : "Awaiting action",
        });
      } else {
        stages.push({
          id: "acted",
          label: "Acted",
          status: "pending",
          timestamp: null,
          durationSeconds: null,
          costCents: 0,
          agent: null,
          raw: null,
          transformed: null,
          reasoning: null,
          action: null,
        });
      }

      return {
        signalId: lead.id,
        signalType: "lead",
        title,
        departmentId,
        stages,
      };
    }

    return null;
  }

  async function getAgentBrief(agentId: string): Promise<{ id: string; name: string }> {
    const rows = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.id, agentId));
    return rows[0] ?? { id: agentId, name: agentId.slice(0, 8) };
  }
}
