import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Loader2, Paperclip, Plus, Search, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/workspace";
import {
  completeProductionAction,
  createProductionAction,
  getProductionActionEvidenceDownload,
  listProductionActionEvidence,
  listProductionActions,
  updateProductionAction,
} from "@/server/operations/actions.functions";
import { listAssignableUsers } from "@/server/operations/people.functions";
import { listProductionSilos } from "@/server/operations/silos.functions";
import { can, type Role } from "@/server/rbac";

type ActionRow = Awaited<ReturnType<typeof listProductionActions>>[number];
type Assignee = Awaited<ReturnType<typeof listAssignableUsers>>[number];
type Silo = Awaited<ReturnType<typeof listProductionSilos>>[number];

type EditableStatus = "nao_iniciada" | "em_andamento" | "aguardando_evidencia" | "cancelada";

export function ProductionActionsPage() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("abertas");
  const [selected, setSelected] = useState<ActionRow | null>(null);
  const [creating, setCreating] = useState(false);

  const actionsQuery = useQuery({
    queryKey: ["production", "actions", workspace?.organizationId, workspace?.facilityId],
    queryFn: () => listProductionActions({ data: { organizationId: workspace!.organizationId, facilityId: workspace!.facilityId } }),
    enabled: Boolean(workspace),
  });
  const assigneesQuery = useQuery({
    queryKey: ["production", "assignees", workspace?.organizationId, workspace?.facilityId],
    queryFn: () => listAssignableUsers({ data: { organizationId: workspace!.organizationId, facilityId: workspace!.facilityId } }),
    enabled: Boolean(workspace),
  });
  const silosQuery = useQuery({
    queryKey: ["production", "silos", workspace?.organizationId, workspace?.facilityId],
    queryFn: () => listProductionSilos({ data: { organizationId: workspace!.organizationId, facilityId: workspace!.facilityId } }),
    enabled: Boolean(workspace),
  });

  const canWrite = workspace ? can(workspace.role as Role, "actions.write") : false;
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (actionsQuery.data ?? []).filter((row) => {
      if (filter === "abertas" && (row.status === "concluida" || row.status === "cancelada")) return false;
      if (filter === "atrasadas" && !row.overdue) return false;
      if (filter === "concluidas" && row.status !== "concluida") return false;
      if (needle && !`${row.code} ${row.title} ${row.nonconformityCode ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [actionsQuery.data, filter, search]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["production", "actions"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "action-evidence"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "nonconformities"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "silos"] }),
    ]);
  };

  if (workspaceState.loading) return <Loading text="Carregando unidade…" />;
  if (workspaceState.error) return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  if (!workspace) return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e uma unidade para continuar." />;

  return (
    <div>
      <PageHeader
        title="Ações corretivas"
        subtitle={`${workspace.facilityName} · responsáveis, prazos, evidências e encerramento rastreável`}
        actions={canWrite ? <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />Nova ação</Button> : undefined}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar código, ação ou pendência" className="pl-8" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="abertas">Em aberto</SelectItem>
            <SelectItem value="atrasadas">Atrasadas</SelectItem>
            <SelectItem value="concluidas">Concluídas</SelectItem>
            <SelectItem value="todas">Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {actionsQuery.isLoading ? (
        <Loading text="Carregando ações…" />
      ) : actionsQuery.error ? (
        <EmptyState title="Não foi possível carregar as ações" description="Verifique sua conexão e permissões." />
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhuma ação encontrada" description="Crie uma ação manualmente ou a partir de uma não conformidade." action={canWrite ? <Button onClick={() => setCreating(true)}>Nova ação</Button> : undefined} />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-card">
          <table className="w-full table-dense">
            <thead className="bg-muted/70 text-left"><tr><Th>Código / ação</Th><Th>Origem</Th><Th>Silo</Th><Th>Responsável</Th><Th>Prazo</Th><Th>Prioridade</Th><Th>Evidências</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <Td><p className="font-medium">{row.code}</p><p className="max-w-sm">{row.title}</p></Td>
                  <Td>{row.nonconformityCode ? <><p className="font-medium">{row.nonconformityCode}</p><p className="max-w-56 text-xs text-muted-foreground">{row.nonconformityTitle}</p></> : "Manual"}</Td>
                  <Td>{row.siloName ? `${row.siloCode ?? ""} ${row.siloName}`.trim() : "—"}</Td>
                  <Td>{assigneeName(assigneesQuery.data ?? [], row.responsibleUserId)}</Td>
                  <Td>{formatDate(row.dueAt)}{row.overdue ? <p className="text-xs font-medium text-destructive">Prazo vencido</p> : null}</Td>
                  <Td><StatusBadge status={row.priority} /></Td>
                  <Td><span className="inline-flex items-center gap-1"><Paperclip className="size-3.5" aria-hidden="true" />{row.evidenceCount}</span></Td>
                  <Td><StatusBadge status={row.status} /></Td>
                  <Td><Button size="sm" variant="outline" onClick={() => setSelected(row)}>Abrir</Button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating ? <CreateManualActionDialog workspace={workspace} assignees={assigneesQuery.data ?? []} silos={silosQuery.data ?? []} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await refresh(); }} /> : null}
      {selected ? <ActionDialog key={`${selected.id}-${selected.updatedAt}`} action={selected} workspace={workspace} assignees={assigneesQuery.data ?? []} canWrite={canWrite} onClose={() => setSelected(null)} onChanged={async () => { await refresh(); const latest = (await listProductionActions({ data: { organizationId: workspace.organizationId, facilityId: workspace.facilityId } })).find((item) => item.id === selected.id); setSelected(latest ?? null); }} /> : null}
    </div>
  );
}

function CreateManualActionDialog({ workspace, assignees, silos, onClose, onCreated }: { workspace: NonNullable<ReturnType<typeof useWorkspace>["workspace"]>; assignees: Assignee[]; silos: Silo[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState(assignees.find((person) => person.isCurrentUser)?.id ?? assignees[0]?.id ?? "");
  const [siloId, setSiloId] = useState("sem-silo");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<"baixa" | "media" | "alta">("media");
  const [notes, setNotes] = useState("");
  const mutation = useMutation({
    mutationFn: () => createProductionAction({ data: { organizationId: workspace.organizationId, facilityId: workspace.facilityId, nonconformityId: null, siloId: siloId === "sem-silo" ? null : siloId, title, responsibleUserId, dueAt: dueAt ? new Date(`${dueAt}T12:00:00.000Z`).toISOString() : null, priority, notes } }),
    onSuccess: async (result) => { toast.success(`Ação ${result.code} criada.`); await onCreated(); },
    onError: () => toast.error("Não foi possível criar a ação."),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Nova ação corretiva</DialogTitle><DialogDescription>Use ações manuais para tratativas que não nasceram de uma inspeção.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="manual-title">Ação</Label><Input id="manual-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Responsável</Label><Select value={responsibleUserId} onValueChange={setResponsibleUserId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{assignees.map((person) => <SelectItem key={person.id} value={person.id}>{assigneeLabel(person)}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Silo</Label><Select value={siloId} onValueChange={setSiloId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sem-silo">Unidade / sem silo</SelectItem>{silos.map((silo) => <SelectItem key={silo.id} value={silo.id}>{silo.code} — {silo.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="manual-due">Prazo</Label><Input id="manual-due" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></div>
            <div><Label>Prioridade</Label><Select value={priority} onValueChange={(value) => setPriority(value as typeof priority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="alta">Alta</SelectItem><SelectItem value="media">Média</SelectItem><SelectItem value="baixa">Baixa</SelectItem></SelectContent></Select></div>
          </div>
          <div><Label htmlFor="manual-notes">Plano / observações</Label><Textarea id="manual-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={mutation.isPending || title.trim().length < 2 || !responsibleUserId} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}Criar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionDialog({ action, workspace, assignees, canWrite, onClose, onChanged }: { action: ActionRow; workspace: NonNullable<ReturnType<typeof useWorkspace>["workspace"]>; assignees: Assignee[]; canWrite: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [responsibleUserId, setResponsibleUserId] = useState(action.responsibleUserId ?? assignees.find((person) => person.isCurrentUser)?.id ?? "");
  const [dueAt, setDueAt] = useState(action.dueAt?.slice(0, 10) ?? "");
  const [priority, setPriority] = useState(action.priority);
  const [notes, setNotes] = useState(action.notes);
  const [uploading, setUploading] = useState(false);

  const evidenceQuery = useQuery({
    queryKey: ["production", "action-evidence", workspace.organizationId, workspace.facilityId, action.id],
    queryFn: () => listProductionActionEvidence({ data: { organizationId: workspace.organizationId, facilityId: workspace.facilityId, actionId: action.id } }),
  });

  const updateMutation = useMutation({
    mutationFn: (status?: EditableStatus) => updateProductionAction({ data: { organizationId: workspace.organizationId, facilityId: workspace.facilityId, actionId: action.id, responsibleUserId, dueAt: dueAt ? new Date(`${dueAt}T12:00:00.000Z`).toISOString() : null, priority, notes, ...(status ? { status } : {}) } }),
    onSuccess: async () => { toast.success("Ação atualizada."); await onChanged(); },
    onError: () => toast.error("Não foi possível atualizar a ação."),
  });
  const completeMutation = useMutation({
    mutationFn: () => completeProductionAction({ data: { organizationId: workspace.organizationId, facilityId: workspace.facilityId, actionId: action.id } }),
    onSuccess: async () => { toast.success("Ação concluída com evidência registrada."); await onChanged(); },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("ACTION_COMPLETION_EVIDENCE_REQUIRED")) toast.error("Anexe pelo menos uma evidência antes de concluir a ação.");
      else toast.error("Não foi possível concluir a ação.");
    },
  });

  const uploadEvidence = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("organizationId", workspace.organizationId);
      form.set("facilityId", workspace.facilityId);
      form.set("actionId", action.id);
      form.set("description", `Evidência de conclusão da ação ${action.code}.`);
      form.set("file", file);
      const response = await fetch("/api/actions/evidence-upload", { method: "POST", body: form, credentials: "include" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "ACTION_EVIDENCE_UPLOAD_FAILED");
      toast.success("Evidência anexada.");
      await evidenceQuery.refetch();
      await onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "FILE_TYPE_NOT_ALLOWED") toast.error("Use PDF, JPG, PNG ou WebP.");
      else if (message === "FILE_SIZE_NOT_ALLOWED") toast.error("O arquivo excede o limite permitido.");
      else toast.error("Não foi possível enviar a evidência.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadEvidence = async (evidenceId: string) => {
    try {
      const result = await getProductionActionEvidenceDownload({ data: { organizationId: workspace.organizationId, facilityId: workspace.facilityId, actionId: action.id, evidenceId } });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Não foi possível abrir a evidência.");
    }
  };

  const editable = canWrite && action.status !== "cancelada";
  const busy = updateMutation.isPending || completeMutation.isPending || uploading;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{action.code} — {action.title}</DialogTitle><DialogDescription>{action.nonconformityCode ? `Vinculada à ${action.nonconformityCode}` : "Ação manual"}{action.siloName ? ` · ${action.siloCode ?? ""} ${action.siloName}` : ""}</DialogDescription></DialogHeader>
        <div className="grid gap-3 rounded border border-border bg-muted/20 p-3 sm:grid-cols-3">
          <div><p className="text-xs text-muted-foreground">Status</p><StatusBadge status={action.status} /></div>
          <div><p className="text-xs text-muted-foreground">Prioridade</p><StatusBadge status={action.priority} /></div>
          <div><p className="text-xs text-muted-foreground">Conclusão</p><p className="text-sm font-medium">{formatDateTime(action.completedAt)}</p></div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Responsável</Label><Select disabled={!editable || action.status === "concluida"} value={responsibleUserId} onValueChange={setResponsibleUserId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{assignees.map((person) => <SelectItem key={person.id} value={person.id}>{assigneeLabel(person)}</SelectItem>)}</SelectContent></Select></div>
          <div><Label htmlFor="detail-due">Prazo</Label><Input id="detail-due" disabled={!editable || action.status === "concluida"} type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></div>
          <div><Label>Prioridade</Label><Select disabled={!editable || action.status === "concluida"} value={priority} onValueChange={(value) => setPriority(value as typeof priority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="alta">Alta</SelectItem><SelectItem value="media">Média</SelectItem><SelectItem value="baixa">Baixa</SelectItem></SelectContent></Select></div>
          <div><Label>Status operacional</Label><Select disabled={!editable || action.status === "concluida"} value={action.status === "concluida" ? "concluida" : action.status} onValueChange={(value) => updateMutation.mutate(value as EditableStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{action.status === "concluida" ? <SelectItem value="concluida">Concluída</SelectItem> : null}<SelectItem value="nao_iniciada">Não iniciada</SelectItem><SelectItem value="em_andamento">Em andamento</SelectItem><SelectItem value="aguardando_evidencia">Aguardando evidência</SelectItem><SelectItem value="cancelada">Cancelada</SelectItem></SelectContent></Select></div>
        </div>
        <div><Label htmlFor="detail-notes">Plano / observações</Label><Textarea id="detail-notes" disabled={!editable || action.status === "concluida"} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
        {editable && action.status !== "concluida" ? <Button variant="outline" disabled={busy} onClick={() => updateMutation.mutate()}><CheckCircle2 className="size-4" />Salvar dados</Button> : null}

        <section className="space-y-2 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Evidências da conclusão</h3><p className="text-xs text-muted-foreground">É obrigatória ao menos uma evidência para concluir a ação.</p></div>{editable && action.status !== "concluida" ? <><input ref={fileRef} className="hidden" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadEvidence(file); }} /><Button variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}Anexar evidência</Button></> : null}</div>
          {evidenceQuery.isLoading ? <Loading text="Carregando evidências…" /> : (evidenceQuery.data ?? []).length === 0 ? <p className="rounded border border-dashed border-border p-3 text-sm text-muted-foreground">Nenhuma evidência anexada.</p> : <div className="space-y-2">{(evidenceQuery.data ?? []).map((evidence) => <div key={evidence.id} className="flex flex-wrap items-center gap-3 rounded border border-border p-3"><Paperclip className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{evidence.name}</p><p className="text-xs text-muted-foreground">{formatBytes(evidence.sizeBytes)} · {formatDateTime(evidence.capturedAt)}{evidence.sha256 ? ` · SHA-256 ${evidence.sha256.slice(0, 12)}…` : ""}</p></div><Button size="sm" variant="outline" onClick={() => void downloadEvidence(evidence.id)}><Download className="size-3.5" />Abrir</Button></div>)}</div>}
        </section>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>{canWrite && action.status === "concluida" ? <Button variant="outline" disabled={busy} onClick={() => updateMutation.mutate("em_andamento")}>Reabrir ação</Button> : null}</div>
          <div className="flex gap-2"><Button variant="outline" onClick={onClose}>Fechar</Button>{editable && action.status !== "concluida" && action.status !== "cancelada" ? <Button disabled={busy || (evidenceQuery.data?.length ?? 0) < 1} onClick={() => completeMutation.mutate()}>{completeMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Concluir com evidência</Button> : null}</div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function assigneeName(assignees: Assignee[], id: string | null) { if (!id) return "—"; return assignees.find((person) => person.id === id)?.name ?? "Usuário da unidade"; }
function assigneeLabel(person: Assignee) { return `${person.name}${person.isCurrentUser ? " (você)" : ""}`; }
function formatDate(value: string | null) { if (!value) return "—"; return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value)); }
function formatDateTime(value: string | null) { if (!value) return "—"; return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function formatBytes(value: number | null) { if (!value) return "—"; if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB`; }
function Th({ children }: { children: React.ReactNode }) { return <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-3 py-2 text-sm">{children}</td>; }
function Loading({ text }: { text: string }) { return <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{text}</div>; }
