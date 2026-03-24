import { useState } from "react";
import { Link } from "@/lib/router";
import type { DepartmentProcessor as ProcessorData, ProcessorStage, ProcessorItem } from "@paperclipai/shared";
import { cn } from "@/lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { StatusBadge } from "./StatusBadge";
import { ChevronRight, TrendingUp, AlertTriangle } from "lucide-react";

interface DepartmentProcessorProps {
  processor: ProcessorData | null;
  departmentColor: string;
  departmentId: string;
}

export function DepartmentProcessor({ processor, departmentColor, departmentId }: DepartmentProcessorProps) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  if (!processor || processor.stages.length === 0) {
    return (
      <div className="rounded-xl border border-border border-dashed p-8 text-center">
        <TrendingUp className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No processor data available.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Data will appear as signals flow through the department.
        </p>
      </div>
    );
  }

  const { stages, throughput } = processor;

  return (
    <div className="space-y-4">
      {/* Pipeline strip */}
      <div className="flex items-stretch gap-1 overflow-x-auto pb-2">
        {stages.map((stage, index) => {
          const isLast = index === stages.length - 1;
          const isBottleneck = throughput.bottleneckStage === stage.label;
          const isExpanded = expandedStage === stage.id;

          return (
            <div key={stage.id} className="flex items-stretch min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setExpandedStage(isExpanded ? null : stage.id)}
                className={cn(
                  "flex-1 min-w-[120px] rounded-xl border p-4 text-left transition-all duration-200",
                  isExpanded
                    ? "border-primary/50 bg-primary/5 shadow-sm"
                    : "border-border bg-card hover:border-border/80 hover:bg-accent/30",
                  isBottleneck && "border-amber-500/40",
                )}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {stage.label}
                    </span>
                    {isBottleneck && (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    )}
                  </div>
                  <p
                    className="text-2xl font-bold tabular-nums"
                    style={{ color: stage.count > 0 ? departmentColor : undefined }}
                  >
                    {stage.count}
                  </p>
                  <p className="text-[11px] text-muted-foreground line-clamp-1">
                    {stage.description}
                  </p>
                </div>
              </button>

              {/* Arrow between stages */}
              {!isLast && (
                <div className="flex items-center px-1">
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Throughput stats */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <span>
          Throughput: <span className="font-medium text-foreground">{throughput.signalsPerDay}/day</span>
        </span>
        <span>
          Avg time: <span className="font-medium text-foreground">{throughput.avgTimePerSignalMinutes}m</span>
        </span>
        {throughput.bottleneckStage && (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            Bottleneck: {throughput.bottleneckStage} — {throughput.bottleneckReason}
          </span>
        )}
      </div>

      {/* Expanded stage items */}
      {expandedStage && (() => {
        const stage = stages.find((s) => s.id === expandedStage);
        if (!stage) return null;
        return (
          <StageItems
            stage={stage}
            departmentColor={departmentColor}
            departmentId={departmentId}
          />
        );
      })()}
    </div>
  );
}

function StageItems({ stage, departmentColor, departmentId }: { stage: ProcessorStage; departmentColor: string; departmentId: string }) {
  if (stage.items.length === 0) {
    return (
      <div className="rounded-lg border border-border p-4 text-center text-sm text-muted-foreground">
        No items in this stage.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {stage.label} — {stage.count} items
        </span>
      </div>
        <div className="divide-y divide-border">
          {stage.items.map((item) => (
            <StageItemRow key={item.id} item={item} departmentColor={departmentColor} departmentId={departmentId} />
          ))}
      </div>
    </div>
  );
}

function StageItemRow({ item, departmentColor, departmentId }: { item: ProcessorItem; departmentColor: string; departmentId: string }) {
  const content = (
    <div className="px-4 py-3 flex items-center gap-3 hover:bg-accent/30 transition-colors">
      {/* Signal strength indicator */}
      {item.confidence !== null && (
        <div className="shrink-0">
          <div
            className="h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold"
            style={{
              backgroundColor:
                item.confidence >= 80
                  ? "#10b98120"
                  : item.confidence >= 50
                    ? "#f59e0b20"
                    : "#ef444420",
              color:
                item.confidence >= 80
                  ? "#10b981"
                  : item.confidence >= 50
                    ? "#f59e0b"
                    : "#ef4444",
            }}
          >
            {item.confidence}%
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{item.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {item.subtitle && (
            <span className="text-xs text-muted-foreground">{item.subtitle}</span>
          )}
          {item.agentName && (
            <span className="text-xs text-muted-foreground">
              Agent: <span className="font-medium">{item.agentName}</span>
            </span>
          )}
        </div>
        {item.intent && (
          <p className="text-xs text-muted-foreground mt-1 italic line-clamp-1">
            "{item.intent}"
          </p>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-2">
        <StatusBadge status={item.status} />
        <span className="text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
      </div>
    </div>
  );

  // Link leads to the signal transformation view
  if (item.sourceType === "lead") {
    return (
      <Link
        to={`/departments/${departmentId}/signals/${item.sourceId}`}
        className="block no-underline text-inherit"
      >
        {content}
      </Link>
    );
  }

  return content;
}
