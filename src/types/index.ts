export type RequirementStatus = "atendido" | "pendente" | "critico" | "nao_aplicavel";
export type Criticidade = "baixa" | "media" | "alta";
export type SiloStatus = "bom" | "atencao" | "critico";
export type SourceType = "interno" | "externa_nao_verificada" | "externa_verificada";

export interface SourceInfo {
  fonteTipo: SourceType;
  fonteNome: string;
  fonteOrgao?: string;
  fonteVersao?: string;
  fonteReferencia?: string;
  fonteURL?: string;
  fonteConsultadaEm?: string;
  fonteVerificada: boolean;
  verificadoPor?: string;
  verificadoEm?: string;
}

export interface Requirement extends SourceInfo {
  id: string;
  codigo: string;
  titulo: string;
  descricao: string;
  categoria: string;
  aplicavel: boolean;
  criticidade: Criticidade;
  status: RequirementStatus;
  responsavel: string;
  prazo: string | null;
  siloIds: string[];
  evidenciaObrigatoria: boolean;
  evidencias: string[];
  comentarios: { id: string; autor: string; texto: string; data: string }[];
  historico: { id: string; data: string; texto: string }[];
}

export interface Silo {
  id: string;
  nome: string;
  capacidadeToneladas: number;
  tipo: string;
  periodicidadeInspecaoDias: number;
  ultimaInspecao: string | null;
  observacao: string;
}

export type DocumentStatus = "valido" | "vence_em_breve" | "vencido" | "sem_validade";

export interface StoredDocument {
  id: string;
  nome: string;
  categoria: string;
  siloId: string | null;
  responsavel: string;
  emissao: string;
  validade: string | null;
  arquivoNome?: string;
  arquivoDataUrl?: string;
  observacao?: string;
}

export type InspectionStatus = "em_andamento" | "concluida";

export interface InspectionItem {
  requirementId: string;
  resultado: "atendido" | "pendente" | "nao_aplicavel";
  observacao?: string;
}

export interface Inspection {
  id: string;
  codigo: string;
  data: string;
  siloId: string;
  tipo: string;
  responsavel: string;
  status: InspectionStatus;
  itens: InspectionItem[];
  observacoes: string;
  evidencias: string[];
  pendenciasGeradas: string[];
}

export type NcStatus = "aberta" | "em_tratamento" | "resolvida";

export interface Nonconformity {
  id: string;
  codigo: string;
  titulo: string;
  descricao: string;
  siloId: string | null;
  origem: string;
  criticidade: Criticidade;
  status: NcStatus;
  responsavel: string;
  abertura: string;
  prazo: string | null;
  requirementId?: string;
}

export type ActionStatus =
  | "nao_iniciada"
  | "em_andamento"
  | "aguardando_evidencia"
  | "concluida";

export interface CorrectiveAction {
  id: string;
  codigo: string;
  titulo: string;
  ncId: string | null;
  siloId: string | null;
  responsavel: string;
  prazo: string | null;
  prioridade: Criticidade;
  status: ActionStatus;
  evidenciaConclusaoId: string | null;
  observacoes: string;
  concluidaEm: string | null;
}

export interface Evidence {
  id: string;
  nome: string;
  tipo: "foto" | "documento" | "registro";
  dataUrl?: string;
  data: string;
  responsavel: string;
  requirementId: string | null;
  siloId: string | null;
  inspectionId: string | null;
  descricao: string;
}

export interface AuditEntry {
  id: string;
  data: string;
  usuario: string;
  evento: string;
  objeto: string;
  objetoId: string;
  resumo: string;
}

export interface Settings {
  unidadeNome: string;
  unidadeLocal: string;
  janelaVencimentoDias: number;
  responsaveis: string[];
  tourConcluido: boolean;
}

export interface AppState {
  version: number;
  settings: Settings;
  silos: Silo[];
  requirements: Requirement[];
  documents: StoredDocument[];
  inspections: Inspection[];
  nonconformities: Nonconformity[];
  actions: CorrectiveAction[];
  evidence: Evidence[];
  audit: AuditEntry[];
}
