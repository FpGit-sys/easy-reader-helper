import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export function fmtDate(value?: string | null) {
  if (!value) return "—";
  try {
    return format(parseISO(value.length > 10 ? value.slice(0, 10) : value), "dd/MM/yyyy");
  } catch {
    return "—";
  }
}

export function fmtDateTime(value?: string | null) {
  if (!value) return "—";
  try {
    return format(new Date(value), "dd/MM/yyyy HH:mm", { locale: ptBR });
  } catch {
    return "—";
  }
}

export const STATUS_REQ_LABEL: Record<string, string> = {
  atendido: "Atendido",
  pendente: "Pendente",
  critico: "Crítico",
  nao_aplicavel: "Não aplicável",
};

export const STATUS_DOC_LABEL: Record<string, string> = {
  valido: "Válido",
  vence_em_breve: "Vence em breve",
  vencido: "Vencido",
  sem_validade: "Sem validade informada",
};

export const STATUS_ACTION_LABEL: Record<string, string> = {
  nao_iniciada: "Não iniciada",
  em_andamento: "Em andamento",
  aguardando_evidencia: "Aguardando evidência",
  concluida: "Concluída",
  atrasada: "Atrasada",
};

export const STATUS_NC_LABEL: Record<string, string> = {
  aberta: "Aberta",
  em_tratamento: "Em tratamento",
  resolvida: "Resolvida",
};

export const CRITICIDADE_LABEL: Record<string, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const SILO_STATUS_LABEL: Record<string, string> = {
  bom: "Bom",
  atencao: "Atenção",
  critico: "Crítico",
};

export const DISCLAIMER =
  "O SiloNR é uma ferramenta de apoio à gestão de documentos, inspeções, evidências e ações internas. O software não substitui responsável técnico, profissional de segurança, consultoria jurídica, auditoria ou fiscalização oficial.";

export const DISCLAIMER_PDF =
  "Este documento foi gerado a partir de dados cadastrados em ambiente demonstrativo. O SiloNR é ferramenta de apoio à gestão e não constitui laudo, certificação, parecer técnico, parecer jurídico ou aprovação de órgão fiscalizador.";
