import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { departmentsApi } from "../api/departments";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEPARTMENT_TEMPLATES } from "@paperclipai/shared";
import type { Department, DepartmentWithMembers } from "@paperclipai/shared";
import { Plus, Trash2, Users, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function DepartmentManager() {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedDeptId, setExpandedDeptId] = useState<string | null>(null);

  const { data: departments } = useQuery({
    queryKey: queryKeys.departments.list(selectedCompanyId!),
    queryFn: () => departmentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => departmentsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.departments.list(selectedCompanyId!) });
    },
  });

  const depts = departments ?? [];
  const allAgents = agents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Departments</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Organize agents into departments that reflect your company structure.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Department
        </Button>
      </div>

      {showCreate && (
        <CreateDepartmentForm
          companyId={selectedCompanyId!}
          onCancel={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: queryKeys.departments.list(selectedCompanyId!) });
          }}
        />
      )}

      {depts.length === 0 && !showCreate && (
        <div className="rounded-xl border border-border border-dashed p-8 text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No departments yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create departments to organize your agents into teams.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {depts.map((dept) => (
          <DepartmentRow
            key={dept.id}
            department={dept}
            isExpanded={expandedDeptId === dept.id}
            onToggle={() => setExpandedDeptId(expandedDeptId === dept.id ? null : dept.id)}
            allAgents={allAgents}
            onDelete={() => deleteMutation.mutate(dept.id)}
            companyId={selectedCompanyId!}
          />
        ))}
      </div>
    </div>
  );
}

function CreateDepartmentForm({
  companyId,
  onCancel,
  onCreated,
}: {
  companyId: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [templateType, setTemplateType] = useState("custom");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => departmentsApi.create(companyId, data),
    onSuccess: () => onCreated(),
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to create department"),
  });

  const selectedTemplate = DEPARTMENT_TEMPLATES.find((t) => t.type === templateType);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      templateType,
      icon: selectedTemplate?.icon ?? "building2",
      color: selectedTemplate?.color ?? "#6366f1",
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border p-4 space-y-4">
      <h4 className="text-sm font-medium">Create Department</h4>

      {error && (
        <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">{error}</div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="dept-name" className="text-xs">Name</Label>
        <Input
          id="dept-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Customer Sales"
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dept-template" className="text-xs">Template</Label>
        <Select value={templateType} onValueChange={setTemplateType}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="custom">Custom</SelectItem>
            {DEPARTMENT_TEMPLATES.map((t) => (
              <SelectItem key={t.type} value={t.type}>
                {t.name} — {t.description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedTemplate && (
        <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
          <p className="font-medium mb-1">This template includes:</p>
          <ul className="space-y-0.5">
            {selectedTemplate.defaultStages.map((s) => (
              <li key={s.id}>• {s.label}: {s.description}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={createMutation.isPending}>
          {createMutation.isPending ? "Creating..." : "Create"}
        </Button>
      </div>
    </form>
  );
}

function DepartmentRow({
  department,
  isExpanded,
  onToggle,
  allAgents,
  onDelete,
  companyId,
}: {
  department: Department;
  isExpanded: boolean;
  allAgents: Array<{ id: string; name: string; role: string; status: string }>;
  onDelete: () => void;
  onToggle: () => void;
  companyId: string;
}) {
  const queryClient = useQueryClient();

  const { data: detail } = useQuery({
    queryKey: queryKeys.departments.detail(department.id),
    queryFn: () => departmentsApi.get(department.id),
    enabled: isExpanded,
  });

  const addMemberMutation = useMutation({
    mutationFn: (agentId: string) =>
      departmentsApi.addMember(department.id, { agentId, role: "member" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.departments.detail(department.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.departments.list(companyId) });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (agentId: string) =>
      departmentsApi.removeMember(department.id, agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.departments.detail(department.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.departments.list(companyId) });
    },
  });

  const memberIds = new Set((detail?.members ?? []).map((m) => m.agentId));
  const unassignedAgents = allAgents.filter((a) => !memberIds.has(a.id));

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left"
      >
        <span
          className="h-6 w-6 rounded-md flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ backgroundColor: department.color }}
        >
          {department.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{department.name}</p>
          <p className="text-xs text-muted-foreground">
            {department.templateType} • {detail?.members?.length ?? 0} agents
          </p>
        </div>
        <ChevronRight
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            isExpanded && "rotate-90",
          )}
        />
      </button>

      {isExpanded && (
        <div className="border-t border-border p-4 space-y-3">
          {/* Current members */}
          {(detail?.members ?? []).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground mb-2">Members</p>
              {(detail?.members ?? []).map((member) => {
                const agent = allAgents.find((a) => a.id === member.agentId);
                return (
                  <div
                    key={member.agentId}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{agent?.name ?? member.agentId.slice(0, 8)}</span>
                      <span className="text-[10px] text-muted-foreground uppercase font-medium">
                        {member.role}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeMemberMutation.mutate(member.agentId)}
                      disabled={removeMemberMutation.isPending}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add unassigned agents */}
          {unassignedAgents.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground mb-2">Add Agent</p>
              <div className="flex flex-wrap gap-1.5">
                {unassignedAgents.map((agent) => (
                  <Button
                    key={agent.id}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => addMemberMutation.mutate(agent.id)}
                    disabled={addMemberMutation.isPending}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {agent.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Delete department */}
          <div className="pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive h-7 text-xs"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3 mr-1.5" />
              Delete Department
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
