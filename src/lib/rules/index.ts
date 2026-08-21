import { differenceInCalendarDays, parseISO } from "date-fns";
import type {
  CorrectiveAction,
  DocumentStatus,
  Criticidade,
  Inspection,
  Requirement,
  Silo,
  StoredDocument,
} from "@/types";

export interface Finding {
  severidade: "critico" | "moderado" | "informativo";
  titulo: string;
  detalhe: string;
  objetoId: string;
}

const today = (ref?: Date) => ref ?? new Date();

/** 19. Índice de prontidão: itens atendidos / itens aplicáveis. Sem ponderação. */
export function calculateReadinessIndex(requirements: Requirement[]) {
  const aplicaveis = requirements.filter((r) => r.aplicavel && r.status !== "nao_aplicavel");
  const atendidos = aplicaveis.filter((r) => r.status === "atendido");
  const pendentes = aplicaveis.filter((r) => r.status === "pendente");
  const criticos = aplicaveis.filter((r) => r.status === "critico");
  const percentExato = aplicaveis.length === 0 ? 0 : (atendidos.length / aplicaveis.length) * 100;
  return {
    totalAplicaveis: aplicaveis.length,
    atendidos: atendidos.length,
    pendentes: pendentes.length,
    criticos: criticos.length,
    percentExato,
    percent: Math.round(percentExato),
  };
}

/** 21. Regra de vencimento de documento. */
export function runDocumentExpirationRule(
  doc: StoredDocument,
  janelaDias = 30,
  ref?: Date,
): { status: DocumentStatus; diasRestantes: number | null } {
  if (!doc.validade) return { status: "sem_validade", diasRestantes: null };
  const dias = differenceInCalendarDays(parseISO(doc.validade), today(ref));
  if (dias < 0) return { status: "vencido", diasRestantes: dias };
  if (dias <= janelaDias) return { status: "vence_em_breve", diasRestantes: dias };
  return { status: "valido", diasRestantes: dias };
}

/** 33. Evidência obrigatória ausente. */
export function runMissingEvidenceRule(requirements: Requirement[]): Finding[] {
  return requirements
    .filter((r) => r.aplicavel && r.evidenciaObrigatoria && r.evidencias.length === 0)
    .map((r) => ({
      severidade: r.criticidade === "alta" ? ("critico" as const) : ("moderado" as const),
      titulo: "Evidência obrigatória ausente",
      detalhe: `${r.codigo} — ${r.titulo}`,
      objetoId: r.id,
    }));
}

/** 26. Ação corretiva atrasada. */
export function runOverdueActionRule(
  action: CorrectiveAction,
  ref?: Date,
): { atrasada: boolean; diasAtraso: number; finding: Finding | null } {
  if (action.status === "concluida" || !action.prazo)
    return { atrasada: false, diasAtraso: 0, finding: null };
  const dias = differenceInCalendarDays(today(ref), parseISO(action.prazo));
  if (dias <= 0) return { atrasada: false, diasAtraso: 0, finding: null };
  return {
    atrasada: true,
    diasAtraso: dias,
    finding: {
      severidade: action.prioridade === "alta" ? "critico" : "moderado",
      titulo: "Ação corretiva atrasada",
      detalhe: `${action.codigo} — ${action.titulo} (${dias} dias de atraso)`,
      objetoId: action.id,
    },
  };
}

/** 34. Inspeção fora da periodicidade interna cadastrada. */
export function runInspectionDueRule(
  silo: Silo,
  ref?: Date,
): { foraDaPeriodicidade: boolean; diasDesdeUltima: number | null; atrasoDias: number } {
  if (!silo.ultimaInspecao)
    return { foraDaPeriodicidade: true, diasDesdeUltima: null, atrasoDias: 0 };
  const dias = differenceInCalendarDays(today(ref), parseISO(silo.ultimaInspecao));
  const atraso = dias - silo.periodicidadeInspecaoDias;
  return {
    foraDaPeriodicidade: atraso > 0,
    diasDesdeUltima: dias,
    atrasoDias: Math.max(0, atraso),
  };
}

/** 33. Requisitos críticos cadastrados. */
export function runCriticalRequirementRule(requirements: Requirement[]): Finding[] {
  return requirements
    .filter((r) => r.aplicavel && r.status === "critico")
    .map((r) => ({
      severidade: "critico" as const,
      titulo: "Item requer revisão imediata",
      detalhe: `${r.codigo} — ${r.titulo}`,
      objetoId: r.id,
    }));
}

/** 35. Prioridade determinística e explicável. */
export function suggestPriority(input: {
  criticidade: Criticidade;
  prazoVencido: boolean;
  evidenciaObrigatoriaAusente: boolean;
  documentoVencido: boolean;
}): { prioridade: "alta" | "media" | "baixa"; pontos: number; motivos: string[] } {
  const motivos: string[] = [];
  let pontos = 0;
  if (input.criticidade === "alta") {
    pontos += 3;
    motivos.push("Criticidade alta cadastrada");
  } else if (input.criticidade === "media") {
    pontos += 1;
    motivos.push("Criticidade média cadastrada");
  }
  if (input.prazoVencido) {
    pontos += 2;
    motivos.push("Prazo interno vencido");
  }
  if (input.evidenciaObrigatoriaAusente) {
    pontos += 2;
    motivos.push("Evidência obrigatória ausente");
  }
  if (input.documentoVencido) {
    pontos += 1;
    motivos.push("Documento relacionado vencido");
  }
  const prioridade = pontos >= 5 ? "alta" : pontos >= 2 ? "media" : "baixa";
  return { prioridade, pontos, motivos };
}

export function inspectionCoverage(inspections: Inspection[], siloId: string) {
  return inspections.filter((i) => i.siloId === siloId).length;
}
