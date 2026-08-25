const invoke = window.__TAURI__?.core?.invoke;

const $ = (id) => document.getElementById(id);
const elements = {
  connectionPill: $("connection-pill"),
  pairingSection: $("pairing-section"),
  pairingForm: $("pairing-form"),
  serverUrl: $("server-url"),
  pairingCode: $("pairing-code"),
  deviceName: $("device-name"),
  pairDevice: $("pair-device"),
  workspaceSection: $("workspace-section"),
  workspaceName: $("workspace-name"),
  packDate: $("pack-date"),
  offlineUntil: $("offline-until"),
  pendingCount: $("pending-count"),
  openOnline: $("open-online"),
  refreshPack: $("refresh-pack"),
  syncNow: $("sync-now"),
  newInspectionForm: $("new-inspection-form"),
  siloSelect: $("silo-select"),
  inspectionType: $("inspection-type"),
  inspectionNotes: $("inspection-notes"),
  startInspection: $("start-inspection"),
  inspectionList: $("inspection-list"),
  detail: $("inspection-detail"),
  detailState: $("detail-state"),
  detailTitle: $("detail-title"),
  detailMeta: $("detail-meta"),
  detailError: $("detail-error"),
  checklist: $("checklist"),
  closeDetail: $("close-detail"),
  finalizeLocal: $("finalize-local"),
  globalError: $("global-error"),
  globalSuccess: $("global-success"),
};

let currentStatus = null;
let currentInspectionId = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showGlobal(message, kind = "error") {
  elements.globalError.hidden = true;
  elements.globalSuccess.hidden = true;
  const target = kind === "success" ? elements.globalSuccess : elements.globalError;
  target.textContent = message;
  target.hidden = false;
}

function clearGlobal() {
  elements.globalError.hidden = true;
  elements.globalSuccess.hidden = true;
}

function humanError(error) {
  const raw = typeof error === "string" ? error : error?.message || String(error);
  if (raw.includes("OFFLINE_REQUIRED_EVIDENCE_MISSING")) return "Há critério com evidência obrigatória sem foto anexada neste computador.";
  if (raw.includes("OFFLINE_EVIDENCE_CONFLICT")) return "Uma evidência entrou em conflito com o servidor. O rascunho local foi preservado para revisão.";
  if (raw.includes("OFFLINE_EVIDENCE_ALREADY_SYNCED")) return "Esta evidência já foi confirmada no servidor. Remova-a pelo fluxo online para manter a trilha de auditoria.";
  if (raw.includes("OFFLINE_EVIDENCE_SIZE_NOT_ALLOWED")) return "A evidência deve ter no máximo 15 MB.";
  if (raw.includes("OFFLINE_EVIDENCE_TYPE_NOT_ALLOWED")) return "Use uma imagem JPEG, PNG ou WebP.";
  if (raw.includes("OFFLINE_EVIDENCE_CONTENT_MISMATCH")) return "O conteúdo do arquivo não corresponde ao tipo de imagem informado.";
  if (raw.includes("OFFLINE_EVIDENCE_LOCAL_HASH_MISMATCH")) return "A evidência local foi alterada depois de registrada. Ela não será enviada.";
  if (raw.includes("OFFLINE_CHECKLIST_INCOMPLETE")) return "Responda todos os itens antes de solicitar a conclusão.";
  if (raw.includes("OFFLINE_GRACE_EXPIRED")) return "A validade offline deste pacote expirou. Conecte-se e atualize o pacote antes de continuar.";
  if (raw.includes("OFFLINE_PACK_MISSING")) return "Nenhum pacote offline foi baixado ainda.";
  if (raw.includes("OFFLINE_CONFLICT_REQUIRES_REVIEW")) return "Esta inspeção entrou em conflito com o servidor e precisa ser revisada antes de novas alterações.";
  if (raw.includes("PAIRING_CODE_INVALID_OR_EXPIRED")) return "Código de ativação inválido, já utilizado ou expirado. Gere um novo código no SiloNR online.";
  if (raw.includes("DEVICE_ALREADY_BOUND")) return "Este computador já está vinculado a outro acesso ativo. Revogue o vínculo anterior antes de ativar novamente.";
  if (raw.includes("LICENSE_EXPIRED") || raw.includes("LICENSE_NOT_ACTIVE")) return "A licença desta empresa não permite ativar ou sincronizar o modo offline.";
  if (raw.startsWith("NETWORK:") || raw.includes("error sending request")) return "Servidor indisponível. Os dados locais permanecem salvos; tente sincronizar quando a conexão voltar.";
  if (raw.includes("OFFLINE_CHECKLIST_STALE")) return "A matriz de requisitos mudou desde o último pacote. Atualize os dados e revise a inspeção antes de continuar.";
  if (raw.includes("INSPECTION_CONFLICT")) return "O servidor possui uma versão diferente desta inspeção. O rascunho local foi preservado para revisão.";
  return raw.replace(/^SERVER:/, "Servidor: ");
}

function setBusy(button, busy, busyText) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.label;
}

function setPill(element, text, kind = "neutral") {
  element.className = `pill ${kind}`;
  element.textContent = text;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      const comma = value.indexOf(",");
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler a evidência selecionada."));
    reader.readAsDataURL(file);
  });
}

function normalizedMime(file) {
  if (file.type) return file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return "";
}

async function loadStatus() {
  if (!invoke) {
    showGlobal("Esta interface precisa ser aberta pelo aplicativo SiloNR Desktop.");
    return;
  }
  try {
    currentStatus = await invoke("desktop_status");
    renderStatus(currentStatus);
    if (currentStatus.paired) await Promise.all([loadSilos(), loadInspections()]);
  } catch (error) {
    showGlobal(humanError(error));
  }
}

function renderStatus(status) {
  elements.pairingSection.hidden = Boolean(status.paired);
  elements.workspaceSection.hidden = !status.paired;
  elements.openOnline.hidden = !status.configured;
  if (!status.paired) {
    setPill(elements.connectionPill, "Computador não ativado", "warning");
    if (status.serverUrl) elements.serverUrl.value = status.serverUrl;
    return;
  }

  const offlineUntil = status.offlineAllowedUntil ? new Date(status.offlineAllowedUntil).getTime() : 0;
  const expired = offlineUntil && offlineUntil < Date.now();
  if (Number(status.conflicts) > 0) setPill(elements.connectionPill, `${status.conflicts} conflito(s) para revisar`, "danger");
  else if (expired) setPill(elements.connectionPill, "Pacote offline expirado", "warning");
  else setPill(elements.connectionPill, "Modo offline pronto", "success");

  elements.workspaceName.textContent = [status.organizationName, status.facilityName].filter(Boolean).join(" · ") || "—";
  elements.packDate.textContent = formatDate(status.downloadedAt);
  elements.offlineUntil.textContent = formatDate(status.offlineAllowedUntil);
  const evidenceInfo = Number(status.pendingEvidence || 0) > 0 ? ` · ${status.pendingEvidence} evidência(s)` : "";
  elements.pendingCount.textContent = `${status.pendingEvents} pendente(s)${evidenceInfo}`;
}

async function loadSilos() {
  try {
    const silos = await invoke("list_offline_silos");
    elements.siloSelect.innerHTML = silos.length
      ? silos.map((silo) => `<option value="${escapeHtml(silo.id)}">${escapeHtml(silo.code)} — ${escapeHtml(silo.name)}</option>`).join("")
      : '<option value="">Nenhum silo disponível</option>';
    elements.startInspection.disabled = silos.length === 0;
  } catch (error) {
    elements.siloSelect.innerHTML = '<option value="">Pacote indisponível</option>';
    elements.startInspection.disabled = true;
    showGlobal(humanError(error));
  }
}

async function loadInspections() {
  try {
    const rows = await invoke("list_offline_inspections");
    if (!rows.length) {
      elements.inspectionList.innerHTML = '<p class="empty">Nenhuma inspeção local.</p>';
      return;
    }
    elements.inspectionList.innerHTML = rows.map((row) => {
      const stateClass = row.syncState === "synced" ? "success" : row.syncState === "pending" ? "warning" : "danger";
      const stateLabel = row.syncState === "synced" ? "Sincronizada" : row.syncState === "pending" ? "Pendente de sync" : "Revisão necessária";
      return `<button class="inspection-card" type="button" data-inspection-id="${escapeHtml(row.id)}">
        <div class="inspection-card-top"><strong>${escapeHtml(row.siloName)}</strong><span class="pill ${stateClass}">${stateLabel}</span></div>
        <span>${escapeHtml(row.inspectionType)}</span>
        <small>${row.answeredCount}/${row.checklistCount} itens · ${row.evidenceCount || 0} evidência(s) · ${escapeHtml(formatDate(row.updatedAt))}</small>
        ${row.lastError ? `<small class="danger-text">${escapeHtml(humanError(row.lastError))}</small>` : ""}
      </button>`;
    }).join("");
    elements.inspectionList.querySelectorAll("[data-inspection-id]").forEach((button) => {
      button.addEventListener("click", () => openInspection(button.dataset.inspectionId));
    });
  } catch (error) {
    showGlobal(humanError(error));
  }
}

async function openInspection(id) {
  try {
    const detail = await invoke("get_offline_inspection", { inspectionId: id });
    currentInspectionId = id;
    renderInspectionDetail(detail);
    elements.detail.hidden = false;
    elements.detail.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showGlobal(humanError(error));
  }
}

function evidenceStatus(evidence) {
  if (evidence.status === "uploaded") return { label: "Confirmada no servidor", kind: "success" };
  if (evidence.status === "conflict") return { label: "Conflito", kind: "danger" };
  return { label: "Pendente de envio", kind: "warning" };
}

function renderEvidenceList(detail, requirementId) {
  const rows = (detail.evidence || []).filter((item) => item.requirementId === requirementId);
  if (!rows.length) return '<p class="evidence-empty">Nenhuma evidência anexada.</p>';
  return rows.map((evidence) => {
    const state = evidenceStatus(evidence);
    return `<div class="evidence-row" data-evidence-id="${escapeHtml(evidence.id)}">
      <div><strong>${escapeHtml(evidence.fileName)}</strong><small>${escapeHtml(formatBytes(evidence.sizeBytes))} · SHA-256 ${escapeHtml(evidence.sha256.slice(0, 12))}… · ${escapeHtml(formatDate(evidence.capturedAt))}</small>${evidence.lastError ? `<small class="danger-text">${escapeHtml(humanError(evidence.lastError))}</small>` : ""}</div>
      <div class="evidence-actions"><span class="pill ${state.kind}">${state.label}</span>${evidence.status !== "uploaded" ? '<button type="button" class="button danger compact remove-evidence">Remover</button>' : ""}</div>
    </div>`;
  }).join("");
}

function renderInspectionDetail(detail) {
  const answerMap = new Map(detail.answers.map((answer) => [answer.requirementId, answer]));
  const stateKind = detail.syncState === "synced" ? "success" : detail.syncState === "pending" ? "warning" : "danger";
  const stateText = detail.syncState === "synced" ? "Sincronizada" : detail.syncState === "pending" ? "Pendente de sync" : "Revisão necessária";
  setPill(elements.detailState, stateText, stateKind);
  elements.detailTitle.textContent = `${detail.siloName} · ${detail.inspectionType}`;
  elements.detailMeta.textContent = `Iniciada em ${formatDate(detail.startedAt)} · revisão servidor ${detail.baseServerRevision} · ${(detail.evidence || []).length} evidência(s)`;
  elements.detailError.hidden = !detail.lastError;
  elements.detailError.textContent = detail.lastError ? humanError(detail.lastError) : "";
  elements.finalizeLocal.disabled = detail.status !== "em_andamento" || ["conflict", "rejected"].includes(detail.syncState);

  elements.checklist.innerHTML = detail.checklist.map((item, index) => {
    const answer = answerMap.get(item.requirementId);
    return `<article class="check-item" data-requirement-id="${escapeHtml(item.requirementId)}">
      <div class="check-number">${index + 1}</div>
      <div class="check-body">
        <div class="check-heading"><div><strong>${escapeHtml(item.code)} — ${escapeHtml(item.title)}</strong><span>${escapeHtml(item.category)} · criticidade ${escapeHtml(item.severity)}</span></div>${item.evidenceRequired ? '<span class="pill warning">Evidência obrigatória</span>' : ""}</div>
        <p>${escapeHtml(item.description)}</p>
        <div class="answer-grid">
          <label class="field"><span>Resultado</span><select class="answer-result">
            <option value="">Selecione…</option>
            <option value="atendido" ${answer?.result === "atendido" ? "selected" : ""}>Atendido</option>
            <option value="pendente" ${answer?.result === "pendente" ? "selected" : ""}>Pendente</option>
            <option value="critico" ${answer?.result === "critico" ? "selected" : ""}>Crítico</option>
            <option value="nao_aplicavel" ${answer?.result === "nao_aplicavel" ? "selected" : ""}>Não aplicável</option>
          </select></label>
          <label class="field span-2"><span>Observação</span><textarea class="answer-notes" rows="2" maxlength="5000">${escapeHtml(answer?.notes || "")}</textarea></label>
          <button class="button secondary save-answer" type="button">Salvar item</button>
        </div>
        <div class="evidence-box">
          <div class="evidence-title"><strong>Evidências</strong><span>${item.evidenceRequired ? "Obrigatória para conclusão" : "Opcional"}</span></div>
          <div class="evidence-list">${renderEvidenceList(detail, item.requirementId)}</div>
          <div class="evidence-upload">
            <input class="evidence-file" type="file" accept="image/jpeg,image/png,image/webp" />
            <button class="button secondary attach-evidence" type="button">Anexar imagem offline</button>
          </div>
          <small>JPEG, PNG ou WebP · máximo 15 MB. O arquivo recebe SHA-256 antes de entrar na fila.</small>
        </div>
      </div>
    </article>`;
  }).join("");

  elements.checklist.querySelectorAll(".check-item").forEach((item) => {
    item.querySelector(".save-answer").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const result = item.querySelector(".answer-result").value;
      const notes = item.querySelector(".answer-notes").value;
      if (!result) return showGlobal("Selecione um resultado antes de salvar o item.");
      setBusy(button, true, "Salvando…");
      try {
        const updated = await invoke("save_offline_answer", { inspectionId: detail.id, requirementId: item.dataset.requirementId, result, notes });
        renderInspectionDetail(updated);
        await Promise.all([loadInspections(), refreshStatusOnly()]);
        showGlobal("Item salvo localmente e colocado na fila de sincronização.", "success");
      } catch (error) {
        showGlobal(humanError(error));
      } finally {
        setBusy(button, false, "");
      }
    });

    item.querySelector(".attach-evidence").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const input = item.querySelector(".evidence-file");
      const file = input.files?.[0];
      if (!file) return showGlobal("Selecione uma imagem antes de anexar.");
      if (file.size > 15 * 1024 * 1024) return showGlobal("A evidência deve ter no máximo 15 MB.");
      const mimeType = normalizedMime(file);
      if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return showGlobal("Use uma imagem JPEG, PNG ou WebP.");
      setBusy(button, true, "Protegendo arquivo…");
      try {
        const dataBase64 = await fileToBase64(file);
        const updated = await invoke("add_offline_evidence", {
          inspectionId: detail.id,
          requirementId: item.dataset.requirementId,
          fileName: file.name,
          mimeType,
          dataBase64,
          description: "Evidência capturada no SiloNR Desktop",
        });
        renderInspectionDetail(updated);
        await Promise.all([loadInspections(), refreshStatusOnly()]);
        showGlobal("Evidência salva localmente, validada e colocada na fila de sincronização.", "success");
      } catch (error) {
        showGlobal(humanError(error));
      } finally {
        setBusy(button, false, "");
      }
    });
  });

  elements.checklist.querySelectorAll(".remove-evidence").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-evidence-id]");
      if (!row) return;
      setBusy(button, true, "Removendo…");
      try {
        const updated = await invoke("remove_offline_evidence", { evidenceId: row.dataset.evidenceId });
        renderInspectionDetail(updated);
        await Promise.all([loadInspections(), refreshStatusOnly()]);
        showGlobal("Evidência pendente removida deste computador.", "success");
      } catch (error) {
        showGlobal(humanError(error));
      } finally {
        setBusy(button, false, "");
      }
    });
  });
}

async function refreshStatusOnly() {
  currentStatus = await invoke("desktop_status");
  renderStatus(currentStatus);
}

elements.pairingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearGlobal();
  setBusy(elements.pairDevice, true, "Ativando…");
  try {
    currentStatus = await invoke("pair_device", { serverUrl: elements.serverUrl.value.trim(), pairingCode: elements.pairingCode.value.trim(), deviceName: elements.deviceName.value.trim() || null });
    elements.pairingCode.value = "";
    renderStatus(currentStatus);
    await Promise.all([loadSilos(), loadInspections()]);
    showGlobal("Computador ativado. O primeiro pacote offline já foi baixado.", "success");
  } catch (error) {
    showGlobal(humanError(error));
  } finally {
    setBusy(elements.pairDevice, false, "");
  }
});

elements.refreshPack.addEventListener("click", async () => {
  clearGlobal();
  setBusy(elements.refreshPack, true, "Atualizando…");
  try {
    currentStatus = await invoke("refresh_offline_pack");
    renderStatus(currentStatus);
    await loadSilos();
    showGlobal("Pacote offline atualizado com os critérios publicados atuais.", "success");
  } catch (error) {
    showGlobal(humanError(error));
  } finally {
    setBusy(elements.refreshPack, false, "");
  }
});

elements.syncNow.addEventListener("click", async () => {
  clearGlobal();
  setBusy(elements.syncNow, true, "Sincronizando…");
  try {
    currentStatus = await invoke("sync_now");
    renderStatus(currentStatus);
    await loadInspections();
    if (currentInspectionId) await openInspection(currentInspectionId);
    showGlobal(currentStatus.conflicts ? "Sincronização concluída com itens que precisam de revisão." : "Sincronização concluída: rascunhos, evidências e conclusões foram processados na ordem segura.", currentStatus.conflicts ? "error" : "success");
  } catch (error) {
    showGlobal(humanError(error));
  } finally {
    setBusy(elements.syncNow, false, "");
  }
});

elements.newInspectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearGlobal();
  setBusy(elements.startInspection, true, "Criando…");
  try {
    const detail = await invoke("start_offline_inspection", { siloId: elements.siloSelect.value, inspectionType: elements.inspectionType.value.trim(), notes: elements.inspectionNotes.value.trim() });
    elements.inspectionNotes.value = "";
    currentInspectionId = detail.id;
    renderInspectionDetail(detail);
    elements.detail.hidden = false;
    await Promise.all([loadInspections(), refreshStatusOnly()]);
    elements.detail.scrollIntoView({ behavior: "smooth", block: "start" });
    showGlobal("Inspeção criada no banco local deste computador.", "success");
  } catch (error) {
    showGlobal(humanError(error));
  } finally {
    setBusy(elements.startInspection, false, "");
  }
});

elements.finalizeLocal.addEventListener("click", async () => {
  if (!currentInspectionId) return;
  clearGlobal();
  setBusy(elements.finalizeLocal, true, "Validando…");
  try {
    const detail = await invoke("request_offline_finalize", { inspectionId: currentInspectionId });
    renderInspectionDetail(detail);
    await Promise.all([loadInspections(), refreshStatusOnly()]);
    showGlobal("Conclusão preparada. Ao sincronizar, o SiloNR envia primeiro o rascunho, depois as evidências e só então efetiva a conclusão.", "success");
  } catch (error) {
    const message = humanError(error);
    elements.detailError.textContent = message;
    elements.detailError.hidden = false;
    showGlobal(message);
  } finally {
    setBusy(elements.finalizeLocal, false, "");
  }
});

elements.closeDetail.addEventListener("click", () => {
  currentInspectionId = null;
  elements.detail.hidden = true;
});

elements.openOnline.addEventListener("click", async () => {
  if (currentStatus?.pendingEvents > 0) {
    const proceed = window.confirm("Há alterações locais ainda não sincronizadas. Elas continuarão salvas neste computador. Abrir o ambiente online mesmo assim?");
    if (!proceed) return;
  }
  try {
    await invoke("open_online");
  } catch (error) {
    showGlobal(humanError(error));
  }
});

loadStatus();
