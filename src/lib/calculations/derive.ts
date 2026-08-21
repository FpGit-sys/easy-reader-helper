import { differenceInCalendarDays, parseISO } from "date-fns";
import {
  calculateReadinessIndex,
  runDocumentExpirationRule,
  runInspectionDueRule,
  runOverdueActionRule,
  suggestPriority,
} from "@/lib/rules";
import type { AppState, DocumentStatus, SiloStatus } from "@/types";

export function readiness(state: AppState) {
  return calculateReadinessIndex(state.requirements);
}

export function docStatus(state: AppState, docId: string) {
  const doc = state.documents.find((d) => d.id === docId);
  if (!doc) return { status: "sem_validade" as DocumentStatus, diasRestantes: null };
  return runDocumentExpirationRule(doc, state.settings.janelaVencimentoDias);
}

export function documentsWithStatus(state: AppState) {
  return state.documents.map((d) => ({
    ...d,
    ...runDocumentExpirationRule(d, state.settings.janelaVencimentoDias),
  }));
}

export function actionsWithStatus(state: AppState) {
  return state.actions.map((a) => {
    const overdue = runOverdueActionRule(a);
    return { ...a, atrasada: overdue.atrasada, diasAtraso: overdue.diasAtraso };
  });
}

export function siloStats(state: AppState, siloId: string) {
  const silo = state.silos.find((s) => s.id === siloId)!;
  const reqs = state.requirements.filter((r) => r.siloIds.includes(siloId));
  const index = calculateReadinessIndex(reqs);
  const docs = documentsWithStatus(state).filter((d) => d.siloId === siloId);
  const acoes = actionsWithStatus(state).filter((a) => a.siloId === siloId);
  const ncs = state.nonconformities.filter((n) => n.siloId === siloId && n.status !== "resolvida");
  const inspecao = runInspectionDueRule(silo);
  const status: SiloStatus =
    index.criticos > 0 || index.percent < 60 ? "critico" : index.percent < 90 ? "atencao" : "bom";
  const proximaAcao =
    acoes.filter((a) => a.status !== "concluida").sort((a, b) => (a.prazo ?? "") < (b.prazo ?? "") ? -1 : 1)[0] ?? null;

  return {
    silo,
    index,
    requisitos: reqs,
    documentos: docs,
    documentosVencidos: docs.filter((d) => d.status === "vencido").length,
    acoes,
    acoesAtrasadas: acoes.filter((a) => a.atrasada).length,
    ncs,
    inspecao,
    status,
    proximaAcao,
  };
}

export function dashboardMetrics(state: AppState) {
  const idx = readiness(state);
  const docs = documentsWithStatus(state);
  const acoes = actionsWithStatus(state);
  return {
    ...idx,
    documentosVencidos: docs.filter((d) => d.status === "vencido").length,
    documentosVencendo: docs.filter((d) => d.status === "vence_em_breve").length,
    acoesAtrasadas: acoes.filter((a) => a.atrasada).length,
    ncsAbertas: state.nonconformities.filter((n) => n.status !== "resolvida").length,
    evidencias: state.evidence.length,
    inspecoes: state.inspections.length,
  };
}

export function requirementPriority(state: AppState, requirementId: string) {
  const req = state.requirements.find((r) => r.id === requirementId);
  if (!req) return null;
  const prazoVencido = !!req.prazo && differenceInCalendarDays(new Date(), parseISO(req.prazo)) > 0;
  const docsDoSilo = documentsWithStatus(state).filter(
    (d) => d.siloId && req.siloIds.includes(d.siloId),
  );
  return suggestPriority({
    criticidade: req.criticidade,
    prazoVencido,
    evidenciaObrigatoriaAusente: req.evidenciaObrigatoria && req.evidencias.length === 0,
    documentoVencido: docsDoSilo.some((d) => d.status === "vencido"),
  });
}

export function statusChartData(state: AppState) {
  const idx = readiness(state);
  return [
    { name: "Atendidos", valor: idx.atendidos, fill: "var(--color-chart-1)" },
    { name: "Pendentes", valor: idx.pendentes, fill: "var(--color-chart-2)" },
    { name: "Críticos", valor: idx.criticos, fill: "var(--color-chart-3)" },
    {
      name: "Não aplicáveis",
      valor: state.requirements.filter((r) => !r.aplicavel || r.status === "nao_aplicavel").length,
      fill: "var(--color-chart-5)",
    },
  ];
}

export function pendenciasPorCategoria(state: AppState) {
  const map = new Map<string, number>();
  state.requirements
    .filter((r) => r.status === "pendente" || r.status === "critico")
    .forEach((r) => map.set(r.categoria, (map.get(r.categoria) ?? 0) + 1));
  return [...map.entries()]
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor);
}
