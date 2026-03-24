import type { DepartmentCrewAgent } from "@paperclipai/shared";
import { cn } from "@/lib/utils";
import { Bot, Zap, Clock } from "lucide-react";

interface DepartmentCrewProps {
  agents: DepartmentCrewAgent[];
  departmentColor: string;
}

export function DepartmentCrew({ agents, departmentColor }: DepartmentCrewProps) {
  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-border border-dashed p-8 text-center">
        <Bot className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No agents assigned to this department.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Assign agents from the Agents page or Company Settings.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent) => (
        <AgentPulseCard key={agent.id} agent={agent} departmentColor={departmentColor} />
      ))}
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function AgentPulseCard({ agent, departmentColor }: { agent: DepartmentCrewAgent; departmentColor: string }) {
  const isActive = agent.isActive;
  const intent = agent.currentIntent;

  return (
    <div
      className={cn(
        "relative rounded-xl border p-4 transition-all duration-200",
        isActive
          ? "border-primary/30 bg-primary/5 shadow-sm"
          : "border-border bg-card hover:border-border/80",
      )}
    >
      {/* Live pulse indicator */}
      {isActive && (
        <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ backgroundColor: departmentColor }}
          />
          <span
            className="relative inline-flex rounded-full h-2.5 w-2.5"
            style={{ backgroundColor: departmentColor }}
          />
        </span>
      )}

      <div className="space-y-3">
        {/* Agent identity */}
        <div className="flex items-center gap-2.5">
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
            style={{ backgroundColor: departmentColor }}
          >
            {getInitials(agent.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{agent.name}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground capitalize">{agent.role}</span>
              {agent.departmentRole === "head" && (
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: `${departmentColor}20`, color: departmentColor }}
                >
                  Head
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Current intent */}
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-xs leading-relaxed",
            intent
              ? "bg-muted/50 text-foreground"
              : "bg-muted/30 text-muted-foreground italic",
          )}
        >
          {intent ? (
            <p className="line-clamp-2 break-words">"{intent}"</p>
          ) : (
            <p>{isActive ? "Working..." : "Idle"}</p>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1">
            {isActive ? (
              <Zap className="h-3 w-3" style={{ color: departmentColor }} />
            ) : (
              <Clock className="h-3 w-3" />
            )}
            <span>{isActive ? "Active" : "Idle"}</span>
          </div>
          <span className="font-mono">
            {agent.burnRatePerHour > 0
              ? `$${agent.burnRatePerHour.toFixed(2)}/hr`
              : "$0.00/hr"}
          </span>
        </div>
      </div>
    </div>
  );
}
