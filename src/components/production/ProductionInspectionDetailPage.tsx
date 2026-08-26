import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Download, ImagePlus, Loader2, Save, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/workspace";
import {
  getProductionEvidenceDownload,
  listProductionInspectionEvidence,
} from "@/server/operations/evidence.functions";
import {
  finalizeProductionInspection,
  getProductionInspection,
  saveProductionInspectionAnswers,
} from "@/server/operations/inspections.functions";
import { can, type Role } from "@/server/rbac";

type InspectionDetail = Awaited<ReturnType<typeof getProductionInspection>>;
type ChecklistItem = InspectionDetail["checklist"][number];
type AnswerResult = NonNullable<ChecklistItem["answer"]>["result"];
type EvidenceRow = Awaited<ReturnType<typeof listProductionInspectionEvidence>>[number];

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

  const canReadEvidence = workspace ? can(workspace.role as Role, "evidence.read") : false;
  const canWriteEvidence = workspace ? can(workspace.role as Role, "evidence.write") : false;

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

  const evidenceQuery = useQuery({
    queryKey: ["production", "inspection-evidence", workspace?.organizationId, workspace?.facilityId, inspectionId],
    queryFn: () =>
      listProductionInspectionEvidence({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          inspectionId,
        },
      }),
    enabled: Boolean(workspace && inspectionId && canReadEvidence),
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

  const evidenceByRequirement = useMemo(() => {
    const grouped = new Map<string, EvidenceRow[]>();
    for (const evidence of evidenceQuery.data ?? []) {
      if (!evidence.requirementId) continue;
      const current = grouped.get(evidence.requirementId) ?? [];
      current.push(evidence);
      grouped.set(evidence.requirementId, current);
    }
    return grouped;
  }, [evidenceQuery.data]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["production", "inspection"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "inspection-evidence"] }),
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

  const uploadMutation = useMutation({
    mutationFn: async ({ item, file }: { item: ChecklistItem; file: File }) => {
      const form = new FormData();
      form.set("organizationId", workspace!.organizationId);
      form.set("facilityId", workspace!.facilityId);
      form.set("siloId", inspectionQuery.data!.siloId);
      form.set("inspectionId", inspectionId);
      form.set("requirementId", item.requirementId);
      form.set("description", `Evidência vinculada ao critério ${item.code} durante a inspeção ${inspectionQuery.data!.code}.`);
      form.set("file", file);

      const response = await fetch("/api/evidence/upload", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "EVIDENCE_UPLOAD_FAILED");
      return { requirementId: item.requirementId, filename: file.name };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["production", "inspection-evidence"] });
      toast.success(`${result.filename} anexado ao critério.`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "EVIDENCE_UPLOAD_FAILED";
      if (message === "FILE_SIZE_NOT_ALLOWED") {
        toast.error("A foto excede o limite permitido de 15 MB.");
        return;
      }
      if (message === "FILE_TYPE_NOT_ALLOWED") {
        toast.error("Formato não permitido. Use JPEG, PNG ou WebP.");
        return;
      }
      if (message === "OBJECT_STORAGE_NOT_CONFIGURED") {
        toast.error("O armazenamento privado ainda não foi configurado neste ambiente.");
        return;
      }
      if (message === "INSPECTION_LOCKED") {
        toast.error("A inspeção já foi encerrada e não aceita novas evidências neste fluxo.");
        return;
      }
      toast.error("Não foi possível anexar a evidência.");
    },
  });

  const downloadMutation = useMutation({
    mutationFn: (evidenceId: string) =>
      getProductionEvidenceDownload({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          evidenceId,
        },
      }),
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: () => toast.error("Não foi possível abrir a evidência."),
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
        `Inspeção concluída com ${result.linkedEvidence} evidência(s) vinculada(s) e ${result.findingsCreated} não conformidade(s) criada(s).`,
      );
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "INSPECTION_FINALIZE_FAILED";
      if (message.includes("INSPECTION_CHECKLIST_INCOMPLETE")) {
        toast.error("Responda todos os itens do checklist antes de concluir.");
        return;
      }
      if (message.includes("INSPECTION_REQUIRED_EVIDENCE_MISSING")) {
        const codes = message.split(":").slice(1).join(":");
        toast.error(
          codes
            ? `Anexe a evidência requerida nos critérios: ${codes}.`
            : "Existem critérios com evidência requerida ainda não anexada.",
        );
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
  const answersComplete = answeredCount === inspection.checklist.length && inspection.checklist.length > 0;
  const missingEvidence = inspection.checklist.filter((item) => {
    const answer = answers[item.requirementId];
    return (
      item.evidenceRequired &&
      answer &&
      answer.result !== "nao_aplicavel" &&
      (evidenceByRequirement.get(item.requirementId)?.length ?? 0) === 0
    );
  });
  const evidenceReady = missingEvidence.length === 0;
  const complete = answersComplete && evidenceReady;
  const busy = saveMutation.isPending || finalizeMutation.isPending || uploadMutation.isPending;

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

      <dl className="mb-5 grid gap-3 rounded border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6">
        <Info label="Status"><StatusBadge status={inspection.status} /></Info>
        <Info label="Início" value={formatDateTime(inspection.startedAt)} />
        <Info label="Conclusão" value={inspection.completedAt ? formatDateTime(inspection.completedAt) : "—"} />
        <Info label="Checklist" value={`${inspection.checklist.length} itens`} />
        <Info label="Evidências" value={String(evidenceQuery.data?.length ?? 0)} />
        <Info label="Revisão de sincronização" value={String(inspection.syncRevision)} />
      </dl>

      {inspection.notes ? (
        <div className="mb-4 rounded border border-border bg-card p-3 text-sm">
          <span className="font-medium">Contexto registrado: </span>{inspection.notes}
        </div>
      ) : null}

      {editable ? (
        <div className="mb-4 rounded border border-border bg-muted/30 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{answeredCount} de {inspection.checklist.length} itens respondidos.</span>
            <span className={complete ? "font-medium text-success" : "text-muted-foreground"}>
              {complete ? "Checklist e evidências prontos para conclusão" : "Inspeção ainda incompleta"}
            </span>
          </div>
          {answersComplete && missingEvidence.length > 0 ? (
            <p className="mt-2 text-xs text-warning-foreground">
              Evidência requerida pendente em: {missingEvidence.map((item) => item.code).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        {inspection.checklist.map((item) => (
          <ChecklistCard
            key={item.requirementId}
            item={item}
            editable={editable}
            canWriteEvidence={canWriteEvidence}
            draft={answers[item.requirementId] ?? null}
            evidence={evidenceByRequirement.get(item.requirementId) ?? []}
            uploading={uploadMutation.isPending && uploadMutation.variables?.item.requirementId === item.requirementId}
            downloading={downloadMutation.isPending}
            onChange={(answer) =>
              setAnswers((current) => ({
                ...current,
                [item.requirementId]: answer,
              }))
            }
            onUpload={(file) => uploadMutation.mutate({ item, file })}
            onDownload={(evidenceId) => downloadMutation.mutate(evidenceId)}
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
            O SiloNR preserva a versão do critério, o resultado registrado e os metadados/Hash SHA-256 dos arquivos anexados. Isso melhora rastreabilidade e integridade operacional, mas não autentica por si só o conteúdo da foto nem substitui responsável técnico, laudo, auditoria, fiscalização ou validação jurídica.
          </p>
        </div>
      </div>
    </div>
  );
}

function ChecklistCard({
  item,
  editable,
  canWriteEvidence,
  draft,
  evidence,
  uploading,
  downloading,
  onChange,
  onUpload,
  onDownload,
}: {
  item: ChecklistItem;
  editable: boolean;
  canWriteEvidence: boolean;
  draft: DraftAnswer | null;
  evidence: EvidenceRow[];
  uploading: boolean;
  downloading: boolean;
  onChange: (answer: DraftAnswer) => void;
  onUpload: (file: File) => void;
  onDownload: (evidenceId: string) => void;
}) {
  const displayed = editable ? draft : item.answer ? { result: item.answer.result, notes: item.answer.notes } : null;
  const evidenceMissing = item.evidenceRequired && displayed?.result !== "nao_aplicavel" && evidence.length === 0;

  return (
    <article className="rounded border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{item.code} — {item.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.category} · criticidade cadastrada: {severityLabel(item.severity)}
            {item.evidenceRequired ? " · evidência requerida para conclusão" : ""}
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

      <section className="mt-4 rounded border border-border bg-muted/15 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidências</p>
            <p className="text-sm">
              {evidence.length} arquivo(s) vinculado(s)
              {evidenceMissing ? <span className="ml-2 text-warning-foreground">· pendente</span> : null}
            </p>
          </div>
          {editable && canWriteEvidence && draft?.result !== "nao_aplicavel" ? (
            <label className="relative inline-flex cursor-pointer items-center gap-2 rounded border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent">
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ImagePlus className="size-4" aria-hidden="true" />
              )}
              {uploading ? "Enviando…" : "Anexar foto"}
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                disabled={uploading}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label={`Anexar evidência ao critério ${item.code}`}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          ) : null}
        </div>

        {evidence.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {evidence.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-background p-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.originalFilename ?? row.name}</p>
                  <p className="text-muted-foreground">
                    {formatFileSize(row.sizeBytes)} · {formatDateTime(row.capturedAt)} · SHA-256 {shortHash(row.sha256)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={downloading}
                  onClick={() => onDownload(row.id)}
                >
                  <Download className="size-4" aria-hidden="true" />
                  Abrir
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
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

function formatFileSize(value: number | null) {
  if (!value || value <= 0) return "tamanho indisponível";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function shortHash(value: string | null) {
  return value ? `${value.slice(0, 12)}…` : "indisponível";
}
