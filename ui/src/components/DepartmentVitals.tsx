import type { DepartmentVitals as VitalsData } from "@paperclipai/shared";
import { cn } from "@/lib/utils";
import { formatCents } from "../lib/utils";
import { Activity, DollarSign, TrendingUp, Wifi, WifiOff } from "lucide-react";

interface DepartmentVitalsViewProps {
  vitals: VitalsData | null;
  departmentColor: string;
}

export function DepartmentVitalsView({ vitals, departmentColor }: DepartmentVitalsViewProps) {
  if (!vitals) {
    return (
      <div className="rounded-xl border border-border border-dashed p-8 text-center">
        <Activity className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No vitals data available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Key metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <VitalCard
          label="Signals Today"
          value={vitals.signalsToday.toString()}
          color={departmentColor}
        />
        <VitalCard
          label="Conversion"
          value={`${vitals.conversionRate}%`}
          color={vitals.conversionRate >= 15 ? "#10b981" : vitals.conversionRate >= 5 ? "#f59e0b" : "#ef4444"}
        />
        <VitalCard
          label="Avg Response"
          value={`${vitals.avgResponseMinutes}m`}
          color={vitals.avgResponseMinutes <= 5 ? "#10b981" : vitals.avgResponseMinutes <= 15 ? "#f59e0b" : "#ef4444"}
        />
        <VitalCard
          label="Cost/Signal"
          value={formatCents(vitals.costPerSignalCents)}
          color="#6366f1"
        />
      </div>

      {/* Budget bar */}
      {vitals.budgetTotalCents > 0 && (
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Budget</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {formatCents(vitals.budgetUsedCents)} of {formatCents(vitals.budgetTotalCents)} (
              {vitals.budgetUtilizationPercent}%)
            </span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(vitals.budgetUtilizationPercent, 100)}%`,
                backgroundColor:
                  vitals.budgetUtilizationPercent >= 85
                    ? "#ef4444"
                    : vitals.budgetUtilizationPercent >= 60
                      ? "#f59e0b"
                      : "#10b981",
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
            <span>
              Burn rate: {(vitals.burnRatePerHourCents / 100).toFixed(2)}/hr
            </span>
            <span>
              Est. {vitals.burnRatePerHourCents > 0
                ? `${Math.round(((vitals.budgetTotalCents - vitals.budgetUsedCents) / vitals.burnRatePerHourCents) / 24)}d remaining`
                : "unlimited"}
            </span>
          </div>
        </div>
      )}

      {/* Channel health */}
      {vitals.channelHealth.length > 0 && (
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wifi className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Channels</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {vitals.channelHealth.map((channel) => (
              <div
                key={channel.channelType}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border",
                  channel.status === "active"
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-border bg-muted/30",
                )}
              >
                {channel.status === "active" ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
                ) : (
                  <WifiOff className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="font-medium">{channel.label}</span>
                {channel.eventsToday > 0 && (
                  <span className="text-muted-foreground">{channel.eventsToday} today</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          <span>
            Signal volume:{" "}
            <span
              className={cn(
                "font-medium",
                vitals.trend.signalVolumeChangePercent > 0
                  ? "text-emerald-500"
                  : vitals.trend.signalVolumeChangePercent < 0
                    ? "text-red-500"
                    : "",
              )}
            >
              {vitals.trend.signalVolumeChangePercent > 0 ? "+" : ""}
              {vitals.trend.signalVolumeChangePercent}% this week
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function VitalCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  );
}
