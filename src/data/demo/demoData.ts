import { addDays, format, subDays } from "date-fns";
import type {
  AppState,
  CorrectiveAction,
  Criticidade,
  Evidence,
  Inspection,
  Nonconformity,
  Requirement,
  Silo,
  StoredDocument,
} from "@/types";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export const DEMO_USER = "Gestor Demo";

export const RESPONSAVEIS = [
  "Carlos Mendes (fictício)",
  "Ana Barreto (fictícia)",
  "Rogério Lima (fictício)",
  "Patrícia Souza (fictícia)",
  "Marcos Tavares (fictício)",
];

export const CATEGORIAS = [
  "Documentação",
  "Registros",
  "Inspeções",
  "Treinamentos",
  "Emergência",
  "Equipamentos",
  "Manutenção",
  "Acesso",
  "Sinalização",
  "Evidências",
  "Procedimentos internos",
  "Ações corretivas",
];

/** Títulos fictícios de critérios internos, agrupados por categoria (52 no total). */
const TITULOS: { categoria: string; titulo: string }[] = [
  ["Documentação", "Cadastro atualizado da unidade armazenadora"],
  ["Documentação", "Relação interna de documentos obrigatórios definida"],
  ["Documentação", "Contrato de manutenção de equipamentos arquivado"],
  ["Documentação", "Apólice de seguro patrimonial arquivada"],
  ["Documentação", "Laudo interno de estrutura arquivado"],
  ["Registros", "Registro interno de temperatura de massa de grãos"],
  ["Registros", "Registro interno de umidade por silo"],
  ["Registros", "Registro de expurgo controlado internamente"],
  ["Registros", "Livro interno de ocorrências operacionais"],
  ["Registros", "Registro de limpeza periódica de moegas"],
  ["Inspeções", "Inspeção interna periódica do silo cadastrada"],
  ["Inspeções", "Inspeção interna de correias e elevadores"],
  ["Inspeções", "Inspeção interna de aeração e termometria"],
  ["Inspeções", "Inspeção interna de escadas e guarda-corpos"],
  ["Inspeções", "Checklist interno de pré-safra concluído"],
  ["Treinamentos", "Registro de treinamento interno de espaço confinado"],
  ["Treinamentos", "Registro de treinamento interno de combate a princípio de incêndio"],
  ["Treinamentos", "Registro de integração de novos colaboradores"],
  ["Treinamentos", "Lista de presença de treinamento arquivada"],
  ["Emergência", "Plano interno de resposta a emergências documentado"],
  ["Emergência", "Simulado interno de evacuação registrado"],
  ["Emergência", "Rotas de fuga verificadas internamente"],
  ["Emergência", "Contatos de emergência atualizados"],
  ["Equipamentos", "Inventário interno de equipamentos críticos"],
  ["Equipamentos", "Verificação interna de sistemas de aeração"],
  ["Equipamentos", "Verificação interna de exaustores e ventiladores"],
  ["Equipamentos", "Verificação interna de dispositivos de bloqueio"],
  ["Equipamentos", "Controle interno de EPIs distribuídos"],
  ["Manutenção", "Plano interno de manutenção preventiva cadastrado"],
  ["Manutenção", "Ordens de manutenção corretiva registradas"],
  ["Manutenção", "Registro de lubrificação de transportadores"],
  ["Manutenção", "Histórico de manutenção do sistema de termometria"],
  ["Acesso", "Controle interno de acesso a áreas restritas"],
  ["Acesso", "Permissão interna para trabalho em altura registrada"],
  ["Acesso", "Permissão interna para espaço confinado registrada"],
  ["Acesso", "Registro de visitantes na unidade"],
  ["Sinalização", "Sinalização interna de áreas de risco verificada"],
  ["Sinalização", "Identificação interna dos silos e células"],
  ["Sinalização", "Sinalização de rotas de circulação de veículos"],
  ["Sinalização", "Placas de advertência de poeira combustível"],
  ["Evidências", "Registro fotográfico da inspeção interna arquivado"],
  ["Evidências", "Evidência de conclusão de manutenção anexada"],
  ["Evidências", "Evidência de treinamento anexada"],
  ["Evidências", "Evidência de limpeza de silo anexada"],
  ["Evidências", "Evidência de teste de sistema de emergência anexada"],
  ["Procedimentos internos", "Procedimento interno de operação de silo documentado"],
  ["Procedimentos internos", "Procedimento interno de bloqueio e etiquetagem"],
  ["Procedimentos internos", "Procedimento interno de limpeza e controle de poeira"],
  ["Procedimentos internos", "Procedimento interno de recebimento de carga"],
  ["Ações corretivas", "Fluxo interno de tratamento de pendências definido"],
  ["Ações corretivas", "Prazos internos de ação corretiva monitorados"],
  ["Ações corretivas", "Verificação de eficácia de ação corretiva registrada"],
].map(([categoria, titulo]) => ({ categoria, titulo }));

const PENDENTES = [1, 7, 12, 18, 22, 27, 31, 35, 39, 44, 49];
const CRITICOS = [10, 20, 40, 45];

export function buildDemoState(): AppState {
  const hoje = new Date();

  const silos: Silo[] = [
    {
      id: "silo-01",
      nome: "Silo 01",
      capacidadeToneladas: 8000,
      tipo: "Silo metálico",
      periodicidadeInspecaoDias: 90,
      ultimaInspecao: iso(subDays(hoje, 18)),
      observacao: "Operação normal registrada pela equipe interna.",
    },
    {
      id: "silo-02",
      nome: "Silo 02",
      capacidadeToneladas: 10000,
      tipo: "Silo metálico",
      periodicidadeInspecaoDias: 90,
      ultimaInspecao: iso(subDays(hoje, 61)),
      observacao: "Pendências de registro em acompanhamento.",
    },
    {
      id: "silo-03",
      nome: "Silo 03",
      capacidadeToneladas: 12000,
      tipo: "Silo metálico",
      periodicidadeInspecaoDias: 90,
      ultimaInspecao: iso(subDays(hoje, 124)),
      observacao: "Concentra o maior número de itens que exigem atenção.",
    },
    {
      id: "silo-04",
      nome: "Silo 04",
      capacidadeToneladas: 9000,
      tipo: "Silo de concreto",
      periodicidadeInspecaoDias: 120,
      ultimaInspecao: iso(subDays(hoje, 47)),
      observacao: "Itens de manutenção em tratativa interna.",
    },
    {
      id: "silo-05",
      nome: "Silo 05",
      capacidadeToneladas: 7000,
      tipo: "Silo metálico",
      periodicidadeInspecaoDias: 90,
      ultimaInspecao: iso(subDays(hoje, 25)),
      observacao: "Operação normal registrada pela equipe interna.",
    },
  ];

  const requirements: Requirement[] = TITULOS.map((t, i) => {
    const isCritico = CRITICOS.includes(i);
    const isPendente = PENDENTES.includes(i);
    const status = isCritico ? "critico" : isPendente ? "pendente" : "atendido";
    const criticidade: Criticidade = isCritico ? "alta" : isPendente ? "media" : i % 3 === 0 ? "media" : "baixa";
    const siloIds = isCritico
      ? ["silo-03"]
      : isPendente
        ? [silos[(i % 4) + 1].id]
        : [silos[i % 5].id];

    return {
      id: `req-${String(i + 1).padStart(3, "0")}`,
      codigo: `REQ-${String(i + 1).padStart(3, "0")}`,
      titulo: t.titulo,
      descricao: `Critério interno demonstrativo referente a "${t.titulo.toLowerCase()}". Descreve o que a organização definiu como controle interno para esta unidade fictícia, incluindo o registro esperado e a evidência associada.`,
      categoria: t.categoria,
      aplicavel: true,
      criticidade,
      status,
      responsavel: RESPONSAVEIS[i % RESPONSAVEIS.length],
      prazo:
        status === "atendido"
          ? iso(addDays(hoje, 60 + (i % 40)))
          : status === "pendente"
            ? iso(addDays(hoje, 10 + (i % 15)))
            : iso(subDays(hoje, 8 + (i % 20))),
      siloIds,
      evidenciaObrigatoria: i % 2 === 0 || isCritico,
      evidencias: [],
      comentarios: [],
      historico: [
        {
          id: `hist-${i}-1`,
          data: iso(subDays(hoje, 30 + (i % 60))),
          texto: "Critério cadastrado no ambiente demonstrativo.",
        },
      ],
      fonteTipo: "interno",
      fonteNome: "Critério fictício para demonstração",
      fonteReferencia: "CRITÉRIO INTERNO DEMONSTRATIVO",
      fonteVerificada: false,
    } satisfies Requirement;
  });

  const documents: StoredDocument[] = [
    // 3 vencidos
    doc("doc-001", "Laudo interno de estrutura — Silo 03", "Documentação", "silo-03", 0, iso(subDays(hoje, 17)), hoje, 400),
    doc("doc-002", "Registro interno de manutenção de aeração", "Manutenção", "silo-02", 1, iso(subDays(hoje, 41)), hoje, 380),
    doc("doc-003", "Certificado interno de treinamento de brigada", "Treinamentos", null, 2, iso(subDays(hoje, 6)), hoje, 370),
    // 5 vencendo em até 30 dias
    doc("doc-004", "Plano interno de emergência da unidade", "Emergência", null, 3, iso(addDays(hoje, 9)), hoje, 350),
    doc("doc-005", "Contrato de manutenção de elevadores", "Manutenção", "silo-01", 4, iso(addDays(hoje, 14)), hoje, 340),
    doc("doc-006", "Apólice de seguro patrimonial", "Documentação", null, 0, iso(addDays(hoje, 21)), hoje, 330),
    doc("doc-007", "Registro interno de expurgo — Silo 04", "Registros", "silo-04", 1, iso(addDays(hoje, 27)), hoje, 300),
    doc("doc-008", "Checklist interno de pré-safra", "Inspeções", "silo-05", 2, iso(addDays(hoje, 30)), hoje, 290),
    // válidos
    doc("doc-009", "Procedimento interno de espaço confinado", "Procedimentos internos", null, 3, iso(addDays(hoje, 120)), hoje, 240),
    doc("doc-010", "Inventário interno de equipamentos críticos", "Equipamentos", null, 4, iso(addDays(hoje, 180)), hoje, 210),
    doc("doc-011", "Registro de limpeza de moegas", "Registros", "silo-02", 0, iso(addDays(hoje, 95)), hoje, 150),
    doc("doc-012", "Mapa interno de sinalização da unidade", "Sinalização", null, 1, null, hoje, 300),
  ];

  const inspections: Inspection[] = [
    inspection("insp-001", "INSP-001", 124, "silo-03", "Inspeção interna periódica", 0, requirements),
    inspection("insp-002", "INSP-002", 61, "silo-02", "Inspeção interna periódica", 1, requirements),
    inspection("insp-003", "INSP-003", 47, "silo-04", "Inspeção interna de manutenção", 2, requirements),
    inspection("insp-004", "INSP-004", 25, "silo-05", "Inspeção interna periódica", 3, requirements),
    inspection("insp-005", "INSP-005", 18, "silo-01", "Inspeção interna periódica", 4, requirements),
  ].map((i) => ({ ...i, data: iso(subDays(hoje, Number(i.data))) }));

  const nonconformities: Nonconformity[] = [
    nc("nc-001", "NC-001", "Registro interno de umidade incompleto", "silo-02", "media", 26, 4, 1, requirements[7].id),
    nc("nc-002", "NC-002", "Sinalização de área de risco ilegível", "silo-04", "media", 33, 9, 2, requirements[36].id),
    nc("nc-003", "NC-003", "Evidência obrigatória não anexada", "silo-03", "alta", 48, -21, 0, requirements[40].id),
    nc("nc-004", "NC-004", "Inspeção interna fora da periodicidade cadastrada", "silo-03", "alta", 34, -12, 0, requirements[10].id),
    nc("nc-005", "NC-005", "Procedimento interno desatualizado", null, "baixa", 15, 20, 3, requirements[45].id),
    nc("nc-006", "NC-006", "Registro de treinamento sem lista de presença", null, "media", 19, 6, 1, requirements[18].id),
  ].map((n) => ({
    ...n,
    abertura: iso(subDays(hoje, Number(n.abertura))),
    prazo: n.prazo === null ? null : iso(addDays(hoje, Number(n.prazo))),
  }));

  const actions: CorrectiveAction[] = [
    act("act-001", "AC-001", "Anexar evidência fotográfica da inspeção do Silo 03", "nc-003", "silo-03", 0, -21, "alta", "aguardando_evidencia"),
    act("act-002", "AC-002", "Reprogramar inspeção interna do Silo 03", "nc-004", "silo-03", 0, -12, "alta", "em_andamento"),
    act("act-003", "AC-003", "Substituir placas de sinalização do Silo 04", "nc-002", "silo-04", 2, -5, "media", "nao_iniciada"),
    act("act-004", "AC-004", "Completar registros de umidade do Silo 02", "nc-001", "silo-02", 1, -3, "media", "em_andamento"),
    act("act-005", "AC-005", "Revisar procedimento interno de recebimento", "nc-005", null, 3, 18, "baixa", "em_andamento"),
    act("act-006", "AC-006", "Arquivar lista de presença de treinamento", "nc-006", null, 1, 7, "media", "nao_iniciada"),
    act("act-007", "AC-007", "Atualizar inventário de equipamentos críticos", null, "silo-01", 4, 40, "baixa", "concluida"),
  ].map((a) => ({
    ...a,
    prazo: a.prazo === null ? null : iso(addDays(hoje, Number(a.prazo))),
    concluidaEm: a.status === "concluida" ? iso(subDays(hoje, 5)) : null,
  }));

  const evidence: Evidence[] = [
    ev("evd-001", "Registro fotográfico — correia Silo 01", "foto", "silo-01", requirements[41].id, "insp-005", 18, 0),
    ev("evd-002", "Relatório interno de manutenção — Silo 04", "documento", "silo-04", requirements[29].id, "insp-003", 47, 2),
    ev("evd-003", "Registro de limpeza — Silo 05", "registro", "silo-05", requirements[9].id, "insp-004", 25, 3),
    ev("evd-004", "Registro fotográfico — aeração Silo 02", "foto", "silo-02", requirements[24].id, "insp-002", 61, 1),
  ].map((e) => ({ ...e, data: iso(subDays(hoje, Number(e.data))) }));

  requirements[41].evidencias = ["evd-001"];
  requirements[29].evidencias = ["evd-002"];
  requirements[9].evidencias = ["evd-003"];
  requirements[24].evidencias = ["evd-004"];

  const audit = [
    { evento: "Ambiente demonstrativo carregado", objeto: "Sistema", objetoId: "demo", resumo: "52 critérios internos, 5 silos e 12 documentos fictícios carregados.", d: 0 },
    { evento: "Inspeção concluída", objeto: "Inspeção", objetoId: "INSP-005", resumo: "Inspeção interna do Silo 01 concluída.", d: 18 },
    { evento: "Pendência criada", objeto: "Não conformidade", objetoId: "NC-003", resumo: "Evidência obrigatória não anexada no Silo 03.", d: 48 },
    { evento: "Documento cadastrado", objeto: "Documento", objetoId: "doc-001", resumo: "Laudo interno de estrutura do Silo 03 cadastrado.", d: 400 },
  ].map((a, i) => ({
    id: `aud-${i + 1}`,
    data: subDays(hoje, a.d).toISOString(),
    usuario: DEMO_USER,
    evento: a.evento,
    objeto: a.objeto,
    objetoId: a.objetoId,
    resumo: a.resumo,
  }));

  return {
    version: 1,
    settings: {
      unidadeNome: "Unidade Armazenadora Santa Rita",
      unidadeLocal: "Rio Verde - GO",
      janelaVencimentoDias: 30,
      responsaveis: RESPONSAVEIS,
      tourConcluido: false,
    },
    silos,
    requirements,
    documents,
    inspections,
    nonconformities,
    actions,
    evidence,
    audit,
  };
}

function doc(
  id: string,
  nome: string,
  categoria: string,
  siloId: string | null,
  respIdx: number,
  validade: string | null,
  hoje: Date,
  emissaoDiasAtras: number,
): StoredDocument {
  return {
    id,
    nome,
    categoria,
    siloId,
    responsavel: RESPONSAVEIS[respIdx],
    emissao: iso(subDays(hoje, emissaoDiasAtras)),
    validade,
    observacao: "Documento fictício de ambiente demonstrativo.",
  };
}

function inspection(
  id: string,
  codigo: string,
  diasAtras: number,
  siloId: string,
  tipo: string,
  respIdx: number,
  requirements: Requirement[],
): Inspection {
  const itens = requirements
    .filter((r) => r.siloIds.includes(siloId))
    .slice(0, 10)
    .map((r) => ({
      requirementId: r.id,
      resultado:
        r.status === "atendido" ? ("atendido" as const) : ("pendente" as const),
    }));
  return {
    id,
    codigo,
    data: String(diasAtras),
    siloId,
    tipo,
    responsavel: RESPONSAVEIS[respIdx],
    status: "concluida",
    itens,
    observacoes: "Inspeção interna fictícia registrada no ambiente demonstrativo.",
    evidencias: [],
    pendenciasGeradas: [],
  };
}

function nc(
  id: string,
  codigo: string,
  titulo: string,
  siloId: string | null,
  criticidade: Criticidade,
  abertura: number,
  prazo: number | null,
  respIdx: number,
  requirementId: string,
): Nonconformity {
  return {
    id,
    codigo,
    titulo,
    descricao: `${titulo}. Registro fictício gerado para o ambiente demonstrativo.`,
    siloId,
    origem: "Inspeção interna",
    criticidade,
    status: "aberta",
    responsavel: RESPONSAVEIS[respIdx],
    abertura: String(abertura),
    prazo: prazo as unknown as string | null,
    requirementId,
  };
}

function act(
  id: string,
  codigo: string,
  titulo: string,
  ncId: string | null,
  siloId: string | null,
  respIdx: number,
  prazo: number,
  prioridade: Criticidade,
  status: CorrectiveAction["status"],
): CorrectiveAction {
  return {
    id,
    codigo,
    titulo,
    ncId,
    siloId,
    responsavel: RESPONSAVEIS[respIdx],
    prazo: prazo as unknown as string,
    prioridade,
    status,
    evidenciaConclusaoId: null,
    observacoes: "Ação fictícia do ambiente demonstrativo.",
    concluidaEm: null,
  };
}

function ev(
  id: string,
  nome: string,
  tipo: Evidence["tipo"],
  siloId: string | null,
  requirementId: string | null,
  inspectionId: string | null,
  diasAtras: number,
  respIdx: number,
): Evidence {
  return {
    id,
    nome,
    tipo,
    data: String(diasAtras),
    responsavel: RESPONSAVEIS[respIdx],
    requirementId,
    siloId,
    inspectionId,
    descricao: "Evidência fictícia do ambiente demonstrativo.",
  };
}
