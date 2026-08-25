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
  if (raw.includes("OFFLINE_EVIDENCE_REQUIRED_ONLINE")) {
    return "Há critério com evidência obrigatória. Sincronize o rascunho, anexe a evidência no ambiente online e conclua por lá.";
  }
  if (raw.includes("OFFLINE_CHECKLIST_INCOMPLETE")) return "Responda todos os itens antes de solicitar a conclusão.";
  if (raw.includes("OFFLINE_GRACE_EXPIRED")) return "A validade offline deste pacote expirou. Conecte-se e atualize o pacote antes de iniciar novas inspeções.";
  if (raw.includes("OFFLINE_PACK_MISSING")) return "Nenhum pacote offline foi baixado ainda.";
  if (raw.includes("OFFLINE_CONFLICT_REQUIRES_REVIEW")) return "Esta inspeção entrou em conflito com o servidor e precisa ser revisada online antes de novas alterações.";
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

async function loadStatus() {
  if (!invoke) {
    showGlobal("Esta interface precisa ser aberta pelo aplicativo SiloNR Desktop.");
    return;
  }

  try {
    currentStatus = await invoke("desktop_status");
    renderStatus(currentStatus);
    if (currentStatus.paired) {
      await Promise.all([loadSilos(), loadInspections()]);
    }
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

  const now = Date.now();
  const offlineUntil = status.offlineAllowedUntil ? new Date(status.offlineAllowedUntil).getTime() : 0;
  const expired = offlineUntil && offlineUntil < now;
  const hasConflict = Number(status.conflicts) > 0;
  if (hasConflict) setPill(elements.connectionPill, `${status.conflicts} conflito(s) para revisar`, "danger");
  else if (expired) setPill(elements.connectionPill, "Pacote offline expirado", "warning");
  else setPill(elements.connectionPill, "Modo offline pronto", "success");

  elements.workspaceName.textContent = [status.organizationName, status.facilityName].filter(Boolean).join(" · ") || "—";
  elements.packDate.textContent = formatDate(status.downloadedAt);
  elements.offlineUntil.textContent = formatDate(status.offlineAllowedUntil);
  elements.pendingCount.textContent = `${status.pendingEvents} pendente(s)`;
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
    elements.inspectionList.innerHTML = rows
      .map((row) => {
        const stateClass = row.syncState === "synced" ? "success" : row.syncState === "pending" ? "warning" : "danger";
        const stateLabel = row.syncState === "synced" ? "Sincronizada" : row.syncState === "pending" ? "Pendente de sync" : "Revisão necessária";
        return `<button class="inspection-card" type="button" data-inspection-id="${escapeHtml(row.id)}">
          <div class="inspection-card-top">
            <strong>${escapeHtml(row.siloName)}</strong>
            <span class="pill ${stateClass}">${stateLabel}</span>
          </div>
          <span>${escapeHtml(row.inspectionType)}</span>
          <small>${row.answeredCount}/${row.checklistCount} itens respondidos · ${escapeHtml(formatDate(row.updatedAt))}</small>
          ${row.lastError ? `<small class="danger-text">${escapeHtml(humanError(row.lastError))}</small>` : ""}
        </button>`;
      })
      .join("");
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

function renderInspectionDetail(detail) {
  const answerMap = new Map(detail.answers.map((answer) => [answer.requirementId, answer]));
  const stateKind = detail.syncState === "synced" ? "success" : detail.syncState === "pending" ? "warning" : "danger";
  const stateText = detail.syncState === "synced" ? "Sincronizada" : detail.syncState === "pending" ? "Pendente de sync" : "Revisão necessária";
  setPill(elements.detailState, stateText, stateKind);
  elements.detailTitle.textContent = `${detail.siloName} · ${detail.inspectionType}`;
  elements.detailMeta.textContent = `Iniciada em ${formatDate(detail.startedAt)} · revisão servidor ${detail.baseServerRevision}`;
  elements.detailError.hidden = !detail.lastError;
  elements.detailError.textContent = detail.lastError ? humanError(detail.lastError) : "";
  elements.finalizeLocal.disabled = detail.status !== "em_andamento" || ["conflict", "rejected"].includes(detail.syncState);

  elements.checklist.innerHTML = detail.checklist
    .map((item, index) => {
      const answer = answerMap.get(item.requirementId);
      return `<article class="check-item" data-requirement-id="${escapeHtml(item.requirementId)}">
        <div class="check-number">${index + 1}</div>
        <div class="check-body">
          <div class="check-heading">
            <div>
              <strong>${escapeHtml(item.code)} — ${escapeHtml(item.title)}</strong>
              <span>${escapeHtml(item.category)} · criticidade ${escapeHtml(item.severity)}</span>
            </div>
            ${item.evidenceRequired ? '<span class="pill warning">Evidência obrigatória</span>' : ""}
          </div>
          <p>${escapeHtml(item.description)}</p>
          <div class="answer-grid">
            <label class="field">
              <span>Resultado</span>
              <select class="answer-result">
                <option value="">Selecione…</option>
                <option value="atendido" ${answer?.result === "atendido" ? "selected" : ""}>Atendido</option>
                <option value="pendente" ${answer?.result === "pendente" ? "selected" : ""}>Pendente</option>
                <option value="critico" ${answer?.result === "critico" ? "selected" : ""}>Crítico</option>
                <option value="nao_aplicavel" ${answer?.result === "nao_aplicavel" ? "selected" : ""}>Não aplicável</option>
              </select>
            </label>
            <label class="field span-2">
              <span>Observação</span>
              <textarea class="answer-notes" rows="2" maxlength="5000">${escapeHtml(answer?.notes || "")}</textarea>
            </label>
            <button class="button secondary save-answer" type="button">Salvar item</button>
          </div>
        </div>
      </article>`;
    })
    .join("");

  elements.checklist.querySelectorAll(".check-item").forEach((item) => {
    item.querySelector(".save-answer").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const result = item.querySelector(".answer-result").value;
      const notes = item.querySelector(".answer-notes").value;
      if (!result) {
        showGlobal("Selecione um resultado antes de salvar o item.");
        return;
      }
      setBusy(button, true, "Salvando…");
      try {
        const updated = await invoke("save_offline_answer", {
          inspectionId: detail.id,
          requirementId: item.dataset.requirementId,
          result,
          notes,
        });
        renderInspectionDetail(updated);
        await Promise.all([loadInspections(), refreshStatusOnly()]);
        showGlobal("Item salvo localmente e colocado na fila de sincronização.", "success");
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
    currentStatus = await invoke("pair_device", {
      serverUrl: elements.serverUrl.value.trim(),
      pairingCode: elements.pairingCode.value.trim(),
      deviceName: elements.deviceName.value.trim() || null,
    });
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
    showGlobal(currentStatus.conflicts ? "Sincronização concluída com itens que precisam de revisão." : "Sincronização concluída.", currentStatus.conflicts ? "error" : "success");
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
    const detail = await invoke("start_offline_inspection", {
      siloId: elements.siloSelect.value,
      inspectionType: elements.inspectionType.value.trim(),
      notes: elements.inspectionNotes.value.trim(),
    });
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
    showGlobal("Conclusão colocada na fila. Sincronize para o servidor validar e efetivar.", "success");
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
