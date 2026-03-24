import type {
  Department,
  DepartmentWithMembers,
  DepartmentCrewAgent,
  DepartmentProcessor,
  DepartmentVitals,
  SignalTransformation,
} from "@paperclipai/shared";
import { api } from "./client";

export const departmentsApi = {
  list: (companyId: string) =>
    api.get<Department[]>(`/companies/${companyId}/departments`),

  get: (id: string) =>
    api.get<DepartmentWithMembers>(`/departments/${id}`),

  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Department>(`/companies/${companyId}/departments`, data),

  update: (id: string, data: Record<string, unknown>) =>
    api.patch<Department>(`/departments/${id}`, data),

  remove: (id: string) =>
    api.delete<Department>(`/departments/${id}`),

  addMember: (departmentId: string, data: { agentId: string; role?: string }) =>
    api.post<{ ok: boolean }>(`/departments/${departmentId}/members`, data),

  removeMember: (departmentId: string, agentId: string) =>
    api.delete<{ ok: boolean }>(`/departments/${departmentId}/members/${agentId}`),

  crew: (id: string) =>
    api.get<DepartmentCrewAgent[]>(`/departments/${id}/crew`),

  processor: (id: string) =>
    api.get<DepartmentProcessor>(`/departments/${id}/processor`),

  vitals: (id: string) =>
    api.get<DepartmentVitals>(`/departments/${id}/vitals`),

  signalDetail: (departmentId: string, signalId: string) =>
    api.get<SignalTransformation>(`/departments/${departmentId}/signals/${signalId}`),
};
