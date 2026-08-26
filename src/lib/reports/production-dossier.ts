import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { getProductionDossierData } from "@/server/operations/dossier.functions";

type DossierData = Awaited<ReturnType<typeof getProductionDossierData>>;

export interface ProductionDossierOptions {
  requirements: boolean;
  documents: boolean;
  inspections: boolean;
  nonconformities: boolean;
  actions: boolean;
  evidences: boolean;
  audit: boolean;
}

export const DEFAULT_PRODUCTION_DOSSIER_OPTIONS: ProductionDossierOptions = {
  requirements: true,
  documents: true,
  inspections: true,
  nonconformities: true,
  actions: true,
  evidences: true,
  audit: true,
};

function sectionTitle(doc: jsPDF, title: string, subtitle?: string) {
  doc.setFontSize(15);
  doc.setTextColor(30);
  doc.text(title, 14, 20);
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(95);
    doc.text(doc.splitTextToSize(subtitle, 180), 14, 27);
  }
  return subtitle ? 36 : 27;
}

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function dateOnly(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function sourceLabel(row: DossierData["requirements"][number]) {
  if (!row.sourceTitle) return row.sourceType === "interno" ? "Critério interno" : "Fonte não informada";
  return [row.sourceTitle, row.sourceIssuer, row.sourceVersion, row.sourceSection].filter(Boolean).join(" · ");
}

function reqStatus(value: string) {
  const labels: Record<string, string> = {
    atendido: "Atendido",
    pendente: "Pendente",
    critico: "Crítico",
    nao_aplicavel: "Não aplicável",
  };
  return labels[value] ?? value;
}

function lifecycle(value: string) {
  const labels: Record<string, string> = {
    rascunho: "Rascunho",
    em_revisao: "Em revisão",
    validado: "Validado",
    publicado: "Publicado",
    obsoleto: "Obsoleto",
  };
  return labels[value] ?? value;
}

function docStatus(value: string) {
  const labels: Record<string, string> = {
    valido: "Válido",
    vence_em_breve: "Vence em breve",
    vencido: "Vencido",
    sem_validade: "Sem validade",
  };
  return labels[value] ?? value;
}

function genericStatus(value: string) {
  return value.replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function bytes(value: number | null) {
  if (!value) return "—";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function generateProductionDossier(data: DossierData, options: ProductionDossierOptions) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const location = [data.facility.city, data.facility.state].filter(Boolean).join(" — ");

  doc.setFontSize(22);
  doc.setTextColor(25);
  doc.text("Dossiê de prontidão interna", 14, 36);
  doc.setFontSize(15);
  doc.text(data.organization.name, 14, 48);
  doc.setFontSize(12);
  doc.text(data.facility.name, 14, 57);
  doc.setFontSize(9);
  doc.setTextColor(95);
  if (location) doc.text(location, 14, 64);
  doc.text(`Gerado em ${dateTime(data.generatedAt)} por ${data.generatedBy.name}`, 14, 72);
  doc.text(`Escopo: ${data.silos.map((silo) => `${silo.code} — ${silo.name}`).join(", ") || "unidade"}`, 14, 79);
  doc.setFontSize(12);
  doc.setTextColor(35);
  doc.text(`Índice de prontidão interna: ${data.summary.readiness}%`, 14, 94);
  doc.setFontSize(9);
  doc.setTextColor(95);
  doc.text(doc.splitTextToSize(data.disclaimer, 180), 14, 106);

  doc.addPage();
  let y = sectionTitle(doc, "Sumário executivo", "Indicadores calculados exclusivamente a partir dos registros persistidos no escopo selecionado.");
  autoTable(doc, {
    startY: y,
    head: [["Indicador", "Valor"]],
    body: [
      ["Critérios aplicáveis", String(data.summary.applicable)],
      ["Atendidos", String(data.summary.attended)],
      ["Pendentes", String(data.summary.pending)],
      ["Críticos", String(data.summary.critical)],
      ["Índice de prontidão interna", `${data.summary.readiness}%`],
      ["Documentos vencidos", String(data.summary.documentsExpired)],
      ["Documentos vencendo em até 30 dias", String(data.summary.documentsExpiring)],
      ["Não conformidades abertas", String(data.summary.openNonconformities)],
      ["Ações corretivas atrasadas", String(data.summary.overdueActions)],
      ["Inspeções no escopo", String(data.summary.inspections)],
      ["Evidências registradas", String(data.summary.evidences)],
    ],
    theme: "grid",
    styles: { fontSize: 9 },
  });

  doc.addPage();
  y = sectionTitle(doc, "Silos incluídos");
  autoTable(doc, {
    startY: y,
    head: [["Código", "Silo", "Tipo", "Capacidade (t)", "Periodicidade interna"]],
    body: data.silos.map((silo) => [silo.code, silo.name, silo.type, String(silo.capacityTonnes), `${silo.inspectionPeriodDays} dias`]),
    theme: "striped",
    styles: { fontSize: 8 },
  });

  if (options.requirements) {
    doc.addPage();
    y = sectionTitle(doc, "Matriz de critérios e status", "O status representa a avaliação interna registrada no sistema e não uma declaração automática de conformidade legal.");
    autoTable(doc, {
      startY: y,
      head: [["Código", "Escopo", "Categoria", "Criticidade", "Status", "Versão", "Ciclo", "Fonte"]],
      body: data.requirements.map((row) => [
        row.code,
        row.siloName,
        row.category,
        genericStatus(row.severity ?? "—"),
        reqStatus(row.status),
        row.version ? `v${row.version}` : "—",
        lifecycle(row.lifecycle),
        sourceLabel(row),
      ]),
      theme: "striped",
      styles: { fontSize: 7, cellPadding: 1.4 },
      columnStyles: { 7: { cellWidth: 50 } },
    });
  }

  if (options.documents) {
    doc.addPage();
    y = sectionTitle(doc, "Documentos e validades");
    autoTable(doc, {
      startY: y,
      head: [["Documento", "Escopo", "Categoria", "Emissão", "Validade", "Status", "Versão", "SHA-256"]],
      body: data.documents.map((row) => [
        row.name,
        row.siloName,
        row.category,
        dateOnly(row.issuedAt),
        dateOnly(row.expiresAt),
        docStatus(row.status),
        row.version ? `v${row.version}` : "—",
        row.sha256 ? `${row.sha256.slice(0, 16)}…` : "—",
      ]),
      theme: "striped",
      styles: { fontSize: 7 },
    });
  }

  if (options.inspections) {
    doc.addPage();
    y = sectionTitle(doc, "Inspeções");
    autoTable(doc, {
      startY: y,
      head: [["Código", "Silo", "Tipo", "Início", "Conclusão", "Inspetor", "Itens", "Pend./crít.", "Status"]],
      body: data.inspections.map((row) => [
        row.code,
        row.siloName,
        row.type,
        dateTime(row.startedAt),
        dateTime(row.completedAt),
        row.inspectorName,
        String(row.itemCount),
        String(row.issueCount),
        genericStatus(row.status),
      ]),
      theme: "striped",
      styles: { fontSize: 7 },
    });
  }

  if (options.nonconformities) {
    doc.addPage();
    y = sectionTitle(doc, "Não conformidades");
    autoTable(doc, {
      startY: y,
      head: [["Código", "Pendência", "Silo", "Criticidade", "Status", "Responsável", "Prazo", "Resolução"]],
      body: data.nonconformities.map((row) => [
        row.code,
        row.title,
        row.siloName,
        genericStatus(row.severity),
        genericStatus(row.status),
        row.responsibleName,
        dateOnly(row.dueAt),
        dateTime(row.resolvedAt),
      ]),
      theme: "striped",
      styles: { fontSize: 7 },
    });
  }

  if (options.actions) {
    doc.addPage();
    y = sectionTitle(doc, "Ações corretivas");
    autoTable(doc, {
      startY: y,
      head: [["Código", "Ação", "Silo", "Prioridade", "Status", "Responsável", "Prazo", "Evidências", "Conclusão"]],
      body: data.actions.map((row) => [
        row.code,
        row.title,
        row.siloName,
        genericStatus(row.priority),
        genericStatus(row.status),
        row.responsibleName,
        dateOnly(row.dueAt),
        String(row.evidenceCount),
        dateTime(row.completedAt),
      ]),
      theme: "striped",
      styles: { fontSize: 7 },
    });
  }

  if (options.evidences) {
    doc.addPage();
    y = sectionTitle(doc, "Índice de evidências", "Hashes ajudam a detectar alteração de conteúdo, mas não equivalem, por si só, a assinatura digital ou prova jurídica de autenticidade.");
    autoTable(doc, {
      startY: y,
      head: [["Evidência", "Tipo", "Silo", "Capturada em", "Responsável", "Tamanho", "SHA-256"]],
      body: data.evidences.map((row) => [
        row.name,
        genericStatus(row.type),
        row.siloName,
        dateTime(row.capturedAt),
        row.capturedByName,
        bytes(row.sizeBytes),
        row.sha256 ?? "—",
      ]),
      theme: "striped",
      styles: { fontSize: 7 },
      columnStyles: { 6: { cellWidth: 55, fontSize: 6 } },
    });
  }

  if (options.audit && data.audit.length > 0) {
    doc.addPage();
    y = sectionTitle(doc, "Trilha de auditoria", "Últimos eventos incluídos no momento da geração do dossiê.");
    autoTable(doc, {
      startY: y,
      head: [["Data/hora", "Usuário", "Evento", "Objeto", "Identificador"]],
      body: data.audit.map((row) => [
        dateTime(row.occurredAt),
        row.actorName,
        row.eventType,
        row.entityType,
        row.entityId,
      ]),
      theme: "striped",
      styles: { fontSize: 6.8 },
    });
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(7);
    doc.setTextColor(115);
    doc.text(`SiloNR · Dossiê de prontidão interna · ${page}/${pageCount} · ${dateTime(data.generatedAt)}`, 14, 288);
  }

  return doc;
}

export function downloadProductionDossier(data: DossierData, options: ProductionDossierOptions) {
  const doc = generateProductionDossier(data, options);
  const safeFacility = data.facility.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const date = new Date(data.generatedAt).toISOString().slice(0, 10);
  doc.save(`silonr-dossie-${safeFacility || "unidade"}-${date}.pdf`);
}
