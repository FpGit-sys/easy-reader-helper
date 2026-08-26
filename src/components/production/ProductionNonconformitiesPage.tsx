import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
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
import { createProductionAction } from "@/server/operations/actions.functions";
import {
  listProductionNonconformities,
  updateProductionNonconformity,
} from "@/server/operations/nonconformities.functions";
import { listAssignableUsers } from "@/server/operations/people.functions";
import { listProductionSilos } from "@/server/operations/silos.functions";
import { can, type Role } from "@/server/rbac";

type Finding = Awaited<ReturnType<typeof listProductionNonconformities>>[number];
type Assignee = Awaited<ReturnType<typeof listAssignableUsers>>[number];

export function ProductionNonconformitiesPage() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [siloId, setSiloId] = useState("todos");
  const [actionFor, setActionFor] = useState<Finding | null>(null);

  const findingsQuery = useQuery({
    queryKey: ["production", "nonconformities", workspace?.organizationId, workspace?.facilityId],
    queryFn: () =>
      listProductionNonconformities({
        data: { organizationId: workspace!.organizationId, facilityId: workspace!.facilityId },
      }),
    enabled: Boolean(workspace),
  });
  const silosQuery = useQuery({
    queryKey: ["production", "silos", workspace?.organizationId, workspace?.facilityId],
    queryFn: () =>
      listProductionSilos({
        data: { organizationId: workspace!.organizationId, facilityId: workspace!.facilityId },
      }),
    enabled: Boolean(workspace),
  });
  const assigneesQuery = useQuery({
    queryKey: ["production", "assignees", workspace?.organizationId, workspace?.facilityId],
    queryFn: () =>
      listAssignableUsers({
        data: { organizationId: workspace!.organizationId, facilityId: workspace!.facilityId },
      }),
    enabled: Boolean(workspace),
  });

  const canWrite = workspace ? can(workspace.role as Role, "nonconformities.write") : false;
  const canCreateAction = workspace ? can(workspace.role as Role, "actions.write") : false;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (findingsQuery.data ?? []).filter((row) => {
      if (status !== "todos" && row.status !== status) return false;
      if (siloId !== "todos" && row.siloId !== siloId) return false;
      if (needle && !`${row.code} ${row.title} ${row.description}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [findingsQuery.data, search, siloId, status]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["production", "nonconformities"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "actions"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "dashboard"] }),
    ]);
  };

  const updateMutation = useMutation({
    mutationFn: (input: {
      nonconformityId: string;
      status?: "aberta" | "em_tratamento" | "resolvida" | "cancelada";
      responsibleUserId?: string | null;
      dueAt?: string | null;
    }) =>
      updateProductionNonconformity({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          ...input,
        },
      }),
    onSuccess: refresh,
    onError: (error) => {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("NONCONFORMITY_ACTION_REQUIRED")) {
        toast.error("Crie pelo menos uma ação corretiva antes de resolver esta pendência.");
      } else if (message.includes("NONCONFORMITY_OPEN_ACTIONS")) {
        toast.error("Conclua todas as ações corretivas vinculadas antes de resolver esta pendência.");
      } else {
        toast.error("Não foi possível atualizar a não conformidade.");
      }
    },
  });

  if (workspaceState.loading) return <Loading text="Carregando unidade…" />;
  if (workspaceState.error) return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  if (!workspace) return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e uma unidade para continuar." />;

  return (
    <div>
      <PageHeader
        title="Não conformidades"
        subtitle={`${workspace.facilityName} · pendências geradas por inspeções e verificações internas`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar código, título ou descrição" className="pl-8" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="aberta">Aberta</SelectItem>
            <SelectItem value="em_tratamento">Em tratamento</SelectItem>
            <SelectItem value="resolvida">Resolvida</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <Select value={siloId} onValueChange={setSiloId}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os silos</SelectItem>
            {(silosQuery.data ?? []).map((silo) => (
              <SelectItem key={silo.id} value={silo.id}>{silo.code} — {silo.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {findingsQuery.isLoading ? (
        <Loading text="Carregando não conformidades…" />
      ) : findingsQuery.error ? (
        <EmptyState title="Não foi possível carregar as pendências" description="Verifique sua conexão e permissões." />
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhuma pendência encontrada" description="Ajuste os filtros ou conclua uma inspeção com itens pendentes/críticos." />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-card">
          <table className="w-full table-dense">
            <thead className="bg-muted/70 text-left">
              <tr>
                <Th>Código / pendência</Th>
                <Th>Silo</Th>
                <Th>Criticidade</Th>
                <Th>Responsável</Th>
                <Th>Prazo</Th>
                <Th>Ações</Th>
                <Th>Status</Th>
                <Th>Tratativa</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border align-top">
                  <Td>
                    <p className="font-medium">{row.code}</p>
                    <p className="max-w-md text-sm">{row.title}</p>
                    <p className="mt-1 max-w-md text-xs text-muted-foreground">{row.description}</p>
                  </Td>
                  <Td>{row.siloName ? `${row.siloCode ?? ""} ${row.siloName}`.trim() : "—"}</Td>
                  <Td><StatusBadge status={row.severity} /></Td>
                  <Td>
                    {canWrite ? (
                      <Select
                        value={row.responsibleUserId ?? "sem-responsavel"}
                        onValueChange={(value) => {
                          updateMutation.mutate({ nonconformityId: row.id, responsibleUserId: value === "sem-responsavel" ? null : value });
                        }}
                      >
                        <SelectTrigger className="h-8 min-w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sem-responsavel">Sem responsável</SelectItem>
                          {(assigneesQuery.data ?? []).map((person) => (
                            <SelectItem key={person.id} value={person.id}>{assigneeLabel(person)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      assigneeName(assigneesQuery.data ?? [], row.responsibleUserId)
                    )}
                  </Td>
                  <Td>
                    {canWrite ? (
                      <Input
                        type="date"
                        className="h-8 w-40"
                        defaultValue={row.dueAt?.slice(0, 10) ?? ""}
                        onBlur={(event) => {
                          const value = event.currentTarget.value;
                          updateMutation.mutate({
                            nonconformityId: row.id,
                            dueAt: value ? new Date(`${value}T12:00:00.000Z`).toISOString() : null,
                          });
                        }}
                      />
                    ) : (
                      formatDate(row.dueAt)
                    )}
                    {row.overdue ? <p className="mt-1 text-xs font-medium text-destructive">Prazo vencido</p> : null}
                  </Td>
                  <Td>
                    <span className="font-medium">{row.actionCount}</span>
                    {row.openActionCount > 0 ? <p className="text-xs text-muted-foreground">{row.openActionCount} em aberto</p> : null}
                  </Td>
                  <Td><StatusBadge status={row.status} /></Td>
                  <Td>
                    <div className="flex min-w-52 flex-wrap gap-1.5">
                      {canCreateAction && row.status !== "resolvida" && row.status !== "cancelada" ? (
                        <Button size="sm" variant="outline" onClick={() => setActionFor(row)}>
                          <Plus className="size-3.5" aria-hidden="true" />
                          Criar ação
                        </Button>
                      ) : null}
                      {canWrite && row.status === "aberta" ? (
                        <Button size="sm" variant="ghost" onClick={() => updateMutation.mutate({ nonconformityId: row.id, status: "em_tratamento" })}>
                          Iniciar tratamento
                        </Button>
                      ) : null}
                      {canWrite && row.status === "em_tratamento" ? (
                        <Button size="sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ nonconformityId: row.id, status: "resolvida" })}>
                          <CheckCircle2 className="size-3.5" aria-hidden="true" />
                          Resolver
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {actionFor ? (
        <CreateActionDialog
          finding={actionFor}
          assignees={assigneesQuery.data ?? []}
          workspace={workspace}
          onClose={() => setActionFor(null)}
          onCreated={async () => {
            setActionFor(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateActionDialog({
  finding,
  assignees,
  workspace,
  onClose,
  onCreated,
}: {
  finding: Finding;
  assignees: Assignee[];
  workspace: NonNullable<ReturnType<typeof useWorkspace>["workspace"]>;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const initialAssignee = finding.responsibleUserId ?? assignees.find((person) => person.isCurrentUser)?.id ?? assignees[0]?.id ?? "";
  const [title, setTitle] = useState(`Tratar ${finding.code} — ${finding.title}`);
  const [responsibleUserId, setResponsibleUserId] = useState(initialAssignee);
  const [dueAt, setDueAt] = useState(finding.dueAt?.slice(0, 10) ?? "");
  const [priority, setPriority] = useState<"baixa" | "media" | "alta">(finding.severity);
  const [notes, setNotes] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      createProductionAction({
        data: {
          organizationId: workspace.organizationId,
          facilityId: workspace.facilityId,
          nonconformityId: finding.id,
          siloId: finding.siloId,
          title,
          responsibleUserId,
          dueAt: dueAt ? new Date(`${dueAt}T12:00:00.000Z`).toISOString() : null,
          priority,
          notes,
        },
      }),
    onSuccess: async (result) => {
      toast.success(`Ação ${result.code} criada e vinculada à pendência.`);
      await onCreated();
    },
    onError: () => toast.error("Não foi possível criar a ação corretiva."),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Criar ação corretiva</DialogTitle>
          <DialogDescription>{finding.code} · a pendência passará para “Em tratamento”.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="action-title">Ação</Label><Input id="action-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Responsável</Label>
              <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{assignees.map((person) => <SelectItem key={person.id} value={person.id}>{assigneeLabel(person)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="action-due">Prazo</Label><Input id="action-due" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></div>
          </div>
          <div>
            <Label>Prioridade</Label>
            <Select value={priority} onValueChange={(value) => setPriority(value as typeof priority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="alta">Alta</SelectItem><SelectItem value="media">Média</SelectItem><SelectItem value="baixa">Baixa</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label htmlFor="action-notes">Plano / observações</Label><Textarea id="action-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={mutation.isPending || title.trim().length < 2 || !responsibleUserId} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            Criar ação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function assigneeName(assignees: Assignee[], id: string | null) {
  if (!id) return "—";
  return assignees.find((person) => person.id === id)?.name ?? "Usuário da unidade";
}

function assigneeLabel(person: Assignee) {
  return `${person.name}${person.isCurrentUser ? " (você)" : ""}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 text-sm">{children}</td>;
}

function Loading({ text }: { text: string }) {
  return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{text}</div>;
}
