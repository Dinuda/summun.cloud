import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { knowledgeApi } from "../api/knowledge";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "@/lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_KIND_LABELS,
  KNOWLEDGE_KIND_COLORS,
  type KnowledgeKind,
} from "@paperclipai/shared";
import {
  BookOpen,
  Search,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Loader2,
  X,
} from "lucide-react";

export function Knowledge() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filterKind, setFilterKind] = useState<string>("");
  const [filterScope, setFilterScope] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Knowledge" }]);
  }, [setBreadcrumbs]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: results, isLoading } = useQuery({
    queryKey: queryKeys.knowledge.list(selectedCompanyId!, {
      q: debouncedQuery || undefined,
      kind: filterKind || undefined,
      scope: filterScope || undefined,
    }),
    queryFn: () =>
      knowledgeApi.list(selectedCompanyId!, {
        q: debouncedQuery || undefined,
        kind: filterKind || undefined,
        scope: filterScope || undefined,
      }),
    enabled: !!selectedCompanyId,
  });

  const { data: stats } = useQuery({
    queryKey: queryKeys.knowledge.stats(selectedCompanyId!),
    queryFn: () => knowledgeApi.stats(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const ingestMutation = useMutation({
    mutationFn: () => knowledgeApi.ingest(selectedCompanyId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.stats(selectedCompanyId!) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: string) => knowledgeApi.remove(entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.stats(selectedCompanyId!) });
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={BookOpen} message="Select a company to view knowledge." />;
  }

  const entries = results?.entries ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Knowledge Center</h1>
          {stats && stats.totalEntries > 0 && (
            <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
              {stats.totalEntries} entries
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => ingestMutation.mutate()}
            disabled={ingestMutation.isPending}
          >
            {ingestMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Sync
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Entry
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search knowledge..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
        <Select value={filterKind || "all"} onValueChange={(v) => setFilterKind(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {KNOWLEDGE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {KNOWLEDGE_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterScope || "all"} onValueChange={(v) => setFilterScope(v === "all" ? "" : v)}>
          <SelectTrigger className="w-32 h-9">
            <SelectValue placeholder="All Scopes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Scopes</SelectItem>
            <SelectItem value="project">Project</SelectItem>
            <SelectItem value="org">Org-wide</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats strip */}
      {stats && stats.totalEntries > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(stats.byKind)
            .filter(([, count]) => count > 0)
            .sort(([, a], [, b]) => b - a)
            .map(([kind, count]) => (
              <button
                key={kind}
                onClick={() => setFilterKind(filterKind === kind ? "" : kind)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-colors",
                  filterKind === kind
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:bg-accent/30",
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: KNOWLEDGE_KIND_COLORS[kind as KnowledgeKind] ?? "#64748b" }}
                />
                <span className="font-medium">{KNOWLEDGE_KIND_LABELS[kind as KnowledgeKind] ?? kind}</span>
                <span className="text-muted-foreground">{count}</span>
              </button>
            ))}
        </div>
      )}

      {/* Create form */}
      {showCreate && selectedCompanyId && (
        <CreateKnowledgeForm
          companyId={selectedCompanyId}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Entries list */}
      {isLoading && entries.length === 0 ? (
        <PageSkeleton variant="list" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          message={
            debouncedQuery
              ? "No matching knowledge entries."
              : "No knowledge entries yet. Click Sync to ingest from agent activity, or create a manual entry."
          }
        />
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <KnowledgeEntryRow
              key={entry.id}
              entry={entry}
              onDelete={() => deleteMutation.mutate(entry.id)}
              isDeleting={deleteMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KnowledgeEntryRow({
  entry,
  onDelete,
  isDeleting,
}: {
  entry: {
    id: string;
    title: string;
    summary: string | null;
    snippet: string;
    scope: string;
    kind: string;
    tags: string[];
    sourceType: string;
    sourceEntity: string | null;
    projectId: string | null;
    createdAt: string;
  };
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const kindColor = KNOWLEDGE_KIND_COLORS[entry.kind as KnowledgeKind] ?? "#64748b";
  const kindLabel = KNOWLEDGE_KIND_LABELS[entry.kind as KnowledgeKind] ?? entry.kind;

  return (
    <div className="rounded-xl border border-border p-4 hover:bg-accent/20 transition-colors group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: kindColor }}
            />
            <h3 className="text-sm font-medium truncate">{entry.title}</h3>
          </div>
          <p
            className="text-xs text-muted-foreground leading-relaxed"
            dangerouslySetInnerHTML={{ __html: entry.snippet }}
          />
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span
              className="font-medium"
              style={{ color: kindColor }}
            >
              {kindLabel}
            </span>
            <span>·</span>
            <span className="capitalize">{entry.scope}</span>
            {entry.sourceEntity && (
              <>
                <span>·</span>
                <span className="font-mono">{entry.sourceEntity}</span>
              </>
            )}
            <span>·</span>
            <span>{timeAgo(entry.createdAt)}</span>
            {entry.tags.length > 0 && (
              <>
                <span>·</span>
                {entry.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="bg-muted px-1.5 py-0.5 rounded text-[10px]"
                  >
                    {tag}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={onDelete}
          disabled={isDeleting}
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function CreateKnowledgeForm({
  companyId,
  onClose,
}: {
  companyId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState("org");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => knowledgeApi.create(companyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.stats(companyId) });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to create"),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError("Title and body are required");
      return;
    }
    createMutation.mutate({ title: title.trim(), body: body.trim(), scope });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border p-4 space-y-4">
      <h4 className="text-sm font-medium">New Knowledge Entry</h4>
      {error && (
        <div className="rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">{error}</div>
      )}
      <Input
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-8 text-sm"
      />
      <div className="flex gap-3">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-32 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="project">Project</SelectItem>
            <SelectItem value="org">Org-wide</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <textarea
        placeholder="Knowledge content..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring min-h-[120px] resize-y"
      />
      <div className="flex items-center gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={createMutation.isPending}>
          {createMutation.isPending ? "Creating..." : "Create"}
        </Button>
      </div>
    </form>
  );
}
