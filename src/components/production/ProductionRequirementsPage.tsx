import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Loader2, Pencil, Plus, Search, ShieldAlert } from "lucide-react";
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
import { useWorkspace } from "@/lib/workspace";
import {
  createProductionRequirement,
  listProductionRequirements,
  reviseProductionRequirement,
  transitionProductionRequirement,
} from "@/server/operations/requirements.functions";
import { listProductionSilos } from "@/server/operations/silos.functions";
import { can, type Role } from "@/server/rbac";

type RequirementRow = Awaited<ReturnType<typeof listProductionRequirements>>[number];
type Lifecycle = RequirementRow["lifecycle"];
type SourceType = NonNullable<RequirementRow["sourceType"]>;
type Severity = NonNullable<RequirementRow["severity"]>;

interface RequirementForm {
  code: string;
  title: string;
  category: string;
  description: string;
  severity: Severity;
  evidenceRequired: boolean;
  internalPeriodDays: string;
  siloIds: string[];
  sourceType: SourceType;
  sourceTitle: string;
  sourceIssuer: string;
  sourceVersion: string;
  sourceSection: string;
  sourceOfficialUrl: string;
  sourceConsultedAt: string;
}

const LIFECYCLES: Array<"todos" | Lifecycle> = [
  "todos",
  "rascunho",
  "em_revisao",
  "validado",
  "publicado",
  "obsoleto",
];

export function ProductionRequirementsPage() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [lifecycle, setLifecycle] = useState<"todos" | Lifecycle>("todos");
  const [editing, setEditing] = useState<RequirementRow | null | undefined>(undefined);

  const requirementsQuery = useQuery({
    queryKey: ["production", "requirements", workspace?.organizationId, workspace?.facilityId],
    queryFn: () =>
      listProductionRequirements({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
        },
      }),
    enabled: Boolean(workspace),
  });

  const silosQuery = useQuery({
    queryKey: ["production", "silos", workspace?.organizationId, workspace?.facilityId],
    queryFn: () =>
      listProductionSilos({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
        },
      }),
    enabled: Boolean(workspace),
  });

  const canWrite = workspace ? can(workspace.role as Role, "requirements.write") : false;
  const canPublish = workspace ? can(workspace.role as Role, "requirements.publish") : false;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (requirementsQuery.data ?? [])
      .filter((row) => (lifecycle === "todos" ? true : row.lifecycle === lifecycle))
      .filter((row) =>
        needle
          ? `${row.code} ${row.title} ${row.category} ${row.sourceTitle ?? ""}`
              .toLowerCase()
              .includes(needle)
          : true,
      );
  }, [lifecycle, requirementsQuery.data, search]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["production", "requirements"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "silos"] }),
    ]);
  };

  if (workspaceState.loading) return <Loading text="Carregando sua unidade…" />;
  if (workspaceState.error) {
    return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  }
  if (!workspace) {
    return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e uma unidade para continuar." />;
  }

  return (
    <div>
      <PageHeader
        title="Matriz de requisitos"
        subtitle={`${workspace.facilityName} · critérios versionados e fontes rastreáveis`}
        actions={
          canWrite ? (
            <Button onClick={() => setEditing(null)}>
              <Plus className="size-4" aria-hidden="true" />
              Novo critério
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar código, título, categoria ou fonte"
            className="pl-8"
          />
        </div>
        <Select value={lifecycle} onValueChange={(value) => setLifecycle(value as typeof lifecycle)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LIFECYCLES.map((item) => (
              <SelectItem key={item} value={item}>{lifecycleLabel(item)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {requirementsQuery.isLoading ? (
        <Loading text="Carregando matriz…" />
      ) : requirementsQuery.error ? (
        <EmptyState
          title="Não foi possível carregar a matriz"
          description="Verifique a conexão e suas permissões."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhum critério encontrado"
          description={
            requirementsQuery.data?.length
              ? "Ajuste os filtros ou a busca."
              : "Cadastre o primeiro critério interno ou fonte externa rastreável."
          }
          action={canWrite ? <Button onClick={() => setEditing(null)}>Novo critério</Button> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-card">
          <table className="w-full table-dense">
            <thead className="bg-muted/70 text-left">
              <tr>
                <Th>Código / critério</Th>
                <Th>Categoria</Th>
                <Th>Fonte</Th>
                <Th>Ciclo</Th>
                <Th>Status na unidade</Th>
                <Th>Versão</Th>
                <Th>Escopo</Th>
                <Th>Ações</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <RequirementTableRow
                  key={row.id}
                  row={row}
                  siloNames={new Map((silosQuery.data ?? []).map((silo) => [silo.id, silo.name]))}
                  canWrite={canWrite}
                  canPublish={canPublish}
                  workspace={workspace}
                  onEdit={() => setEditing(row)}
                  onChanged={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 rounded border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Importante:</strong> o SiloNR organiza critérios internos e referências externas. “Fonte externa verificada” significa apenas que os metadados da fonte oficial foram cadastrados e revisados; isso não constitui parecer jurídico, laudo técnico, certificação ou garantia de conformidade.
      </div>

      {editing !== undefined ? (
        <RequirementDialog
          key={editing?.id ?? "new"}
          row={editing}
          workspace={workspace}
          silos={silosQuery.data ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}

function RequirementTableRow({
  row,
  siloNames,
  canWrite,
  canPublish,
  workspace,
  onEdit,
  onChanged,
}: {
  row: RequirementRow;
  siloNames: Map<string, string>;
  canWrite: boolean;
  canPublish: boolean;
  workspace: NonNullable<ReturnType<typeof useWorkspace>["workspace"]>;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const transitionMutation = useMutation({
    mutationFn: (target: Lifecycle) =>
      transitionProductionRequirement({
        data: {
          organizationId: workspace.organizationId,
          facilityId: workspace.facilityId,
          requirementId: row.id,
          target,
        },
      }),
    onSuccess: async ({ lifecycle }) => {
      await onChanged();
      toast.success(`Critério movido para “${lifecycleLabel(lifecycle)}”.`);
    },
    onError: () => toast.error("Não foi possível alterar o ciclo do critério."),
  });

  const next = nextTransition(row.lifecycle, canWrite, canPublish);
  const scope = row.siloIds.length
    ? row.siloIds.map((id) => siloNames.get(id) ?? "Silo").join(", ")
    : "Unidade";

  return (
    <tr className="border-t border-border align-top hover:bg-muted/40">
      <td className="min-w-64 px-3 py-2">
        <p className="text-xs font-mono text-muted-foreground">{row.code}</p>
        <p className="font-medium">{row.title}</p>
        {row.description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.description}</p> : null}
      </td>
      <td className="px-3 py-2 text-sm">{row.category}</td>
      <td className="min-w-56 px-3 py-2 text-xs">
        <span className="font-medium">{sourceTypeLabel(row.sourceType)}</span>
        <span className="block text-muted-foreground">{row.sourceTitle ?? "Sem fonte ativa"}</span>
        {row.sourceOfficialUrl ? (
          <a
            href={row.sourceOfficialUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block max-w-52 truncate text-primary underline-offset-2 hover:underline"
          >
            Abrir fonte cadastrada
          </a>
        ) : null}
      </td>
      <td className="px-3 py-2"><LifecycleBadge lifecycle={row.lifecycle} /></td>
      <td className="px-3 py-2">
        <StatusBadge status={row.facilityStatus} />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {row.critical} crítico(s) · {row.pending} pendente(s)
        </p>
      </td>
      <td className="px-3 py-2 text-sm">{row.version ? `v${row.version}` : "—"}</td>
      <td className="max-w-52 px-3 py-2 text-xs text-muted-foreground">{scope}</td>
      <td className="px-3 py-2">
        <div className="flex min-w-28 gap-1">
          {canWrite && row.lifecycle !== "obsoleto" ? (
            <Button size="icon" variant="ghost" aria-label={`Editar ${row.title}`} onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          {next ? (
            <Button
              size="sm"
              variant="outline"
              disabled={transitionMutation.isPending}
              onClick={() => transitionMutation.mutate(next.target)}
            >
              {transitionMutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
              {next.label}
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function RequirementDialog({
  row,
  workspace,
  silos,
  onClose,
  onSaved,
}: {
  row: RequirementRow | null;
  workspace: NonNullable<ReturnType<typeof useWorkspace>["workspace"]>;
  silos: Awaited<ReturnType<typeof listProductionSilos>>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<RequirementForm>(() => ({
    code: row?.code ?? "",
    title: row?.title ?? "",
    category: row?.category ?? "Documentação",
    description: row?.description ?? "",
    severity: row?.severity ?? "media",
    evidenceRequired: row?.evidenceRequired ?? false,
    internalPeriodDays: row?.internalPeriodDays ? String(row.internalPeriodDays) : "",
    siloIds: row?.siloIds ?? [],
    sourceType: row?.sourceType ?? "interno",
    sourceTitle: row?.sourceTitle ?? "Critério interno da unidade",
    sourceIssuer: row?.sourceIssuer ?? "",
    sourceVersion: row?.sourceVersion ?? "",
    sourceSection: row?.sourceSection ?? "",
    sourceOfficialUrl: row?.sourceOfficialUrl ?? "",
    sourceConsultedAt: row?.sourceConsultedAt?.slice(0, 10) ?? "",
  }));

  const mutation = useMutation({
    mutationFn: async () => {
      const version = {
        description: form.description.trim(),
        severity: form.severity,
        evidenceRequired: form.evidenceRequired,
        internalPeriodDays: form.internalPeriodDays ? Number(form.internalPeriodDays) : null,
        source: {
          type: form.sourceType,
          title: form.sourceTitle.trim(),
          issuer: nullable(form.sourceIssuer),
          version: nullable(form.sourceVersion),
          section: nullable(form.sourceSection),
          officialUrl: nullable(form.sourceOfficialUrl),
          consultedAt: form.sourceConsultedAt ? `${form.sourceConsultedAt}T12:00:00.000Z` : null,
          notes: "",
        },
      } as const;

      if (row) {
        return reviseProductionRequirement({
          data: {
            organizationId: workspace.organizationId,
            facilityId: workspace.facilityId,
            requirementId: row.id,
            title: form.title.trim(),
            category: form.category.trim(),
            siloIds: form.siloIds,
            version,
          },
        });
      }
      return createProductionRequirement({
        data: {
          organizationId: workspace.organizationId,
          facilityId: workspace.facilityId,
          code: form.code.trim(),
          title: form.title.trim(),
          category: form.category.trim(),
          siloIds: form.siloIds,
          version,
        },
      });
    },
    onSuccess: async () => {
      await onSaved();
      toast.success(row ? "Nova versão do critério criada em rascunho." : "Critério criado em rascunho.");
      onClose();
    },
    onError: (error) => {
      const code = error instanceof Error ? error.message : "";
      toast.error(
        code.includes("INVALID_SILO_SCOPE")
          ? "Há um silo fora da unidade selecionada."
          : code.includes("unique")
            ? "Já existe um critério com este código na empresa."
            : "Não foi possível salvar o critério. Revise os campos obrigatórios.",
      );
    },
  });

  const verified = form.sourceType === "externa_verificada";
  const valid =
    form.code.trim().length > 0 &&
    form.title.trim().length > 0 &&
    form.category.trim().length > 0 &&
    form.description.trim().length > 0 &&
    form.sourceTitle.trim().length > 0 &&
    (!form.internalPeriodDays || Number(form.internalPeriodDays) > 0) &&
    (!verified ||
      Boolean(
        form.sourceIssuer.trim() &&
          form.sourceVersion.trim() &&
          form.sourceSection.trim() &&
          form.sourceOfficialUrl.trim() &&
          form.sourceConsultedAt,
      ));

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{row ? `Criar nova versão de ${row.code}` : "Novo critério"}</DialogTitle>
          <DialogDescription>
            Versões anteriores não são sobrescritas. Toda alteração retorna o critério para rascunho antes de nova revisão/publicação.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código">
            <Input
              value={form.code}
              disabled={Boolean(row)}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              placeholder="Ex.: INT-001"
            />
          </Field>
          <Field label="Categoria">
            <Input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
          </Field>
          <Field label="Título" className="sm:col-span-2">
            <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          <Field label="Descrição / critério de verificação" className="sm:col-span-2">
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
          <Field label="Criticidade">
            <Select value={form.severity} onValueChange={(value) => setForm({ ...form, severity: value as Severity })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="baixa">Baixa</SelectItem>
                <SelectItem value="media">Média</SelectItem>
                <SelectItem value="alta">Alta</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Periodicidade interna (dias)">
            <Input
              inputMode="numeric"
              value={form.internalPeriodDays}
              onChange={(event) => setForm({ ...form, internalPeriodDays: event.target.value })}
              placeholder="Opcional"
            />
          </Field>

          <div className="sm:col-span-2 rounded border border-border p-3">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={form.evidenceRequired}
                onChange={(event) => setForm({ ...form, evidenceRequired: event.target.checked })}
                className="mt-0.5 size-4"
              />
              <span>
                <strong className="block">Exigir evidência interna</strong>
                <span className="text-xs text-muted-foreground">O fluxo de inspeção deverá solicitar evidência para este critério.</span>
              </span>
            </label>
          </div>

          <Field label="Fonte do critério" className="sm:col-span-2">
            <Select
              value={form.sourceType}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  sourceType: value as SourceType,
                  sourceTitle:
                    value === "interno" && !form.sourceTitle.trim()
                      ? "Critério interno da unidade"
                      : form.sourceTitle,
                })
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="interno">Critério interno</SelectItem>
                <SelectItem value="externa_nao_verificada">Fonte externa ainda não verificada</SelectItem>
                <SelectItem value="externa_verificada">Fonte externa verificada</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Nome/título da fonte" className="sm:col-span-2">
            <Input value={form.sourceTitle} onChange={(event) => setForm({ ...form, sourceTitle: event.target.value })} />
          </Field>

          {form.sourceType !== "interno" ? (
            <>
              <Field label="Órgão / emissor">
                <Input value={form.sourceIssuer} onChange={(event) => setForm({ ...form, sourceIssuer: event.target.value })} />
              </Field>
              <Field label="Versão / edição / data de referência">
                <Input value={form.sourceVersion} onChange={(event) => setForm({ ...form, sourceVersion: event.target.value })} />
              </Field>
              <Field label="Item / seção / referência">
                <Input value={form.sourceSection} onChange={(event) => setForm({ ...form, sourceSection: event.target.value })} />
              </Field>
              <Field label="Data da consulta">
                <Input type="date" value={form.sourceConsultedAt} onChange={(event) => setForm({ ...form, sourceConsultedAt: event.target.value })} />
              </Field>
              <Field label="URL oficial" className="sm:col-span-2">
                <Input type="url" value={form.sourceOfficialUrl} onChange={(event) => setForm({ ...form, sourceOfficialUrl: event.target.value })} placeholder="https://..." />
              </Field>
            </>
          ) : null}

          {verified ? (
            <div className="sm:col-span-2 flex gap-2 rounded border border-info/30 bg-info/10 p-3 text-xs text-muted-foreground">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
              Para usar “fonte externa verificada”, emissor, versão, referência, URL oficial e data da consulta são obrigatórios. A validação identifica a origem cadastrada; não transforma o software em autoridade jurídica ou fiscalizatória.
            </div>
          ) : null}

          <div className="sm:col-span-2">
            <Label>Aplicação por silo</Label>
            <p className="mt-1 text-xs text-muted-foreground">Sem seleção, o critério é tratado no nível da unidade.</p>
            <div className="mt-2 grid gap-2 rounded border border-border p-3 sm:grid-cols-2">
              {silos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum silo ativo cadastrado.</p>
              ) : (
                silos.map((silo) => (
                  <label key={silo.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.siloIds.includes(silo.id)}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          siloIds: event.target.checked
                            ? [...form.siloIds, silo.id]
                            : form.siloIds.filter((id) => id !== silo.id),
                        })
                      }
                      className="size-4"
                    />
                    {silo.name}
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {row ? "Criar nova versão" : "Criar rascunho"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function nextTransition(lifecycle: Lifecycle, canWrite: boolean, canPublish: boolean) {
  if (lifecycle === "rascunho" && canWrite) return { target: "em_revisao" as const, label: "Enviar à revisão" };
  if (lifecycle === "em_revisao" && canPublish) return { target: "validado" as const, label: "Validar" };
  if (lifecycle === "validado" && canPublish) return { target: "publicado" as const, label: "Publicar" };
  if (lifecycle === "publicado" && canPublish) return { target: "obsoleto" as const, label: "Tornar obsoleto" };
  return null;
}

function LifecycleBadge({ lifecycle }: { lifecycle: Lifecycle }) {
  const classes =
    lifecycle === "publicado"
      ? "border-success/30 bg-success/10 text-success"
      : lifecycle === "validado"
        ? "border-info/30 bg-info/10 text-info"
        : lifecycle === "obsoleto"
          ? "border-border bg-muted text-muted-foreground"
          : lifecycle === "em_revisao"
            ? "border-warning/30 bg-warning/10 text-warning"
            : "border-border bg-background text-muted-foreground";
  return <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${classes}`}>{lifecycleLabel(lifecycle)}</span>;
}

function lifecycleLabel(value: "todos" | Lifecycle) {
  const map: Record<typeof value, string> = {
    todos: "Todos os ciclos",
    rascunho: "Rascunho",
    em_revisao: "Em revisão",
    validado: "Validado",
    publicado: "Publicado",
    obsoleto: "Obsoleto",
  };
  return map[value];
}

function sourceTypeLabel(value: RequirementRow["sourceType"]) {
  if (value === "externa_verificada") return "Externa verificada";
  if (value === "externa_nao_verificada") return "Externa não verificada";
  if (value === "interno") return "Interna";
  return "Sem fonte";
}

function nullable(value: string) {
  return value.trim() ? value.trim() : null;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide">{children}</th>;
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex min-h-56 items-center justify-center rounded border border-border bg-card text-sm text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
      {text}
    </div>
  );
}
