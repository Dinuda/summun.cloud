import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "@/lib/router";
import { departmentsApi } from "../api/departments";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { timeAgo } from "../lib/timeAgo";
import { formatCents } from "../lib/utils";
import { cn } from "@/lib/utils";
import { useEffect } from "react";
import {
  ArrowLeft,
  Check,
  Clock,
  Loader2,
  DollarSign,
  User,
  Zap,
  Brain,
  ArrowRight,
} from "lucide-react";
import type { TransformationStage } from "@paperclipai/shared";

export function SignalDetail() {
  const { departmentId, signalId } = useParams<{ departmentId: string; signalId: string }>();
  const { setBreadcrumbs } = useBreadcrumbs();

  const { data: signal, isLoading } = useQuery({
    queryKey: queryKeys.departments.signal(departmentId!, signalId!),
    queryFn: () => departmentsApi.signalDetail(departmentId!, signalId!),
    enabled: !!departmentId && !!signalId,
  });

  useEffect(() => {
    if (signal) {
      setBreadcrumbs([
        { label: signal.title },
      ]);
    }
  }, [signal?.title, setBreadcrumbs]);

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (!signal) return <EmptyState icon={Brain} message="Signal not found." />;

  const completedStages = signal.stages.filter((s) => s.status === "completed");
  const totalCost = signal.stages.reduce((sum, s) => sum + s.costCents, 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <Link
          to={`/departments/${departmentId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to department
        </Link>
        <h1 className="text-xl font-bold">{signal.title}</h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-mono">{signal.signalId.slice(0, 8)}</span>
          <span>•</span>
          <span className="capitalize">{signal.signalType}</span>
          <span>•</span>
          <span>{completedStages.length}/{signal.stages.length} stages complete</span>
          <span>•</span>
          <span className="font-mono">{formatCents(totalCost)} total cost</span>
        </div>
      </div>

      {/* Transformation Pipeline */}
      <div className="relative">
        {signal.stages.map((stage, index) => {
          const isLast = index === signal.stages.length - 1;
          return (
            <div key={stage.id} className="relative">
              <StageCard stage={stage} index={index} />
              {!isLast && (
                <div className="flex justify-center py-1">
                  <ArrowRight className="h-4 w-4 text-muted-foreground/30 rotate-90" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StageCard({ stage, index }: { stage: TransformationStage; index: number }) {
  const isCompleted = stage.status === "completed";
  const isActive = stage.status === "active";
  const isPending = stage.status === "pending";

  return (
    <div
      className={cn(
        "relative rounded-xl border overflow-hidden transition-all",
        isCompleted && "border-emerald-500/30 bg-emerald-500/5",
        isActive && "border-primary/50 bg-primary/5 shadow-sm shadow-primary/10",
        isPending && "border-border bg-card opacity-60",
      )}
    >
      {/* Stage header */}
      <div className="px-5 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold",
              isCompleted && "bg-emerald-500/20 text-emerald-600",
              isActive && "bg-primary/20 text-primary",
              isPending && "bg-muted text-muted-foreground",
            )}
          >
            {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
          </div>
          <div>
            <h3 className="text-sm font-semibold">{stage.label}</h3>
            {stage.timestamp && (
              <p className="text-[11px] text-muted-foreground">{timeAgo(stage.timestamp)}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {stage.durationSeconds !== null && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {stage.durationSeconds}s
            </span>
          )}
          {stage.costCents > 0 && (
            <span className="flex items-center gap-1 font-mono">
              <DollarSign className="h-3 w-3" />
              {formatCents(stage.costCents)}
            </span>
          )}
          {isActive && (
            <span className="flex items-center gap-1 text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              Live
            </span>
          )}
        </div>
      </div>

      {/* Stage content */}
      <div className="px-5 py-4 space-y-4">
        {/* Agent info */}
        {stage.agent && (
          <div className="flex items-center gap-2 text-sm">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{stage.agent.name}</span>
          </div>
        )}

        {/* Raw data (Stage 1) */}
        {stage.raw && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Raw Input
            </p>
            <div className="rounded-lg bg-muted/30 border border-border/50 p-3 font-mono text-xs space-y-1">
              {Object.entries(stage.raw).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">{key}:</span>
                  <span className="text-foreground break-all">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transformed output */}
        {stage.transformed && Object.keys(stage.transformed).length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Transformed Output
            </p>
            <div className="rounded-lg bg-muted/30 border border-border/50 p-3 space-y-1.5">
              {Object.entries(stage.transformed).map(([key, value]) => (
                <div key={key} className="flex items-start gap-2">
                  <span className="text-xs text-muted-foreground shrink-0 capitalize">
                    {key.replace(/([A-Z])/g, " $1").trim()}:
                  </span>
                  <span className="text-sm font-medium">
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Agent reasoning */}
        {stage.reasoning && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1">
              <Brain className="h-3 w-3" />
              Agent Reasoning
            </p>
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 text-sm italic text-foreground/80">
              "{stage.reasoning}"
            </div>
          </div>
        )}

        {/* Action taken */}
        {stage.action && (
          <div className="flex items-center gap-2 text-sm">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">{stage.action}</span>
          </div>
        )}

        {/* Pending state */}
        {isPending && !stage.raw && !stage.transformed && !stage.reasoning && !stage.action && (
          <p className="text-sm text-muted-foreground italic">Awaiting processing...</p>
        )}
      </div>
    </div>
  );
}
