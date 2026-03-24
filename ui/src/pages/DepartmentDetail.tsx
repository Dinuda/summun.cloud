import { useEffect, useMemo } from "react";
import { useParams, Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { departmentsApi } from "../api/departments";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { DepartmentCrew } from "../components/DepartmentCrew";
import { DepartmentProcessor } from "../components/DepartmentProcessor";
import { DepartmentVitalsView } from "../components/DepartmentVitals";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Building2, Settings } from "lucide-react";

export function DepartmentDetail() {
  const { departmentId } = useParams<{ departmentId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  const { data: department, isLoading: isDeptLoading } = useQuery({
    queryKey: queryKeys.departments.detail(departmentId!),
    queryFn: () => departmentsApi.get(departmentId!),
    enabled: !!departmentId,
  });

  const { data: crew, isLoading: isCrewLoading } = useQuery({
    queryKey: queryKeys.departments.crew(departmentId!),
    queryFn: () => departmentsApi.crew(departmentId!),
    enabled: !!departmentId,
  });

  const { data: processor, isLoading: isProcessorLoading } = useQuery({
    queryKey: queryKeys.departments.processor(departmentId!),
    queryFn: () => departmentsApi.processor(departmentId!),
    enabled: !!departmentId,
  });

  const { data: vitals, isLoading: isVitalsLoading } = useQuery({
    queryKey: queryKeys.departments.vitals(departmentId!),
    queryFn: () => departmentsApi.vitals(departmentId!),
    enabled: !!departmentId,
  });

  useEffect(() => {
    if (department) {
      setBreadcrumbs([
        { label: department.name },
      ]);
    }
  }, [department?.name, setBreadcrumbs]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Building2} message="Select a company to view departments." />;
  }

  if (!departmentId) {
    return <EmptyState icon={Building2} message="No department selected." />;
  }

  const isLoading = isDeptLoading || isCrewLoading || isProcessorLoading || isVitalsLoading;

  if (isLoading && !department) {
    return <PageSkeleton variant="detail" />;
  }

  if (!department) {
    return <EmptyState icon={Building2} message="Department not found." />;
  }

  const headAgent = department.headAgent;
  const memberCount = department.members?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Department Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
              style={{ backgroundColor: department.color }}
            >
              {department.name.charAt(0).toUpperCase()}
            </div>
            <h1 className="text-xl font-bold">{department.name}</h1>
            <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
              {department.templateType}
            </span>
          </div>
          {department.description && (
            <p className="text-sm text-muted-foreground pl-11">{department.description}</p>
          )}
          <div className="flex items-center gap-4 pl-11 text-xs text-muted-foreground">
            {headAgent && (
              <span>
                Head: <span className="font-medium text-foreground">{headAgent.name}</span>
              </span>
            )}
            <span>
              {memberCount} {memberCount === 1 ? "agent" : "agents"}
            </span>
            {department.budgetMonthlyCents > 0 && (
              <span>
                Budget: ${(department.budgetMonthlyCents / 100).toFixed(0)}/mo
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/company/settings">
            <Settings className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <Separator />

      {/* Crew Section */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Crew
        </h2>
        <DepartmentCrew agents={crew ?? []} departmentColor={department.color} />
      </section>

      <Separator />

      {/* Processor Section */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Processor
        </h2>
        <DepartmentProcessor
          processor={processor ?? null}
          departmentColor={department.color}
          departmentId={departmentId}
        />
      </section>

      <Separator />

      {/* Vitals Section */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Vitals
        </h2>
        <DepartmentVitalsView vitals={vitals ?? null} departmentColor={department.color} />
      </section>
    </div>
  );
}
