import { useMutation, useQuery } from "@tanstack/react-query";
import { FileDown, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_PRODUCTION_DOSSIER_OPTIONS,
  downloadProductionDossier,
  type ProductionDossierOptions,
} from "@/lib/reports/production-dossier";
import { useWorkspace } from "@/lib/workspace";
import { getProductionDossierData } from "@/server/operations/dossier.functions";
import { listProductionSilos } from "@/server/operations/silos.functions";
import { can, type Role } from "@/server/rbac";

const SECTIONS: Array<{ key: keyof ProductionDossierOptions; label: string; description: string }> = [
  { key: "requirements", label: "Matriz de critérios", description: "status, versão, criticidade e fonte cadastrada" },
  { key: "documents", label: "Documentos", description: "validades, versão e hash do arquivo ativo" },
  { key: "inspections", label: "Inspeções", description: "histórico, responsável e resultados consolidados" },
  { key: "nonconformities", label: "Não conformidades", description: "pendências, responsáveis, prazos e resolução" },
  { key: "actions", label: "Ações corretivas", description: "tratativas, prazos, evidências e conclusão" },
  { key: "evidences", label: "Índice de evidências", description: "metadados e SHA-256 dos arquivos registrados" },
  { key: "audit", label: "Trilha de auditoria", description: "últimos eventos persistidos da unidade" },
];

export function ProductionDossierPage() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const [siloIds, setSiloIds] = useState<string[]>([]);
  const [options, setOptions] = useState<ProductionDossierOptions>(DEFAULT_PRODUCTION_DOSSIER_OPTIONS);

  const silosQuery = useQuery({
    queryKey: ["production", "silos", workspace?.organizationId, workspace?.facilityId],
    queryFn: () => listProductionSilos({ data: { organizationId: workspace!.organizationId, facilityId: workspace!.facilityId } }),
    enabled: Boolean(workspace),
  });

  const canGenerate = workspace ? can(workspace.role as Role, "dossier.generate") : false;
  const canReadAudit = workspace ? can(workspace.role as Role, "audit.read") : false;

  useEffect(() => {
    if (!canReadAudit && options.audit) setOptions((current) => ({ ...current, audit: false }));
  }, [canReadAudit, options.audit]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const data = await getProductionDossierData({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          siloIds,
          includeAudit: options.audit && canReadAudit,
        },
      });
      downloadProductionDossier(data, options);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Dossiê gerado: ${data.summary.readiness}% de prontidão interna no escopo selecionado.`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("FORBIDDEN")) toast.error("Seu perfil não possui permissão para gerar este dossiê.");
      else if (message.includes("INVALID_DOSSIER_SILO_SCOPE")) toast.error("O escopo de silos mudou. Recarregue a página e tente novamente.");
      else toast.error("Não foi possível gerar o dossiê de produção.");
    },
  });

  if (workspaceState.loading) return <Loading text="Carregando unidade…" />;
  if (workspaceState.error) return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  if (!workspace) return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e uma unidade para continuar." />;
  if (!canGenerate) return <EmptyState title="Dossiê indisponível" description="Seu perfil não possui permissão para gerar dossiês desta unidade." />;

  const silos = silosQuery.data ?? [];
  const allSelected = siloIds.length === 0;
  const selectedCount = allSelected ? silos.length : siloIds.length;
  const enabledSections = SECTIONS.filter((section) => options[section.key]).length;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Dossiê de prontidão interna"
        subtitle={`${workspace.facilityName} · relatório consolidado gerado a partir dos registros persistidos`}
        actions={
          <Button disabled={generateMutation.isPending || silosQuery.isLoading} onClick={() => generateMutation.mutate()}>
            {generateMutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileDown className="size-4" aria-hidden="true" />}
            Gerar PDF
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Silos no escopo" value={String(selectedCount)} detail={allSelected ? "todos os silos ativos" : "seleção personalizada"} />
        <SummaryCard label="Seções incluídas" value={String(enabledSections)} detail="conteúdo selecionado abaixo" />
        <SummaryCard label="Auditoria" value={options.audit ? "Incluída" : "Não incluída"} detail={canReadAudit ? "conforme seu perfil" : "sem permissão audit.read"} />
      </div>

      <section className="rounded border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Escopo de silos</h2>
            <p className="text-xs text-muted-foreground">Sem seleção específica, o PDF considera todos os silos ativos da unidade. Registros de nível da unidade também permanecem no escopo.</p>
          </div>
          {!allSelected ? <Button size="sm" variant="outline" onClick={() => setSiloIds([])}>Usar todos</Button> : null}
        </div>
        {silosQuery.isLoading ? (
          <Loading text="Carregando silos…" />
        ) : silosQuery.error ? (
          <p className="text-sm text-destructive">Não foi possível carregar os silos.</p>
        ) : silos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum silo ativo cadastrado.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {silos.map((silo) => {
              const checked = allSelected || siloIds.includes(silo.id);
              return (
                <label key={silo.id} className="flex cursor-pointer items-start gap-2 rounded border border-border p-3 hover:bg-muted/30">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => {
                      if (allSelected) {
                        if (value === false) setSiloIds(silos.filter((item) => item.id !== silo.id).map((item) => item.id));
                        return;
                      }
                      setSiloIds((current) => value === true ? [...new Set([...current, silo.id])] : current.filter((id) => id !== silo.id));
                    }}
                  />
                  <span><span className="block text-sm font-medium">{silo.code} — {silo.name}</span><span className="text-xs text-muted-foreground">{silo.type} · {silo.capacityTonnes.toLocaleString("pt-BR")} t</span></span>
                </label>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-4 rounded border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Seções do relatório</h2>
        <p className="mb-3 text-xs text-muted-foreground">O sumário executivo e a identificação da unidade sempre são incluídos.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SECTIONS.map((section) => {
            const disabled = section.key === "audit" && !canReadAudit;
            return (
              <div key={section.key} className="flex items-start gap-2 rounded border border-border p-3">
                <Checkbox
                  id={`dossier-${section.key}`}
                  checked={options[section.key]}
                  disabled={disabled}
                  onCheckedChange={(value) => setOptions((current) => ({ ...current, [section.key]: value === true }))}
                />
                <Label htmlFor={`dossier-${section.key}`} className={disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}>
                  <span className="block text-sm font-medium">{section.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">{section.description}</span>
                </Label>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-4 flex gap-2 rounded border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>O PDF usa o termo <strong className="text-foreground">prontidão interna</strong>. Ele consolida o que está registrado no SiloNR e não substitui responsável técnico, laudo, auditoria, fiscalização, certificação ou análise jurídica. O SHA-256 listado nas evidências auxilia a verificar integridade de conteúdo, mas não equivale automaticamente a assinatura digital ou prova jurídica de autenticidade.</p>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded border border-border bg-card p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{detail}</p></div>;
}

function Loading({ text }: { text: string }) {
  return <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{text}</div>;
}
