import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import {
  actionsWithStatus,
  documentsWithStatus,
  readiness,
  siloStats,
} from "@/lib/calculations/derive";
import { DISCLAIMER_PDF, fmtDate, STATUS_DOC_LABEL, STATUS_REQ_LABEL } from "@/lib/formatting";
import type { AppState } from "@/types";

export interface DossierOptions {
  siloIds: string[];
  incluirRequisitos: boolean;
  incluirDocumentos: boolean;
  incluirInspecoes: boolean;
  incluirPendencias: boolean;
  incluirAcoes: boolean;
  incluirEvidencias: boolean;
  incluirHistorico: boolean;
}

export const DEFAULT_DOSSIER_OPTIONS: DossierOptions = {
  siloIds: [],
  incluirRequisitos: true,
  incluirDocumentos: true,
  incluirInspecoes: true,
  incluirPendencias: true,
  incluirAcoes: true,
  incluirEvidencias: true,
  incluirHistorico: true,
};

function sectionTitle(doc: jsPDF, text: string, y: number) {
  doc.setFontSize(12);
  doc.setTextColor(31, 41, 38);
  doc.text(text, 14, y);
  return y + 4;
}

function lastY(doc: jsPDF, fallback: number) {
  const table = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return (table?.finalY ?? fallback) + 10;
}

export function generateDossier(state: AppState, options: DossierOptions) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const geradoEm = format(new Date(), "dd/MM/yyyy HH:mm");
  const silos = state.silos.filter(
    (s) => options.siloIds.length === 0 || options.siloIds.includes(s.id),
  );
  const siloIds = silos.map((s) => s.id);
  const idx = readiness(state);

  // Capa
  doc.setFontSize(22);
  doc.text("Dossiê de prontidão", 14, 40);
  doc.setFontSize(14);
  doc.text(state.settings.unidadeNome, 14, 50);
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(state.settings.unidadeLocal, 14, 57);
  doc.text(`Gerado em ${geradoEm} por Gestor Demo`, 14, 64);
  doc.text(`Silos incluídos: ${silos.map((s) => s.nome).join(", ") || "todos"}`, 14, 71);
  doc.text(`Índice de prontidão interno: ${idx.percent}%`, 14, 78);
  doc.setFontSize(9);
  doc.text(doc.splitTextToSize(DISCLAIMER_PDF, 180), 14, 95);

  // Sumário executivo
  doc.addPage();
  let y = sectionTitle(doc, "Sumário executivo", 20);
  autoTable(doc, {
    startY: y,
    head: [["Indicador", "Valor"]],
    body: [
      ["Critérios aplicáveis", String(idx.aplicaveis)],
      ["Atendidos", String(idx.atendidos)],
      ["Pendentes", String(idx.pendentes)],
      ["Críticos", String(idx.criticos)],
      ["Índice de prontidão", `${idx.percent}%`],
      [
        "Documentos vencidos",
        String(documentsWithStatus(state).filter((d) => d.status === "vencido").length),
      ],
      ["Ações atrasadas", String(actionsWithStatus(state).filter((a) => a.atrasada).length)],
    ],
    theme: "grid",
    styles: { fontSize: 9 },
  });
  y = lastY(doc, y);

  autoTable(doc, {
    startY: y,
    head: [["Silo", "Prontidão", "Críticos", "Docs vencidos", "Última inspeção"]],
    body: silos.map((s) => {
      const st = siloStats(state, s.id);
      return [
        s.nome,
        `${st.index.percent}%`,
        String(st.index.criticos),
        String(st.documentosVencidos),
        fmtDate(s.ultimaInspecao),
      ];
    }),
    theme: "striped",
    styles: { fontSize: 9 },
  });

  const inScope = <T extends { siloId?: string | null }>(rows: T[]) =>
    siloIds.length === state.silos.length
      ? rows
      : rows.filter((r) => !r.siloId || siloIds.includes(r.siloId));

  if (options.incluirRequisitos) {
    doc.addPage();
    y = sectionTitle(doc, "Matriz de critérios internos", 20);
    autoTable(doc, {
      startY: y,
      head: [["Código", "Título", "Categoria", "Criticidade", "Status", "Responsável", "Prazo"]],
      body: state.requirements
        .filter((r) => r.siloIds.some((id) => siloIds.includes(id)))
        .map((r) => [
          r.codigo,
          r.titulo,
          r.categoria,
          r.criticidade,
          STATUS_REQ_LABEL[r.status] ?? r.status,
          r.responsavel,
          fmtDate(r.prazo),
        ]),
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 1.5 },
    });
  }

  if (options.incluirDocumentos) {
    doc.addPage();
    y = sectionTitle(doc, "Documentos e validades", 20);
    autoTable(doc, {
      startY: y,
      head: [["Documento", "Categoria", "Emissão", "Validade", "Status"]],
      body: inScope(documentsWithStatus(state)).map((d) => [
        d.nome,
        d.categoria,
        fmtDate(d.emissao),
        fmtDate(d.validade),
        STATUS_DOC_LABEL[d.status] ?? d.status,
      ]),
      theme: "striped",
      styles: { fontSize: 8 },
    });
  }

  if (options.incluirInspecoes) {
    doc.addPage();
    y = sectionTitle(doc, "Inspeções realizadas", 20);
    autoTable(doc, {
      startY: y,
      head: [["Código", "Data", "Silo", "Tipo", "Responsável", "Itens", "Status"]],
      body: state.inspections
        .filter((i) => siloIds.includes(i.siloId))
        .map((i) => [
          i.codigo,
          fmtDate(i.data),
          state.silos.find((s) => s.id === i.siloId)?.nome ?? "—",
          i.tipo,
          i.responsavel,
          String(i.itens.length),
          i.status === "concluida" ? "Concluída" : "Em andamento",
        ]),
      theme: "striped",
      styles: { fontSize: 8 },
    });
  }

  if (options.incluirPendencias) {
    doc.addPage();
    y = sectionTitle(doc, "Pendências identificadas", 20);
    autoTable(doc, {
      startY: y,
      head: [["Código", "Título", "Criticidade", "Status", "Responsável", "Prazo"]],
      body: inScope(state.nonconformities).map((n) => [
        n.codigo,
        n.titulo,
        n.criticidade,
        n.status,
        n.responsavel,
        fmtDate(n.prazo),
      ]),
      theme: "striped",
      styles: { fontSize: 8 },
    });
  }

  if (options.incluirAcoes) {
    doc.addPage();
    y = sectionTitle(doc, "Plano de ação", 20);
    autoTable(doc, {
      startY: y,
      head: [["Código", "Ação", "Responsável", "Prazo", "Prioridade", "Status"]],
      body: inScope(actionsWithStatus(state)).map((a) => [
        a.codigo,
        a.titulo,
        a.responsavel,
        fmtDate(a.prazo),
        a.prioridade,
        a.atrasada ? "Atrasada" : a.status,
      ]),
      theme: "striped",
      styles: { fontSize: 8 },
    });
  }

  if (options.incluirEvidencias) {
    doc.addPage();
    y = sectionTitle(doc, "Evidências anexadas", 20);
    autoTable(doc, {
      startY: y,
      head: [["Nome", "Tipo", "Data", "Responsável", "Descrição"]],
      body: inScope(state.evidence).map((e) => [
        e.nome,
        e.tipo,
        fmtDate(e.data),
        e.responsavel,
        e.descricao,
      ]),
      theme: "striped",
      styles: { fontSize: 8 },
    });
  }

  if (options.incluirHistorico) {
    doc.addPage();
    y = sectionTitle(doc, "Histórico de alterações", 20);
    autoTable(doc, {
      startY: y,
      head: [["Data", "Usuário", "Evento", "Objeto", "Resumo"]],
      body: state.audit
        .slice(0, 120)
        .map((a) => [
          format(new Date(a.data), "dd/MM/yyyy HH:mm"),
          a.usuario,
          a.evento,
          a.objeto,
          a.resumo,
        ]),
      theme: "striped",
      styles: { fontSize: 8 },
    });
  }

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `SiloNR — documento interno demonstrativo · página ${i}/${total} · gerado em ${geradoEm}`,
      14,
      290,
    );
  }

  return doc;
}

export function downloadDossier(state: AppState, options: DossierOptions) {
  const doc = generateDossier(state, options);
  doc.save(`dossie-prontidao-${format(new Date(), "yyyy-MM-dd")}.pdf`);
}
