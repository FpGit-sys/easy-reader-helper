import { describe, expect, it } from "vitest";
import {
  calculateReadinessIndex,
  runDocumentExpirationRule,
  runInspectionDueRule,
  runMissingEvidenceRule,
  runOverdueActionRule,
  suggestPriority,
} from "@/lib/rules";
import { requirementSchema } from "@/components/compliance/NewRequirementForm";
import { buildDemoState } from "@/data/demo/demoData";
import type { CorrectiveAction, Requirement, Silo, StoredDocument } from "@/types";

const REF = new Date("2026-08-22T12:00:00Z");

function req(partial: Partial<Requirement>): Requirement {
  return {
    id: "r",
    codigo: "REQ-001",
    titulo: "Critério",
    descricao: "Critério interno demonstrativo",
    categoria: "Documentação",
    aplicavel: true,
    criticidade: "media",
    status: "atendido",
    responsavel: "Gestor Demo",
    prazo: null,
    siloIds: [],
    evidenciaObrigatoria: false,
    evidencias: [],
    comentarios: [],
    historico: [],
    fonteTipo: "interno",
    fonteNome: "Critério fictício para demonstração",
    fonteVerificada: false,
    ...partial,
  };
}

describe("índice de prontidão", () => {
  it("calcula 37/52 = 71,1538% e exibe 71%", () => {
    const items = [
      ...Array.from({ length: 37 }, (_, i) => req({ id: `a${i}`, status: "atendido" })),
      ...Array.from({ length: 11 }, (_, i) => req({ id: `p${i}`, status: "pendente" })),
      ...Array.from({ length: 4 }, (_, i) => req({ id: `c${i}`, status: "critico" })),
    ];
    const r = calculateReadinessIndex(items);
    expect(r.totalAplicaveis).toBe(52);
    expect(r.percentExato).toBeCloseTo(71.1538, 3);
    expect(r.percent).toBe(71);
  });

  it("remove itens não aplicáveis do denominador", () => {
    const items = [
      req({ id: "1", status: "atendido" }),
      req({ id: "2", status: "pendente" }),
      req({ id: "3", status: "nao_aplicavel", aplicavel: false }),
    ];
    const r = calculateReadinessIndex(items);
    expect(r.totalAplicaveis).toBe(2);
    expect(r.percent).toBe(50);
  });
});

describe("dados demonstrativos", () => {
  it("possui 5 silos e 52 critérios com 37/11/4", () => {
    const state = buildDemoState();
    expect(state.silos).toHaveLength(5);
    expect(state.requirements).toHaveLength(52);
    const r = calculateReadinessIndex(state.requirements);
    expect(r.atendidos).toBe(37);
    expect(r.pendentes).toBe(11);
    expect(r.criticos).toBe(4);
    expect(r.percent).toBe(71);
  });
});

describe("regra de documento", () => {
  const base: StoredDocument = {
    id: "d",
    nome: "Registro interno",
    categoria: "Documentação",
    siloId: null,
    responsavel: "Gestor Demo",
    emissao: "2025-01-01",
    validade: null,
  };

  it("marca vencido quando a validade é anterior a hoje", () => {
    const r = runDocumentExpirationRule({ ...base, validade: "2026-08-05" }, 30, REF);
    expect(r.status).toBe("vencido");
  });

  it("marca vence em breve dentro da janela de 30 dias", () => {
    const r = runDocumentExpirationRule({ ...base, validade: "2026-09-10" }, 30, REF);
    expect(r.status).toBe("vence_em_breve");
  });

  it("marca válido fora da janela e sem validade quando não informada", () => {
    expect(runDocumentExpirationRule({ ...base, validade: "2027-01-01" }, 30, REF).status).toBe(
      "valido",
    );
    expect(runDocumentExpirationRule(base, 30, REF).status).toBe("sem_validade");
  });
});

describe("regra de ação atrasada", () => {
  const action: CorrectiveAction = {
    id: "a",
    codigo: "AC-001",
    titulo: "Ação",
    ncId: null,
    siloId: null,
    responsavel: "Gestor Demo",
    prazo: "2026-08-01",
    prioridade: "alta",
    status: "em_andamento",
    evidenciaConclusaoId: null,
    observacoes: "",
    concluidaEm: null,
  };


  it("detecta atraso e classifica prioridade alta como crítico", () => {
    const r = runOverdueActionRule(action, REF);
    expect(r.atrasada).toBe(true);
    expect(r.diasAtraso).toBe(21);
    expect(r.finding?.severidade).toBe("critico");
  });

  it("não considera atrasada uma ação concluída", () => {
    expect(runOverdueActionRule({ ...action, status: "concluida" }, REF).atrasada).toBe(false);
  });
});

describe("evidência obrigatória e inspeção interna", () => {
  it("aponta evidência obrigatória ausente", () => {
    const findings = runMissingEvidenceRule([
      req({ id: "x", evidenciaObrigatoria: true, evidencias: [], criticidade: "alta" }),
      req({ id: "y", evidenciaObrigatoria: true, evidencias: ["ev1"] }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severidade).toBe("critico");
  });

  it("detecta inspeção fora da periodicidade interna cadastrada", () => {
    const silo: Silo = {
      id: "s3",
      nome: "Silo 03",
      capacidadeToneladas: 5000,
      tipo: "Metálico",
      periodicidadeInspecaoDias: 90,
      ultimaInspecao: "2026-04-20",
      observacao: "",
    };
    const r = runInspectionDueRule(silo, REF);
    expect(r.foraDaPeriodicidade).toBe(true);
    expect(r.diasDesdeUltima).toBe(124);
    expect(r.atrasoDias).toBe(34);
  });
});

describe("sugestão determinística de prioridade", () => {
  it("classifica como alta quando há criticidade alta, prazo vencido e evidência ausente", () => {
    const r = suggestPriority({
      criticidade: "alta",
      prazoVencido: true,
      evidenciaObrigatoriaAusente: true,
      documentoVencido: false,
    });
    expect(r.prioridade).toBe("alta");
    expect(r.motivos.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validação de fonte normativa", () => {
  const base = {
    titulo: "Critério interno de teste",
    descricao: "Descrição suficientemente longa do critério.",
    categoria: "Documentação",
    criticidade: "media" as const,
    aplicavel: true,
    evidenciaObrigatoria: false,
    responsavel: "Gestor Demo",
  };

  it("aceita critério interno sem campos de fonte", () => {
    expect(requirementSchema.safeParse({ ...base, fonteTipo: "interno" }).success).toBe(true);
  });

  it("rejeita norma externa verificada sem fonte completa", () => {
    const r = requirementSchema.safeParse({
      ...base,
      fonteTipo: "externa_verificada",
      fonteNome: "Norma X",
    });
    expect(r.success).toBe(false);
  });
});
