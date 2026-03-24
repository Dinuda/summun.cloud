import { useState } from "react";
import { NavLink, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { departmentsApi } from "../api/departments";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Department } from "@paperclipai/shared";

function DepartmentItem({
  department,
  isActive,
  isMobile,
  setSidebarOpen,
}: {
  department: Department;
  isActive: boolean;
  isMobile: boolean;
  setSidebarOpen: (open: boolean) => void;
}) {
  return (
    <NavLink
      to={`/departments/${department.id}`}
      onClick={() => {
        if (isMobile) setSidebarOpen(false);
      }}
      className={cn(
        "flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium transition-colors",
        isActive
          ? "bg-accent text-foreground"
          : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <span
        className="shrink-0 h-3.5 w-3.5 rounded-sm"
        style={{ backgroundColor: department.color }}
      />
      <span className="flex-1 truncate">{department.name}</span>
    </NavLink>
  );
}

export function SidebarDepartments() {
  const [open, setOpen] = useState(true);
  const { selectedCompanyId } = useCompany();
  const { isMobile, setSidebarOpen } = useSidebar();
  const location = useLocation();

  const { data: departments } = useQuery({
    queryKey: queryKeys.departments.list(selectedCompanyId!),
    queryFn: () => departmentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const deptMatch = location.pathname.match(/^\/(?:[^/]+\/)?departments\/([^/]+)/);
  const activeDeptId = deptMatch?.[1] ?? null;

  const depts = departments ?? [];

  if (depts.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className="flex items-center px-3 py-1.5">
          <CollapsibleTrigger className="flex items-center gap-1 flex-1 min-w-0">
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground/60 transition-transform opacity-0 group-hover:opacity-100",
                open && "rotate-90",
              )}
            />
            <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
              Departments
            </span>
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 mt-0.5">
          {depts.map((dept) => (
            <DepartmentItem
              key={dept.id}
              department={dept}
              isActive={activeDeptId === dept.id}
              isMobile={isMobile}
              setSidebarOpen={setSidebarOpen}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
