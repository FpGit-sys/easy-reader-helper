import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Loader2, Save, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/workspace";
import {
  finalizeProductionInspection,
  getProductionInspection,
  saveProductionInspectionAnswers,
} from "@/server/operations/inspections.functions";
import { can, type Role } from "@/server/rbac";

type InspectionDetail = Awaited<ReturnType<typeof getProductionInspection>>;
type ChecklistItem = InspectionDetail["checklist"][number];
type AnswerResult = NonNullable<ChecklistItem["answer"]>["result"];

type DraftAnswer = {
  result: AnswerResult;
  notes: string;
};

const RESULTS: Array<{ value: AnswerResult; label: string }> = [
  { value: "atendido", label: "Atendido" },
  { value: "pendente", label: "Pendente" },
  { value: "critico", label: "Crítico" },
  { value: "nao_aplicavel", label: "Não aplicável" },
];

export function ProductionInspectionDetailPage({ inspectionId }: { inspectionId: string }) {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const queryClient = useQueryClient();
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>({});

  const inspectionQuery = useQuery({
    queryKey: ["production", "inspection", workspace?.organizationId, workspace?.facilityId, inspectionId],
    queryFn: () =>
      getProductionInspection({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          inspectionId,
        },
      }),
    enabled: Boolean(workspace && inspectionId),
  });

  useEffect(() => {
    const inspection = inspectionQuery.data;
    if (!inspection || initializedFor === inspection.id) return;
    setAnswers(
      Object.fromEntries(
        inspection.checklist
          .filter((item) => item.answer)
          .map((item) => [
            item.requirementId,
            {
              result: item.answer!.result,
              notes: item.answer!.notes,
            },
          ]),
      ),
    );
    setInitializedFor(inspection.id);
  }, [initializedFor, inspectionQuery.data]);

  const answerPayload = useMemo(
    () =>
      Object.entries(answers).map(([requirementId, answer]) => ({
        requirementId,
        result: answer.result,
        notes: answer.notes,
      })),
    [answers],
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["production", "inspection"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "inspections"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "silos"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "requirements"] }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      saveProductionInspectionAnswers({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          inspectionId,
          answers: answerPayload,
        },
      }),
    onSuccess: async (result) => {
      await refresh();
      toast.success(`Rascunho salvo: ${result.answeredCount} de ${result.checklistCount} itens.`);
    },
    onError: () => toast.error("Não foi possível salvar o rascunho da inspeção."),
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      await saveProductionInspectionAnswers({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          inspectionId,
          answers: answerPayload,
        },
      });
      return finalizeProductionInspection({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          inspectionId,
        },
      });
    },
    onSuccess: async (result) => {
      await refresh();
      toast.success(
        `Inspeção concluída. ${result.findingsCreated} não conformidade(s) criada(s) a partir dos resultados.`,
      );
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "INSPECTION_FINALIZE_FAILED";
      if (message.includes("INSPECTION_CHECKLIST_INCOMPLETE")) {
        toast.error("Responda todos os itens do checklist antes de concluir.");
        return;
      }
      if (message.includes("INSPECTION_CONFLICT")) {
        toast.error("A inspeção foi alterada em outra sessão. Recarregue a página antes de continuar.");
        return;
      }
      toast.error("Não foi possível concluir a inspeção.");
    },
  });

  if (workspaceState.loading) return <Loading text="Carregando unidade…" />;
  if (workspaceState.error) {
    return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  }
  if (!workspace) {
    return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e uma unidade para continuar." />;
  }
  if (inspectionQuery.isLoading) return <Loading text="Carregando inspeção…" />;
  if (inspectionQuery.error || !inspectionQuery.data) {
    return (
      <EmptyState
        title="Inspeção indisponível"
        description="O registro não foi encontrado nesta unidade ou você não possui acesso a ele."
        action={
          <Button asChild variant="outline">
            <Link to="/app/inspections">Voltar para inspeções</Link>
          </Button>
        }
      />
    );
  }

  const inspection = inspectionQuery.data;
  const canExecute = can(workspace.role as Role, "inspections.execute");
  const editable = inspection.status === "em_andamento" && canExecute;
  const answeredCount = Object.keys(answers).length;
  const complete = answeredCount === inspection.checklist.length && inspection.checklist.length > 0;
  const busy = saveMutation.isPending || finalizeMutation.isPending;

  return (
    <div>
      <PageHeader
        title={`Inspeção ${inspection.code}`}
        subtitle={`${inspection.type} · ${inspection.siloCode} — ${inspection.siloName}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/app/inspections">Voltar</Link>
            </Button>
            {editable ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                Salvar rascunho
              </Button>
            ) : null}
            {editable ? (
              <Button
                disabled={!complete || busy}
                onClick={() => finalizeMutation.mutate()}
              >
                {finalizeMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="size-4" aria-hidden="true" />
                )}
                Concluir inspeção
              </Button>
            ) : null}
          </div>
        }
      />

      <dl className="mb-5 grid gap-3 rounded border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Info label="Status"><StatusBadge status={inspection.status} /></Info>
        <Info label="Início" value={formatDateTime(inspection.startedAt)} />
        <Info label="Conclusão" value={inspection.completedAt ? formatDateTime(inspection.completedAt) : "—"} />
        <Info label="Checklist" value={`${inspection.checklist.length} itens`} />
        <Info label="Revisão de sincronização" value={String(inspection.syncRevision)} />
      </dl>

      {inspection.notes ? (
        <div className="mb-4 rounded border border-border bg-card p-3 text-sm">
          <span className="font-medium">Contexto registrado: </span>{inspection.notes}
        </div>
      ) : null}

      {editable ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded border border-border bg-muted/30 p-3 text-sm">
          <span>{answeredCount} de {inspection.checklist.length} itens respondidos.</span>
          <span className={complete ? "font-medium text-success" : "text-muted-foreground"}>
            {complete ? "Checklist completo para conclusão" : "Rascunho ainda incompleto"}
          </span>
        </div>
      ) : null}

      <div className="space-y-3">
        {inspection.checklist.map((item) => (
          <ChecklistCard
            key={item.requirementId}
            item={item}
            editable={editable}
            draft={answers[item.requirementId] ?? null}
            onChange={(answer) =>
              setAnswers((current) => ({
                ...current,
                [item.requirementId]: answer,
              }))
            }
          />
        ))}
      </div>

      {inspection.findings.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Não conformidades geradas por esta inspeção</h2>
          <div className="overflow-x-auto rounded border border-border bg-card">
            <table className="w-full table-dense">
              <thead className="bg-muted/70 text-left">
                <tr>
                  <Th>Código</Th>
                  <Th>Título</Th>
                  <Th>Severidade</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {inspection.findings.map((finding) => (
                  <tr key={finding.id} className="border-t border-border">
                    <Td className="font-medium">{finding.code}</Td>
                    <Td>{finding.title}</Td>
                    <Td><StatusBadge status={finding.severity} /></Td>
                    <Td><StatusBadge status={finding.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : inspection.status === "concluida" ? (
        <p className="mt-6 rounded border border-border bg-card p-3 text-sm text-muted-foreground">
          Esta inspeção foi concluída sem gerar não conformidades automáticas a partir dos resultados registrados.
        </p>
      ) : null}

      <div className="mt-5 rounded border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-muted-foreground">
        <div className="flex gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            O checklist acima é uma fotografia versionada dos critérios publicados no início da inspeção. Critérios marcados como “evidência requerida” preservam essa informação no registro, mas o vínculo de arquivos de produção será conectado na próxima etapa. Até lá, este fluxo não deve ser tratado como comprovação documental completa.
          </p>
        </div>
      </div>
    </div>
  );
}

function ChecklistCard({
  item,
  editable,
  draft,
  onChange,
}: {
  item: ChecklistItem;
  editable: boolean;
  draft: DraftAnswer | null;
  onChange: (answer: DraftAnswer) => void;
}) {
  const displayed = editable ? draft : item.answer ? { result: item.answer.result, notes: item.answer.notes } : null;

  return (
    <article className="rounded border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{item.code} — {item.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.category} · criticidade cadastrada: {severityLabel(item.severity)}
            {item.evidenceRequired ? " · evidência prevista" : ""}
          </p>
        </div>
        {!editable && displayed ? <StatusBadge status={displayed.result} /> : null}
      </div>

      {item.description ? <p className="mt-2 text-sm text-muted-foreground">{item.description}</p> : null}

      <div className="mt-3 rounded bg-muted/35 p-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Fonte congelada: </span>
        {sourceLabel(item)}
      </div>

      {editable ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {RESULTS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={draft?.result === option.value ? "default" : "outline"}
                onClick={() =>
                  onChange({
                    result: option.value,
                    notes: draft?.notes ?? "",
                  })
                }
              >
                {option.label}
              </Button>
            ))}
          </div>

          {draft ? (
            <Textarea
              className="mt-3"
              rows={2}
              maxLength={5000}
              aria-label={`Observação para ${item.code}`}
              placeholder={
                draft.result === "pendente" || draft.result === "critico"
                  ? "Descreva objetivamente o que foi observado."
                  : "Observação opcional."
              }
              value={draft.notes}
              onChange={(event) => onChange({ ...draft, notes: event.target.value })}
            />
          ) : null}
        </>
      ) : displayed?.notes ? (
        <p className="mt-3 rounded border border-border bg-muted/20 p-2 text-sm">
          <span className="font-medium">Observação registrada: </span>{displayed.notes}
        </p>
      ) : null}
    </article>
  );
}

function sourceLabel(item: ChecklistItem) {
  if (!item.source.title) return "fonte não informada no critério";
  const parts = [item.source.title, item.source.issuer, item.source.version, item.source.section].filter(Boolean);
  const verification = item.source.type === "externa_verificada" ? "fonte externa verificada" : item.source.type === "externa_nao_verificada" ? "fonte externa não verificada" : "critério interno";
  return `${parts.join(" · ")} (${verification})`;
}

function severityLabel(value: ChecklistItem["severity"]) {
  if (value === "alta") return "alta";
  if (value === "media") return "média";
  return "baixa";
}

function Info({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{children ?? value ?? "—"}</dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-sm ${className}`}>{children}</td>;
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {text}
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
