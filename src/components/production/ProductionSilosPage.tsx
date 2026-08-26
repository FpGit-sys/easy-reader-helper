import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Loader2, Pencil, Plus, Search } from "lucide-react";
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
import { useWorkspace } from "@/lib/workspace";
import { can, type Role } from "@/server/rbac";
import {
  archiveProductionSilo,
  createProductionSilo,
  listProductionSilos,
  updateProductionSilo,
} from "@/server/operations/silos.functions";

type SiloRow = Awaited<ReturnType<typeof listProductionSilos>>[number];

interface SiloFormState {
  code: string;
  name: string;
  type: string;
  capacityTonnes: string;
  inspectionPeriodDays: string;
  notes: string;
}

const EMPTY_FORM: SiloFormState = {
  code: "",
  name: "",
  type: "Metálico",
  capacityTonnes: "0",
  inspectionPeriodDays: "90",
  notes: "",
};

export function ProductionSilosPage() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | "bom" | "atencao" | "critico">("todos");
  const [editing, setEditing] = useState<SiloRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const queryKey = ["production", "silos", workspace?.organizationId, workspace?.facilityId];
  const silosQuery = useQuery({
    queryKey,
    queryFn: () =>
      listProductionSilos({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
        },
      }),
    enabled: Boolean(workspace),
  });

  const canWrite = workspace ? can(workspace.role as Role, "silos.write") : false;
  const rows = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (silosQuery.data ?? [])
      .filter((item) => (filter === "todos" ? true : item.status === filter))
      .filter((item) =>
        normalized
          ? `${item.code} ${item.name} ${item.type}`.toLowerCase().includes(normalized)
          : true,
      );
  }, [filter, search, silosQuery.data]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["production", "silos"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "dashboard"] }),
    ]);
  };

  const archiveMutation = useMutation({
    mutationFn: (siloId: string) =>
      archiveProductionSilo({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          siloId,
        },
      }),
    onSuccess: async () => {
      await refresh();
      toast.success("Silo arquivado.");
    },
    onError: () => toast.error("Não foi possível arquivar o silo."),
  });

  if (workspaceState.loading) {
    return <LoadingState text="Carregando unidades autorizadas…" />;
  }
  if (workspaceState.error) {
    return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  }
  if (!workspace) {
    return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e uma unidade para continuar." />;
  }

  return (
    <div>
      <PageHeader
        title="Silos"
        subtitle={`${workspace.facilityName} · cadastro operacional persistido no servidor`}
        actions={
          canWrite ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Novo silo
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["todos", "bom", "atencao", "critico"] as const).map((item) => (
          <Button
            key={item}
            size="sm"
            variant={filter === item ? "default" : "outline"}
            onClick={() => setFilter(item)}
          >
            {item === "todos" ? "Todos" : item === "bom" ? "Bom" : item === "atencao" ? "Atenção" : "Crítico"}
          </Button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar código, nome ou tipo"
            className="pl-8"
          />
        </div>
      </div>

      {silosQuery.isLoading ? (
        <LoadingState text="Carregando silos…" />
      ) : silosQuery.error ? (
        <EmptyState
          title="Não foi possível carregar os silos"
          description="Verifique sua conexão e suas permissões e tente novamente."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhum silo encontrado"
          description={
            silosQuery.data?.length
              ? "Ajuste os filtros ou a busca."
              : "Cadastre o primeiro silo desta unidade para iniciar a operação."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-card">
          <table className="w-full table-dense">
            <thead className="bg-muted/70 text-left">
              <tr>
                <Th>Silo</Th>
                <Th>Status</Th>
                <Th>Prontidão</Th>
                <Th>Pendências</Th>
                <Th>Críticos</Th>
                <Th>Última inspeção</Th>
                <Th>Próxima ação</Th>
                {canWrite ? <Th>Ações</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <p className="font-medium">{row.name}</p>
                    <span className="block text-xs text-muted-foreground">
                      {row.code} · {row.type} · {row.capacityTonnes.toLocaleString("pt-BR")} t
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2 font-medium">{row.readiness}%</td>
                  <td className="px-3 py-2">{row.pending}</td>
                  <td className="px-3 py-2">{row.critical}</td>
                  <td className="px-3 py-2 text-sm text-muted-foreground">
                    {row.lastInspectionAt
                      ? new Intl.DateTimeFormat("pt-BR").format(new Date(row.lastInspectionAt))
                      : "Sem inspeção concluída"}
                  </td>
                  <td className="px-3 py-2 text-sm text-muted-foreground">
                    {row.nextAction?.title ?? "Sem ação aberta"}
                  </td>
                  {canWrite ? (
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Editar ${row.name}`}
                          onClick={() => {
                            setEditing(row);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Arquivar ${row.name}`}
                          disabled={archiveMutation.isPending}
                          onClick={() => {
                            if (window.confirm(`Arquivar ${row.name}? O histórico será preservado.`)) {
                              archiveMutation.mutate(row.id);
                            }
                          }}
                        >
                          <Archive className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 rounded border border-info/30 bg-info/10 p-3 text-xs text-muted-foreground">
        A prontidão exibida é calculada somente sobre os critérios internos cadastrados para cada silo. Não representa certificação ou parecer legal.
      </p>

      <SiloDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        workspace={workspace}
        onSaved={refresh}
      />
    </div>
  );
}

function SiloDialog({
  open,
  onOpenChange,
  editing,
  workspace,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SiloRow | null;
  workspace: NonNullable<ReturnType<typeof useWorkspace>["workspace"]>;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<SiloFormState>(EMPTY_FORM);

  const initialKey = editing?.id ?? "new";
  const [loadedKey, setLoadedKey] = useState("");
  if (open && loadedKey !== initialKey) {
    setLoadedKey(initialKey);
    setForm(
      editing
        ? {
            code: editing.code,
            name: editing.name,
            type: editing.type,
            capacityTonnes: String(editing.capacityTonnes),
            inspectionPeriodDays: String(editing.inspectionPeriodDays),
            notes: editing.notes,
          }
        : EMPTY_FORM,
    );
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const silo = {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type.trim(),
        capacityTonnes: Number(form.capacityTonnes),
        inspectionPeriodDays: Number(form.inspectionPeriodDays),
        notes: form.notes.trim(),
      };
      if (editing) {
        return updateProductionSilo({
          data: {
            organizationId: workspace.organizationId,
            facilityId: workspace.facilityId,
            siloId: editing.id,
            silo,
          },
        });
      }
      return createProductionSilo({
        data: {
          organizationId: workspace.organizationId,
          facilityId: workspace.facilityId,
          silo,
        },
      });
    },
    onSuccess: async () => {
      await onSaved();
      onOpenChange(false);
      toast.success(editing ? "Silo atualizado." : "Silo cadastrado.");
    },
    onError: (error) => {
      const message = error instanceof Error && error.message.includes("unique")
        ? "Já existe um silo com este código na unidade."
        : "Não foi possível salvar o silo.";
      toast.error(message);
    },
  });

  const valid =
    form.code.trim().length > 0 &&
    form.name.trim().length > 0 &&
    form.type.trim().length > 0 &&
    Number.isInteger(Number(form.capacityTonnes)) &&
    Number(form.capacityTonnes) >= 0 &&
    Number.isInteger(Number(form.inspectionPeriodDays)) &&
    Number(form.inspectionPeriodDays) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar silo" : "Novo silo"}</DialogTitle>
          <DialogDescription>
            Dados operacionais da estrutura. Alterações ficam registradas na trilha de auditoria.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field label="Código">
            <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
          </Field>
          <Field label="Nome">
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Tipo">
            <Input value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} />
          </Field>
          <Field label="Capacidade (t)">
            <Input
              inputMode="numeric"
              value={form.capacityTonnes}
              onChange={(event) => setForm({ ...form, capacityTonnes: event.target.value })}
            />
          </Field>
          <Field label="Periodicidade interna de inspeção (dias)">
            <Input
              inputMode="numeric"
              value={form.inspectionPeriodDays}
              onChange={(event) => setForm({ ...form, inspectionPeriodDays: event.target.value })}
            />
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <textarea
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex min-h-56 items-center justify-center rounded border border-border bg-card text-sm text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
      {text}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`space-y-1.5 text-sm ${className}`}>
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">{children}</th>;
}
