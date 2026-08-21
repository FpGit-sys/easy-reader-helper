import { format } from "date-fns";
import { DEMO_USER } from "@/data/demo/demoData";
import { logAudit, newId, nextCode, setState } from "@/lib/storage/store";
import type {
  CorrectiveAction,
  Criticidade,
  Evidence,
  Inspection,
  Nonconformity,
  Requirement,
  StoredDocument,
} from "@/types";

const hoje = () => format(new Date(), "yyyy-MM-dd");

export function addEvidence(input: {
  nome: string;
  tipo: Evidence["tipo"];
  dataUrl?: string;
  descricao?: string;
  requirementId?: string | null;
  siloId?: string | null;
  inspectionId?: string | null;
}) {
  const id = newId("evd");
  setState((s) => ({
    ...s,
    evidence: [
      {
        id,
        nome: input.nome,
        tipo: input.tipo,
        dataUrl: input.dataUrl,
        data: hoje(),
        responsavel: DEMO_USER,
        requirementId: input.requirementId ?? null,
        siloId: input.siloId ?? null,
        inspectionId: input.inspectionId ?? null,
        descricao: input.descricao ?? "",
      },
      ...s.evidence,
    ],
    requirements: s.requirements.map((r) =>
      r.id === input.requirementId ? { ...r, evidencias: [...r.evidencias, id] } : r,
    ),
  }));
  logAudit({
    evento: "Evidência adicionada",
    objeto: "Evidência",
    objetoId: id,
    resumo: input.nome,
  });
  return id;
}

export function updateRequirement(id: string, patch: Partial<Requirement>, resumo: string) {
  setState((s) => ({
    ...s,
    requirements: s.requirements.map((r) =>
      r.id === id
        ? {
            ...r,
            ...patch,
            historico: [
              ...r.historico,
              { id: newId("hist"), data: hoje(), texto: resumo },
            ],
          }
        : r,
    ),
  }));
  logAudit({ evento: "Status alterado", objeto: "Requisito", objetoId: id, resumo });
}

export function addRequirement(req: Omit<Requirement, "id" | "codigo" | "historico" | "comentarios" | "evidencias">) {
  setState((s) => {
    const codigo = nextCode("REQ", s.requirements.map((r) => ({ codigo: r.codigo })));
    const id = newId("req");
    return {
      ...s,
      requirements: [
        ...s.requirements,
        {
          ...req,
          id,
          codigo,
          evidencias: [],
          comentarios: [],
          historico: [{ id: newId("hist"), data: hoje(), texto: "Critério cadastrado." }],
        },
      ],
    };
  });
  logAudit({
    evento: "Configuração alterada",
    objeto: "Requisito",
    objetoId: req.titulo,
    resumo: `Novo critério cadastrado: ${req.titulo}`,
  });
}

export function addComment(requirementId: string, texto: string) {
  setState((s) => ({
    ...s,
    requirements: s.requirements.map((r) =>
      r.id === requirementId
        ? {
            ...r,
            comentarios: [
              ...r.comentarios,
              { id: newId("cmt"), autor: DEMO_USER, texto, data: new Date().toISOString() },
            ],
          }
        : r,
    ),
  }));
}

export function createNonconformity(input: {
  titulo: string;
  descricao?: string;
  siloId?: string | null;
  origem?: string;
  criticidade: Criticidade;
  responsavel: string;
  prazo?: string | null;
  requirementId?: string;
}) {
  const id = newId("nc");
  let codigo = "";
  setState((s) => {
    codigo = nextCode("NC", s.nonconformities);
    const nc: Nonconformity = {
      id,
      codigo,
      titulo: input.titulo,
      descricao: input.descricao ?? input.titulo,
      siloId: input.siloId ?? null,
      origem: input.origem ?? "Registro manual",
      criticidade: input.criticidade,
      status: "aberta",
      responsavel: input.responsavel,
      abertura: hoje(),
      prazo: input.prazo ?? null,
      requirementId: input.requirementId,
    };
    return { ...s, nonconformities: [nc, ...s.nonconformities] };
  });
  logAudit({ evento: "Pendência criada", objeto: "Não conformidade", objetoId: codigo, resumo: input.titulo });
  return id;
}

export function updateNonconformity(id: string, patch: Partial<Nonconformity>) {
  setState((s) => ({
    ...s,
    nonconformities: s.nonconformities.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  }));
  logAudit({ evento: "Status alterado", objeto: "Não conformidade", objetoId: id, resumo: "Pendência atualizada." });
}

export function createAction(input: {
  titulo: string;
  ncId?: string | null;
  siloId?: string | null;
  responsavel: string;
  prazo?: string | null;
  prioridade: Criticidade;
  observacoes?: string;
}) {
  const id = newId("act");
  let codigo = "";
  setState((s) => {
    codigo = nextCode("AC", s.actions);
    const action: CorrectiveAction = {
      id,
      codigo,
      titulo: input.titulo,
      ncId: input.ncId ?? null,
      siloId: input.siloId ?? null,
      responsavel: input.responsavel,
      prazo: input.prazo ?? null,
      prioridade: input.prioridade,
      status: "nao_iniciada",
      evidenciaConclusaoId: null,
      observacoes: input.observacoes ?? "",
      concluidaEm: null,
    };
    return { ...s, actions: [action, ...s.actions] };
  });
  logAudit({ evento: "Ação criada", objeto: "Ação corretiva", objetoId: codigo, resumo: input.titulo });
  return id;
}

export function updateAction(id: string, patch: Partial<CorrectiveAction>) {
  setState((s) => ({
    ...s,
    actions: s.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  }));
}

export function completeAction(id: string, evidenciaId: string | null) {
  setState((s) => ({
    ...s,
    actions: s.actions.map((a) =>
      a.id === id
        ? { ...a, status: "concluida", concluidaEm: hoje(), evidenciaConclusaoId: evidenciaId }
        : a,
    ),
  }));
  logAudit({ evento: "Ação concluída", objeto: "Ação corretiva", objetoId: id, resumo: "Ação marcada como concluída." });
}

export function reopenAction(id: string) {
  setState((s) => ({
    ...s,
    actions: s.actions.map((a) =>
      a.id === id ? { ...a, status: "em_andamento", concluidaEm: null } : a,
    ),
  }));
  logAudit({ evento: "Status alterado", objeto: "Ação corretiva", objetoId: id, resumo: "Ação reaberta." });
}

export function saveDocument(doc: StoredDocument, isNew: boolean) {
  setState((s) => ({
    ...s,
    documents: isNew ? [doc, ...s.documents] : s.documents.map((d) => (d.id === doc.id ? doc : d)),
  }));
  logAudit({
    evento: isNew ? "Documento cadastrado" : "Documento alterado",
    objeto: "Documento",
    objetoId: doc.id,
    resumo: doc.nome,
  });
}

export function deleteDocument(id: string) {
  setState((s) => ({ ...s, documents: s.documents.filter((d) => d.id !== id) }));
  logAudit({ evento: "Documento alterado", objeto: "Documento", objetoId: id, resumo: "Documento excluído." });
}

export function saveInspection(inspection: Inspection) {
  setState((s) => {
    const exists = s.inspections.some((i) => i.id === inspection.id);
    const inspections = exists
      ? s.inspections.map((i) => (i.id === inspection.id ? inspection : i))
      : [inspection, ...s.inspections];
    const requirements =
      inspection.status === "concluida"
        ? s.requirements.map((r) => {
            const item = inspection.itens.find((it) => it.requirementId === r.id);
            if (!item) return r;
            const status =
              item.resultado === "nao_aplicavel"
                ? ("nao_aplicavel" as const)
                : item.resultado === "atendido"
                  ? ("atendido" as const)
                  : r.criticidade === "alta"
                    ? ("critico" as const)
                    : ("pendente" as const);
            return {
              ...r,
              status,
              aplicavel: item.resultado !== "nao_aplicavel",
              historico: [
                ...r.historico,
                {
                  id: newId("hist"),
                  data: hoje(),
                  texto: `Atualizado pela inspeção ${inspection.codigo}.`,
                },
              ],
            };
          })
        : s.requirements;
    const silos =
      inspection.status === "concluida"
        ? s.silos.map((si) =>
            si.id === inspection.siloId ? { ...si, ultimaInspecao: inspection.data } : si,
          )
        : s.silos;
    return { ...s, inspections, requirements, silos };
  });
  logAudit({
    evento: inspection.status === "concluida" ? "Inspeção concluída" : "Inspeção iniciada",
    objeto: "Inspeção",
    objetoId: inspection.codigo,
    resumo: `${inspection.tipo} — ${inspection.siloId}`,
  });
}

export function nextInspectionCode(existing: { codigo: string }[]) {
  return nextCode("INSP", existing);
}

/** Reduz a foto antes de guardar localmente (evita estourar o armazenamento do navegador). */
export function fileToDataUrl(file: File, maxSize = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(String(reader.result));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = () => reject(new Error("Arquivo de imagem inválido."));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}
