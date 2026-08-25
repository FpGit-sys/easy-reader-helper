use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Utc};
use reqwest::{multipart, Client};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow};
use uuid::Uuid;

const PROTOCOL_VERSION: i32 = 1;
const MAX_EVIDENCE_BYTES: usize = 15 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    configured: bool,
    paired: bool,
    server_url: Option<String>,
    device_id: Option<String>,
    organization_name: Option<String>,
    facility_name: Option<String>,
    downloaded_at: Option<String>,
    offline_allowed_until: Option<String>,
    pending_events: i64,
    pending_evidence: i64,
    conflicts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivationResponse {
    token: String,
    device_id: String,
    organization_id: String,
    facility_id: String,
    user_id: String,
    protocol_version: i32,
    offline_allowed_until: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePack {
    organization_id: String,
    organization_name: String,
    facility_id: String,
    facility_name: String,
    user_id: String,
    device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSilo {
    id: String,
    code: String,
    name: String,
    #[serde(rename = "type")]
    silo_type: String,
    capacity_tonnes: i64,
    inspection_period_days: i64,
    notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackRequirement {
    silo_id: String,
    requirement_id: String,
    requirement_version_id: String,
    code: String,
    title: String,
    category: String,
    description: String,
    severity: String,
    evidence_required: bool,
    internal_period_days: Option<i64>,
    source_type: Option<String>,
    source_title: Option<String>,
    source_issuer: Option<String>,
    source_version: Option<String>,
    source_section: Option<String>,
    source_official_url: Option<String>,
    source_consulted_at: Option<String>,
    source_verified_by: Option<String>,
    source_verified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfflinePack {
    protocol_version: i32,
    downloaded_at: String,
    offline_allowed_until: String,
    workspace: WorkspacePack,
    silos: Vec<PackSilo>,
    requirements: Vec<PackRequirement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAnswer {
    requirement_id: String,
    result: String,
    notes: String,
    answered_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEvidence {
    id: String,
    requirement_id: String,
    file_name: String,
    mime_type: String,
    size_bytes: i64,
    sha256: String,
    status: String,
    last_error: Option<String>,
    captured_at: String,
}

#[derive(Debug, Clone)]
struct EvidenceRow {
    id: String,
    inspection_id: String,
    requirement_id: String,
    file_name: String,
    mime_type: String,
    size_bytes: i64,
    sha256: String,
    local_path: String,
    description: String,
    status: String,
    last_error: Option<String>,
    captured_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalInspectionSummary {
    id: String,
    silo_id: String,
    silo_name: String,
    inspection_type: String,
    status: String,
    sync_state: String,
    last_error: Option<String>,
    answered_count: usize,
    checklist_count: usize,
    evidence_count: usize,
    started_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalInspectionDetail {
    id: String,
    silo_id: String,
    silo_name: String,
    inspection_type: String,
    notes: String,
    status: String,
    sync_state: String,
    last_error: Option<String>,
    base_server_revision: i64,
    finalize_requested: bool,
    started_at: String,
    updated_at: String,
    checklist: Vec<PackRequirement>,
    answers: Vec<LocalAnswer>,
    evidence: Vec<LocalEvidence>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncResponse {
    protocol_version: i32,
    results: Vec<SyncResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncResult {
    event_id: String,
    entity_id: String,
    status: String,
    code: Option<String>,
    server_revision: Option<i64>,
    inspection_status: Option<String>,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível localizar os dados locais: {error}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Não foi possível preparar os dados locais: {error}"))?;
    Ok(dir)
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("silonr-offline.db"))
}

fn evidence_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("evidence");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Não foi possível preparar evidências locais: {error}"))?;
    Ok(dir)
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?)
        .map_err(|error| format!("Não foi possível abrir o banco local: {error}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Não foi possível configurar o banco local: {error}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS local_meta (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS offline_pack (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           payload TEXT NOT NULL,
           downloaded_at TEXT NOT NULL,
           offline_allowed_until TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS local_inspections (
           id TEXT PRIMARY KEY,
           silo_id TEXT NOT NULL,
           inspection_type TEXT NOT NULL,
           notes TEXT NOT NULL DEFAULT '',
           started_at TEXT NOT NULL,
           checklist_json TEXT NOT NULL,
           base_server_revision INTEGER NOT NULL DEFAULT 0,
           finalize_requested INTEGER NOT NULL DEFAULT 0,
           status TEXT NOT NULL DEFAULT 'em_andamento',
           sync_state TEXT NOT NULL DEFAULT 'pending',
           last_error TEXT,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS local_answers (
           inspection_id TEXT NOT NULL REFERENCES local_inspections(id) ON DELETE CASCADE,
           requirement_id TEXT NOT NULL,
           result TEXT NOT NULL,
           notes TEXT NOT NULL DEFAULT '',
           answered_at TEXT NOT NULL,
           PRIMARY KEY (inspection_id, requirement_id)
         );
         CREATE TABLE IF NOT EXISTS local_evidence (
           id TEXT PRIMARY KEY,
           inspection_id TEXT NOT NULL REFERENCES local_inspections(id) ON DELETE CASCADE,
           requirement_id TEXT NOT NULL,
           file_name TEXT NOT NULL,
           mime_type TEXT NOT NULL,
           size_bytes INTEGER NOT NULL,
           sha256 TEXT NOT NULL,
           local_path TEXT NOT NULL,
           description TEXT NOT NULL DEFAULT '',
           status TEXT NOT NULL DEFAULT 'pending',
           last_error TEXT,
           captured_at TEXT NOT NULL,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS local_evidence_inspection_idx
           ON local_evidence(inspection_id, requirement_id);
         CREATE TABLE IF NOT EXISTS outbox (
           event_id TEXT PRIMARY KEY,
           inspection_id TEXT NOT NULL UNIQUE REFERENCES local_inspections(id) ON DELETE CASCADE,
           payload TEXT NOT NULL,
           created_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS finalize_outbox (
           event_id TEXT PRIMARY KEY,
           inspection_id TEXT NOT NULL UNIQUE REFERENCES local_inspections(id) ON DELETE CASCADE,
           payload TEXT NOT NULL,
           created_at TEXT NOT NULL
         );",
    )
    .map_err(|error| format!("Não foi possível migrar o banco local: {error}"))?;
    Ok(conn)
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    open_db(app).map(|_| ())
}

fn get_meta(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM local_meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|error| format!("Falha ao ler configuração local: {error}"))
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO local_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|error| format!("Falha ao salvar configuração local: {error}"))?;
    Ok(())
}

fn install_id(conn: &Connection) -> Result<String, String> {
    if let Some(value) = get_meta(conn, "install_id")? {
        return Ok(value);
    }
    let value = Uuid::new_v4().to_string();
    set_meta(conn, "install_id", &value)?;
    Ok(value)
}

fn default_device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Computador SiloNR".to_string())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(35))
        .user_agent(concat!("SiloNR-Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Não foi possível iniciar a conexão segura: {error}"))
}

fn api_error(status: reqwest::StatusCode, body: &str) -> String {
    let code = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value.get("error").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| status.to_string());
    format!("SERVER:{code}")
}

fn read_pack(conn: &Connection) -> Result<Option<OfflinePack>, String> {
    let payload: Option<String> = conn
        .query_row("SELECT payload FROM offline_pack WHERE id = 1", [], |row| row.get(0))
        .optional()
        .map_err(|error| format!("Falha ao ler pacote offline: {error}"))?;
    payload
        .map(|raw| serde_json::from_str(&raw).map_err(|error| format!("Pacote offline local inválido: {error}")))
        .transpose()
}

fn ensure_offline_window(window: &WebviewWindow) -> Result<(), String> {
    super::ensure_local_configuration_page(window)
}

fn ensure_offline_grace(pack: &OfflinePack) -> Result<(), String> {
    let until = DateTime::parse_from_rfc3339(&pack.offline_allowed_until)
        .map_err(|_| "Pacote offline possui validade inválida.".to_string())?;
    if until.with_timezone(&Utc) < Utc::now() {
        return Err("OFFLINE_GRACE_EXPIRED".to_string());
    }
    Ok(())
}

fn current_server_url(app: &AppHandle) -> Result<String, String> {
    super::read_config(app)?
        .map(|config| config.server_url)
        .ok_or_else(|| "SERVER_NOT_CONFIGURED".to_string())
}

async fn refresh_pack_internal(app: &AppHandle) -> Result<OfflinePack, String> {
    let server_url = current_server_url(app)?;
    let token = {
        let conn = open_db(app)?;
        get_meta(&conn, "device_token")?.ok_or_else(|| "DEVICE_NOT_PAIRED".to_string())?
    };

    let response = http_client()?
        .get(format!("{server_url}/api/offline/bootstrap"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("NETWORK:{error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| format!("NETWORK:{error}"))?;
    if !status.is_success() {
        return Err(api_error(status, &body));
    }

    let pack: OfflinePack = serde_json::from_str(&body)
        .map_err(|error| format!("Resposta de sincronização inválida: {error}"))?;
    if pack.protocol_version != PROTOCOL_VERSION {
        return Err("OFFLINE_PROTOCOL_UNSUPPORTED".to_string());
    }

    let conn = open_db(app)?;
    conn.execute(
        "INSERT INTO offline_pack(id, payload, downloaded_at, offline_allowed_until)
         VALUES(1, ?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload,
           downloaded_at = excluded.downloaded_at,
           offline_allowed_until = excluded.offline_allowed_until",
        params![body, pack.downloaded_at, pack.offline_allowed_until],
    )
    .map_err(|error| format!("Falha ao salvar pacote offline: {error}"))?;
    Ok(pack)
}

fn clear_local_workspace(app: &AppHandle, conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM finalize_outbox;
         DELETE FROM outbox;
         DELETE FROM local_evidence;
         DELETE FROM local_answers;
         DELETE FROM local_inspections;
         DELETE FROM offline_pack;",
    )
    .map_err(|error| format!("Falha ao limpar dados do vínculo anterior: {error}"))?;
    let dir = evidence_dir(app)?;
    for entry in fs::read_dir(&dir).map_err(|error| format!("Falha ao limpar evidências locais: {error}"))? {
        if let Ok(entry) = entry {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn pair_device(
    app: AppHandle,
    window: WebviewWindow,
    server_url: String,
    pairing_code: String,
    device_name: Option<String>,
) -> Result<DesktopStatus, String> {
    ensure_offline_window(&window)?;
    let parsed = super::validate_server_url(&server_url)?;
    let normalized_server = parsed.as_str().trim_end_matches('/').to_string();
    let fingerprint = {
        let conn = open_db(&app)?;
        install_id(&conn)?
    };

    let response = http_client()?
        .post(format!("{normalized_server}/api/offline/activate"))
        .json(&json!({
            "code": pairing_code,
            "fingerprint": fingerprint,
            "name": device_name.filter(|value| !value.trim().is_empty()).unwrap_or_else(default_device_name),
            "platform": std::env::consts::OS,
            "appVersion": env!("CARGO_PKG_VERSION")
        }))
        .send()
        .await
        .map_err(|error| format!("NETWORK:{error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| format!("NETWORK:{error}"))?;
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    let activation: ActivationResponse = serde_json::from_str(&body)
        .map_err(|error| format!("Resposta de ativação inválida: {error}"))?;
    if activation.protocol_version != PROTOCOL_VERSION {
        return Err("OFFLINE_PROTOCOL_UNSUPPORTED".to_string());
    }

    super::write_config(
        &app,
        super::DesktopConfig {
            server_url: normalized_server,
        },
    )?;
    {
        let conn = open_db(&app)?;
        let old_org = get_meta(&conn, "organization_id")?;
        let old_facility = get_meta(&conn, "facility_id")?;
        if old_org.as_deref().is_some_and(|value| value != activation.organization_id)
            || old_facility.as_deref().is_some_and(|value| value != activation.facility_id)
        {
            clear_local_workspace(&app, &conn)?;
        }
        set_meta(&conn, "device_token", &activation.token)?;
        set_meta(&conn, "device_id", &activation.device_id)?;
        set_meta(&conn, "organization_id", &activation.organization_id)?;
        set_meta(&conn, "facility_id", &activation.facility_id)?;
        set_meta(&conn, "user_id", &activation.user_id)?;
        set_meta(&conn, "offline_allowed_until", &activation.offline_allowed_until)?;
    }

    refresh_pack_internal(&app).await?;
    desktop_status_inner(&app)
}

#[tauri::command]
pub async fn refresh_offline_pack(app: AppHandle, window: WebviewWindow) -> Result<DesktopStatus, String> {
    ensure_offline_window(&window)?;
    refresh_pack_internal(&app).await?;
    desktop_status_inner(&app)
}

#[tauri::command]
pub fn desktop_status(app: AppHandle, window: WebviewWindow) -> Result<DesktopStatus, String> {
    ensure_offline_window(&window)?;
    desktop_status_inner(&app)
}

fn desktop_status_inner(app: &AppHandle) -> Result<DesktopStatus, String> {
    let conn = open_db(app)?;
    let server_url = super::read_config(app)?.map(|config| config.server_url);
    let device_id = get_meta(&conn, "device_id")?;
    let paired = get_meta(&conn, "device_token")?.is_some();
    let snapshot_events: i64 = conn.query_row("SELECT COUNT(*) FROM outbox", [], |row| row.get(0))
        .map_err(|error| format!("Falha ao contar pendências locais: {error}"))?;
    let finalize_events: i64 = conn.query_row("SELECT COUNT(*) FROM finalize_outbox", [], |row| row.get(0))
        .map_err(|error| format!("Falha ao contar conclusões locais: {error}"))?;
    let pending_evidence: i64 = conn.query_row(
        "SELECT COUNT(*) FROM local_evidence WHERE status = 'pending'",
        [],
        |row| row.get(0),
    ).map_err(|error| format!("Falha ao contar evidências pendentes: {error}"))?;
    let conflicts: i64 = conn.query_row(
        "SELECT COUNT(*) FROM local_inspections WHERE sync_state IN ('conflict', 'rejected')",
        [],
        |row| row.get(0),
    ).map_err(|error| format!("Falha ao contar conflitos locais: {error}"))?;
    let pack = read_pack(&conn)?;

    Ok(DesktopStatus {
        configured: server_url.is_some(),
        paired,
        server_url,
        device_id,
        organization_name: pack.as_ref().map(|value| value.workspace.organization_name.clone()),
        facility_name: pack.as_ref().map(|value| value.workspace.facility_name.clone()),
        downloaded_at: pack.as_ref().map(|value| value.downloaded_at.clone()),
        offline_allowed_until: pack.as_ref().map(|value| value.offline_allowed_until.clone()),
        pending_events: snapshot_events + finalize_events + pending_evidence,
        pending_evidence,
        conflicts,
    })
}

#[tauri::command]
pub fn list_offline_silos(app: AppHandle, window: WebviewWindow) -> Result<Vec<PackSilo>, String> {
    ensure_offline_window(&window)?;
    let conn = open_db(&app)?;
    let pack = read_pack(&conn)?.ok_or_else(|| "OFFLINE_PACK_MISSING".to_string())?;
    ensure_offline_grace(&pack)?;
    Ok(pack.silos)
}

#[tauri::command]
pub fn start_offline_inspection(
    app: AppHandle,
    window: WebviewWindow,
    silo_id: String,
    inspection_type: String,
    notes: String,
) -> Result<LocalInspectionDetail, String> {
    ensure_offline_window(&window)?;
    let mut conn = open_db(&app)?;
    let pack = read_pack(&conn)?.ok_or_else(|| "OFFLINE_PACK_MISSING".to_string())?;
    ensure_offline_grace(&pack)?;
    if !pack.silos.iter().any(|silo| silo.id == silo_id) {
        return Err("OFFLINE_SILO_NOT_FOUND".to_string());
    }
    let checklist: Vec<PackRequirement> = pack.requirements.iter().filter(|item| item.silo_id == silo_id).cloned().collect();
    if checklist.is_empty() {
        return Err("OFFLINE_NO_PUBLISHED_CRITERIA".to_string());
    }
    let inspection_type = inspection_type.trim();
    if inspection_type.is_empty() || inspection_type.len() > 160 {
        return Err("OFFLINE_INSPECTION_TYPE_INVALID".to_string());
    }
    if notes.len() > 5000 {
        return Err("OFFLINE_NOTES_TOO_LONG".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let checklist_json = serde_json::to_string(&checklist)
        .map_err(|error| format!("Falha ao preparar checklist local: {error}"))?;
    let tx = conn.transaction().map_err(|error| format!("Falha ao iniciar inspeção local: {error}"))?;
    tx.execute(
        "INSERT INTO local_inspections(
           id, silo_id, inspection_type, notes, started_at, checklist_json,
           base_server_revision, finalize_requested, status, sync_state, created_at, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 'em_andamento', 'pending', ?5, ?5)",
        params![id, silo_id, inspection_type, notes, now, checklist_json],
    ).map_err(|error| format!("Falha ao criar inspeção local: {error}"))?;
    queue_snapshot(&tx, &id)?;
    tx.commit().map_err(|error| format!("Falha ao salvar inspeção local: {error}"))?;
    load_inspection_detail(&conn, &id, &pack)
}

#[tauri::command]
pub fn save_offline_answer(
    app: AppHandle,
    window: WebviewWindow,
    inspection_id: String,
    requirement_id: String,
    result: String,
    notes: String,
) -> Result<LocalInspectionDetail, String> {
    ensure_offline_window(&window)?;
    if !matches!(result.as_str(), "atendido" | "pendente" | "critico" | "nao_aplicavel") {
        return Err("OFFLINE_ANSWER_INVALID".to_string());
    }
    if notes.len() > 5000 {
        return Err("OFFLINE_NOTES_TOO_LONG".to_string());
    }

    let mut conn = open_db(&app)?;
    let pack = read_pack(&conn)?.ok_or_else(|| "OFFLINE_PACK_MISSING".to_string())?;
    let detail = load_inspection_detail(&conn, &inspection_id, &pack)?;
    ensure_editable(&detail)?;
    if !detail.checklist.iter().any(|item| item.requirement_id == requirement_id) {
        return Err("OFFLINE_ANSWER_OUT_OF_SCOPE".to_string());
    }

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|error| format!("Falha ao salvar resposta local: {error}"))?;
    tx.execute(
        "INSERT INTO local_answers(inspection_id, requirement_id, result, notes, answered_at)
         VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(inspection_id, requirement_id) DO UPDATE SET
           result = excluded.result, notes = excluded.notes, answered_at = excluded.answered_at",
        params![inspection_id, requirement_id, result, notes, now],
    ).map_err(|error| format!("Falha ao salvar resposta local: {error}"))?;
    reset_finalize(&tx, &inspection_id, &now)?;
    queue_snapshot(&tx, &inspection_id)?;
    tx.commit().map_err(|error| format!("Falha ao concluir gravação local: {error}"))?;
    load_inspection_detail(&conn, &inspection_id, &pack)
}

#[tauri::command]
pub fn add_offline_evidence(
    app: AppHandle,
    window: WebviewWindow,
    inspection_id: String,
    requirement_id: String,
    file_name: String,
    mime_type: String,
    data_base64: String,
    description: String,
) -> Result<LocalInspectionDetail, String> {
    ensure_offline_window(&window)?;
    if file_name.trim().is_empty() || file_name.len() > 240 {
        return Err("OFFLINE_EVIDENCE_NAME_INVALID".to_string());
    }
    if description.len() > 5000 {
        return Err("OFFLINE_NOTES_TOO_LONG".to_string());
    }
    let mime = mime_type.to_lowercase();
    if !matches!(mime.as_str(), "image/jpeg" | "image/png" | "image/webp") {
        return Err("OFFLINE_EVIDENCE_TYPE_NOT_ALLOWED".to_string());
    }
    let encoded = data_base64.split_once(',').map(|(_, value)| value).unwrap_or(data_base64.as_str());
    let bytes = BASE64.decode(encoded).map_err(|_| "OFFLINE_EVIDENCE_INVALID_BASE64".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_EVIDENCE_BYTES {
        return Err("OFFLINE_EVIDENCE_SIZE_NOT_ALLOWED".to_string());
    }
    validate_image_bytes(&bytes, &mime)?;

    let mut conn = open_db(&app)?;
    let pack = read_pack(&conn)?.ok_or_else(|| "OFFLINE_PACK_MISSING".to_string())?;
    ensure_offline_grace(&pack)?;
    let detail = load_inspection_detail(&conn, &inspection_id, &pack)?;
    ensure_editable(&detail)?;
    if !detail.checklist.iter().any(|item| item.requirement_id == requirement_id) {
        return Err("OFFLINE_EVIDENCE_OUT_OF_SCOPE".to_string());
    }

    let evidence_id = Uuid::new_v4().to_string();
    let extension = match mime.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        _ => unreachable!(),
    };
    let final_path = evidence_dir(&app)?.join(format!("{evidence_id}.{extension}"));
    let temp_path = evidence_dir(&app)?.join(format!(".{evidence_id}.tmp"));
    fs::write(&temp_path, &bytes).map_err(|error| format!("Falha ao gravar evidência local: {error}"))?;
    fs::rename(&temp_path, &final_path).map_err(|error| format!("Falha ao confirmar evidência local: {error}"))?;

    let digest = sha256_hex(&bytes);
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|error| format!("Falha ao registrar evidência local: {error}"))?;
    let insert = tx.execute(
        "INSERT INTO local_evidence(
           id, inspection_id, requirement_id, file_name, mime_type, size_bytes,
           sha256, local_path, description, status, captured_at, created_at, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10, ?10, ?10)",
        params![
            evidence_id,
            inspection_id,
            requirement_id,
            file_name,
            mime,
            bytes.len() as i64,
            digest,
            final_path.to_string_lossy().to_string(),
            description,
            now
        ],
    );
    if let Err(error) = insert {
        let _ = fs::remove_file(&final_path);
        return Err(format!("Falha ao registrar evidência local: {error}"));
    }
    reset_finalize(&tx, &inspection_id, &now)?;
    tx.execute(
        "UPDATE local_inspections SET sync_state = 'pending', last_error = NULL, updated_at = ?2 WHERE id = ?1",
        params![inspection_id, now],
    ).map_err(|error| format!("Falha ao atualizar inspeção local: {error}"))?;
    tx.commit().map_err(|error| format!("Falha ao salvar evidência local: {error}"))?;
    load_inspection_detail(&conn, &inspection_id, &pack)
}

#[tauri::command]
pub fn remove_offline_evidence(
    app: AppHandle,
    window: WebviewWindow,
    evidence_id: String,
) -> Result<LocalInspectionDetail, String> {
    ensure_offline_window(&window)?;
    let mut conn = open_db(&app)?;
    let pack = read_pack(&conn)?.ok_or_else(|| "OFFLINE_PACK_MISSING".to_string())?;
    let row = load_evidence_row(&conn, &evidence_id)?.ok_or_else(|| "OFFLINE_EVIDENCE_NOT_FOUND".to_string())?;
    let detail = load_inspection_detail(&conn, &row.inspection_id, &pack)?;
    ensure_editable(&detail)?;
    if row.status == "uploaded" {
        return Err("OFFLINE_EVIDENCE_ALREADY_SYNCED".to_string());
    }
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|error| format!("Falha ao remover evidência local: {error}"))?;
    tx.execute("DELETE FROM local_evidence WHERE id = ?1", params![evidence_id])
        .map_err(|error| format!("Falha ao remover evidência local: {error}"))?;
    reset_finalize(&tx, &row.inspection_id, &now)?;
    tx.commit().map_err(|error| format!("Falha ao confirmar remoção: {error}"))?;
    let _ = fs::remove_file(row.local_path);
    load_inspection_detail(&conn, &row.inspection_id, &pack)
}

#[tauri::command]
pub fn request_offline_finalize(
    app: AppHandle,
    window: WebviewWindow,
    inspection_id: String,
) -> Result<LocalInspectionDetail, String> {
    ensure_offline_window(&window)?;
    let mut conn = open_db(&app)?;
    let pack = read_pack(&conn)?.ok_or_else(|| "OFFLINE_PACK_MISSING".to_string())?;
    let detail = load_inspection_detail(&conn, &inspection_id, &pack)?;
    ensure_editable(&detail)?;
    if detail.answers.len() != detail.checklist.len() {
        return Err("OFFLINE_CHECKLIST_INCOMPLETE".to_string());
    }
    for item in &detail.checklist {
        let answer = detail.answers.iter().find(|answer| answer.requirement_id == item.requirement_id)
            .ok_or_else(|| "OFFLINE_CHECKLIST_INCOMPLETE".to_string())?;
        if item.evidence_required && answer.result != "nao_aplicavel" {
            let has_evidence = detail.evidence.iter().any(|evidence| {
                evidence.requirement_id == item.requirement_id && evidence.status != "conflict"
            });
            if !has_evidence {
                return Err(format!("OFFLINE_REQUIRED_EVIDENCE_MISSING:{}", item.code));
            }
        }
    }
    if detail.evidence.iter().any(|evidence| evidence.status == "conflict") {
        return Err("OFFLINE_EVIDENCE_CONFLICT".to_string());
    }

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|error| format!("Falha ao preparar conclusão local: {error}"))?;
    tx.execute(
        "UPDATE local_inspections SET finalize_requested = 1, sync_state = 'pending', last_error = NULL, updated_at = ?2 WHERE id = ?1",
        params![inspection_id, now],
    ).map_err(|error| format!("Falha ao preparar conclusão local: {error}"))?;
    tx.execute("DELETE FROM finalize_outbox WHERE inspection_id = ?1", params![inspection_id])
        .map_err(|error| format!("Falha ao renovar conclusão local: {error}"))?;
    queue_snapshot(&tx, &inspection_id)?;
    tx.commit().map_err(|error| format!("Falha ao salvar conclusão local: {error}"))?;
    load_inspection_detail(&conn, &inspection_id, &pack)
}

#[tauri::command]
pub fn list_offline_inspections(app: AppHandle, window: WebviewWindow) -> Result<Vec<LocalInspectionSummary>, String> {
    ensure_offline_window(&window)?;
    let conn = open_db(&app)?;
    let pack = read_pack(&conn)?.ok_or_else(|| "OFFLINE_PACK_MISSING".to_string())?;
    let ids = {
        let mut statement = conn.prepare(
            "SELECT id FROM local_inspections ORDER BY datetime(updated_at) DESC, id DESC",
        ).map_err(|error| format!("Falha ao listar inspeções locais: {error}"))?;
        let values = statement.query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("Falha ao listar inspeções locais: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Falha ao ler inspeções locais: {error}"))?;
        values
    };
    ids.into_iter().map(|id| load_inspection_detail(&conn, &id, &pack).map(summary_from_detail)).collect()
}

#[tauri::command]
pub fn get_offline_inspection(
    app: AppHandle,
    window: WebviewWindow,
    inspection_id: String,
) -> Result<LocalInspectionDetail, String> {
    ensure_offline_window(&window)?;
    let conn = open_db(&app)?;
    let pack = read_pack(&conn)?.ok_or_else(|| "OFFLINE_PACK_MISSING".to_string())?;
    load_inspection_detail(&conn, &inspection_id, &pack)
}

#[tauri::command]
pub async fn sync_now(app: AppHandle, window: WebviewWindow) -> Result<DesktopStatus, String> {
    ensure_offline_window(&window)?;
    let server_url = current_server_url(&app)?;
    let token = {
        let conn = open_db(&app)?;
        get_meta(&conn, "device_token")?.ok_or_else(|| "DEVICE_NOT_PAIRED".to_string())?
    };

    sync_json_outbox(&app, &server_url, &token, "outbox").await?;
    sync_pending_evidence(&app, &server_url, &token).await?;
    prepare_finalize_events(&app)?;
    sync_json_outbox(&app, &server_url, &token, "finalize_outbox").await?;
    desktop_status_inner(&app)
}

fn read_outbox_events(app: &AppHandle, table: &str) -> Result<Vec<Value>, String> {
    if table != "outbox" && table != "finalize_outbox" {
        return Err("OFFLINE_OUTBOX_INVALID".to_string());
    }
    let conn = open_db(app)?;
    let sql = format!("SELECT payload FROM {table} ORDER BY datetime(created_at), event_id");
    let mut statement = conn.prepare(&sql)
        .map_err(|error| format!("Falha ao ler fila de sincronização: {error}"))?;
    let values = statement.query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Falha ao ler fila de sincronização: {error}"))?
        .map(|row| row.map_err(|error| format!("Falha ao ler evento local: {error}"))
            .and_then(|raw| serde_json::from_str::<Value>(&raw).map_err(|error| format!("Evento local inválido: {error}"))))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(values)
}

async fn sync_json_outbox(app: &AppHandle, server_url: &str, token: &str, table: &str) -> Result<(), String> {
    let events = read_outbox_events(app, table)?;
    if events.is_empty() {
        return Ok(());
    }

    let response = http_client()?
        .post(format!("{server_url}/api/offline/sync"))
        .bearer_auth(token)
        .json(&json!({ "protocolVersion": PROTOCOL_VERSION, "events": events }))
        .send().await.map_err(|error| format!("NETWORK:{error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| format!("NETWORK:{error}"))?;
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    let sync: SyncResponse = serde_json::from_str(&body).map_err(|error| format!("Resposta de sync inválida: {error}"))?;
    if sync.protocol_version != PROTOCOL_VERSION {
        return Err("OFFLINE_PROTOCOL_UNSUPPORTED".to_string());
    }

    let mut conn = open_db(app)?;
    let tx = conn.transaction().map_err(|error| format!("Falha ao aplicar retorno da sincronização: {error}"))?;
    for result in sync.results {
        match result.status.as_str() {
            "applied" => {
                let delete_sql = format!("DELETE FROM {table} WHERE event_id = ?1");
                tx.execute(&delete_sql, params![result.event_id])
                    .map_err(|error| format!("Falha ao confirmar evento sincronizado: {error}"))?;
                tx.execute(
                    "UPDATE local_inspections SET
                       base_server_revision = COALESCE(?2, base_server_revision),
                       status = COALESCE(?3, status),
                       sync_state = CASE WHEN ?3 = 'concluida' THEN 'synced' ELSE sync_state END,
                       last_error = NULL,
                       finalize_requested = CASE WHEN ?3 = 'concluida' THEN 0 ELSE finalize_requested END,
                       updated_at = ?4
                     WHERE id = ?1",
                    params![result.entity_id, result.server_revision, result.inspection_status, Utc::now().to_rfc3339()],
                ).map_err(|error| format!("Falha ao atualizar inspeção sincronizada: {error}"))?;
                if table == "outbox" {
                    tx.execute(
                        "UPDATE local_inspections SET sync_state = CASE WHEN finalize_requested = 1 THEN 'pending' ELSE 'synced' END WHERE id = ?1",
                        params![result.entity_id],
                    ).map_err(|error| format!("Falha ao atualizar estado local: {error}"))?;
                }
            }
            "conflict" | "rejected" => {
                let delete_sql = format!("DELETE FROM {table} WHERE event_id = ?1");
                tx.execute(&delete_sql, params![result.event_id])
                    .map_err(|error| format!("Falha ao encerrar evento rejeitado: {error}"))?;
                tx.execute(
                    "UPDATE local_inspections SET sync_state = ?2, last_error = ?3, updated_at = ?4 WHERE id = ?1",
                    params![result.entity_id, result.status, result.code.unwrap_or_else(|| "SYNC_REJECTED".to_string()), Utc::now().to_rfc3339()],
                ).map_err(|error| format!("Falha ao registrar conflito local: {error}"))?;
            }
            _ => return Err("OFFLINE_SYNC_RESULT_INVALID".to_string()),
        }
    }
    tx.commit().map_err(|error| format!("Falha ao confirmar sincronização local: {error}"))?;
    Ok(())
}

fn pending_evidence_rows(app: &AppHandle) -> Result<Vec<EvidenceRow>, String> {
    let conn = open_db(app)?;
    let mut statement = conn.prepare(
        "SELECT e.id, e.inspection_id, e.requirement_id, e.file_name, e.mime_type, e.size_bytes,
                e.sha256, e.local_path, e.description, e.status, e.last_error, e.captured_at
         FROM local_evidence e
         JOIN local_inspections i ON i.id = e.inspection_id
         WHERE e.status = 'pending'
           AND i.base_server_revision > 0
           AND i.sync_state NOT IN ('conflict', 'rejected')
           AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.inspection_id = i.id)
         ORDER BY datetime(e.captured_at), e.id",
    ).map_err(|error| format!("Falha ao ler evidências pendentes: {error}"))?;
    let values = statement.query_map([], evidence_from_row)
        .map_err(|error| format!("Falha ao ler evidências pendentes: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Falha ao carregar evidências pendentes: {error}"))?;
    Ok(values)
}

async fn sync_pending_evidence(app: &AppHandle, server_url: &str, token: &str) -> Result<(), String> {
    let rows = pending_evidence_rows(app)?;

    for row in rows {
        let bytes = fs::read(&row.local_path).map_err(|error| format!("EVIDENCE_LOCAL_FILE_MISSING:{error}"))?;
        if sha256_hex(&bytes) != row.sha256 {
            mark_evidence_error(app, &row, "OFFLINE_EVIDENCE_LOCAL_HASH_MISMATCH", true)?;
            continue;
        }
        let part = multipart::Part::bytes(bytes)
            .file_name(row.file_name.clone())
            .mime_str(&row.mime_type)
            .map_err(|_| "OFFLINE_EVIDENCE_TYPE_NOT_ALLOWED".to_string())?;
        let form = multipart::Form::new()
            .text("evidenceId", row.id.clone())
            .text("inspectionId", row.inspection_id.clone())
            .text("requirementId", row.requirement_id.clone())
            .text("description", row.description.clone())
            .text("capturedAt", row.captured_at.clone())
            .text("expectedSha256", row.sha256.clone())
            .part("file", part);

        let response = http_client()?
            .post(format!("{server_url}/api/offline/evidence-upload"))
            .bearer_auth(token)
            .multipart(form)
            .send().await.map_err(|error| format!("NETWORK:{error}"))?;
        let status = response.status();
        let body = response.text().await.map_err(|error| format!("NETWORK:{error}"))?;
        if status.is_success() {
            let conn = open_db(app)?;
            conn.execute(
                "UPDATE local_evidence SET status = 'uploaded', last_error = NULL, updated_at = ?2 WHERE id = ?1",
                params![row.id, Utc::now().to_rfc3339()],
            ).map_err(|error| format!("Falha ao confirmar evidência sincronizada: {error}"))?;
        } else if status.as_u16() == 409 || status.as_u16() == 400 {
            mark_evidence_error(app, &row, &api_error(status, &body), true)?;
        } else {
            return Err(api_error(status, &body));
        }
    }
    Ok(())
}

fn mark_evidence_error(app: &AppHandle, row: &EvidenceRow, error: &str, conflict: bool) -> Result<(), String> {
    let mut conn = open_db(app)?;
    let tx = conn.transaction().map_err(|e| format!("Falha ao registrar erro de evidência: {e}"))?;
    tx.execute(
        "UPDATE local_evidence SET status = ?2, last_error = ?3, updated_at = ?4 WHERE id = ?1",
        params![row.id, if conflict { "conflict" } else { "pending" }, error, Utc::now().to_rfc3339()],
    ).map_err(|e| format!("Falha ao registrar erro de evidência: {e}"))?;
    if conflict {
        tx.execute(
            "UPDATE local_inspections SET sync_state = 'conflict', last_error = ?2, updated_at = ?3 WHERE id = ?1",
            params![row.inspection_id, error, Utc::now().to_rfc3339()],
        ).map_err(|e| format!("Falha ao registrar conflito da inspeção: {e}"))?;
    }
    tx.commit().map_err(|e| format!("Falha ao confirmar erro de evidência: {e}"))?;
    Ok(())
}

fn prepare_finalize_events(app: &AppHandle) -> Result<(), String> {
    let mut conn = open_db(app)?;
    let ids = {
        let mut statement = conn.prepare(
            "SELECT i.id FROM local_inspections i
             WHERE i.finalize_requested = 1
               AND i.status = 'em_andamento'
               AND i.sync_state NOT IN ('conflict', 'rejected')
               AND i.base_server_revision > 0
               AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.inspection_id = i.id)
               AND NOT EXISTS (SELECT 1 FROM local_evidence e WHERE e.inspection_id = i.id AND e.status != 'uploaded')
             ORDER BY datetime(i.updated_at), i.id",
        ).map_err(|error| format!("Falha ao preparar conclusões: {error}"))?;
        let values = statement.query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("Falha ao preparar conclusões: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Falha ao ler conclusões: {error}"))?;
        values
    };
    let tx = conn.transaction().map_err(|error| format!("Falha ao preparar conclusões: {error}"))?;
    for id in ids {
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM finalize_outbox WHERE inspection_id = ?1)",
            params![id],
            |row| row.get(0),
        ).map_err(|error| format!("Falha ao verificar conclusão: {error}"))?;
        if !exists {
            queue_finalize(&tx, &id)?;
        }
    }
    tx.commit().map_err(|error| format!("Falha ao confirmar conclusões: {error}"))?;
    Ok(())
}

fn queue_snapshot(conn: &Connection, inspection_id: &str) -> Result<(), String> {
    let event = build_snapshot_event(conn, inspection_id, false)?;
    let event_id = event.get("id").and_then(Value::as_str).ok_or_else(|| "OFFLINE_EVENT_INVALID".to_string())?;
    let created_at = event.get("createdAt").and_then(Value::as_str).ok_or_else(|| "OFFLINE_EVENT_INVALID".to_string())?;
    let serialized = serde_json::to_string(&event).map_err(|error| format!("Falha ao preparar evento local: {error}"))?;
    conn.execute(
        "INSERT INTO outbox(event_id, inspection_id, payload, created_at)
         VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(inspection_id) DO UPDATE SET event_id = excluded.event_id, payload = excluded.payload, created_at = excluded.created_at",
        params![event_id, inspection_id, serialized, created_at],
    ).map_err(|error| format!("Falha ao enfileirar sincronização: {error}"))?;
    Ok(())
}

fn queue_finalize(conn: &Connection, inspection_id: &str) -> Result<(), String> {
    let event = build_snapshot_event(conn, inspection_id, true)?;
    let event_id = event.get("id").and_then(Value::as_str).ok_or_else(|| "OFFLINE_EVENT_INVALID".to_string())?;
    let created_at = event.get("createdAt").and_then(Value::as_str).ok_or_else(|| "OFFLINE_EVENT_INVALID".to_string())?;
    let serialized = serde_json::to_string(&event).map_err(|error| format!("Falha ao preparar conclusão local: {error}"))?;
    conn.execute(
        "INSERT INTO finalize_outbox(event_id, inspection_id, payload, created_at) VALUES(?1, ?2, ?3, ?4)",
        params![event_id, inspection_id, serialized, created_at],
    ).map_err(|error| format!("Falha ao enfileirar conclusão: {error}"))?;
    Ok(())
}

fn build_snapshot_event(conn: &Connection, inspection_id: &str, finalize: bool) -> Result<Value, String> {
    let row = conn.query_row(
        "SELECT silo_id, inspection_type, notes, started_at, checklist_json, base_server_revision
         FROM local_inspections WHERE id = ?1",
        params![inspection_id],
        |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, i64>(5)?,
        )),
    ).map_err(|error| format!("Inspeção local não encontrada: {error}"))?;
    let checklist: Vec<PackRequirement> = serde_json::from_str(&row.4)
        .map_err(|error| format!("Checklist local inválido: {error}"))?;
    let answers = load_answers(conn, inspection_id)?;
    let event_id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    Ok(json!({
        "id": event_id,
        "type": "inspection.snapshot",
        "entityId": inspection_id,
        "createdAt": created_at,
        "payload": {
            "siloId": row.0,
            "inspectionType": row.1,
            "notes": row.2,
            "startedAt": row.3,
            "baseRevision": row.5,
            "finalize": finalize,
            "checklist": checklist.iter().map(|item| json!({
                "requirementId": item.requirement_id,
                "requirementVersionId": item.requirement_version_id
            })).collect::<Vec<_>>(),
            "answers": answers
        }
    }))
}

fn reset_finalize(conn: &Connection, inspection_id: &str, now: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE local_inspections SET finalize_requested = 0, sync_state = 'pending', last_error = NULL, updated_at = ?2 WHERE id = ?1",
        params![inspection_id, now],
    ).map_err(|error| format!("Falha ao atualizar inspeção local: {error}"))?;
    conn.execute("DELETE FROM finalize_outbox WHERE inspection_id = ?1", params![inspection_id])
        .map_err(|error| format!("Falha ao invalidar conclusão anterior: {error}"))?;
    Ok(())
}

fn ensure_editable(detail: &LocalInspectionDetail) -> Result<(), String> {
    if detail.status != "em_andamento" {
        return Err("OFFLINE_INSPECTION_LOCKED".to_string());
    }
    if matches!(detail.sync_state.as_str(), "conflict" | "rejected") {
        return Err("OFFLINE_CONFLICT_REQUIRES_REVIEW".to_string());
    }
    Ok(())
}

fn load_answers(conn: &Connection, inspection_id: &str) -> Result<Vec<LocalAnswer>, String> {
    let mut statement = conn.prepare(
        "SELECT requirement_id, result, notes, answered_at FROM local_answers WHERE inspection_id = ?1 ORDER BY requirement_id",
    ).map_err(|error| format!("Falha ao carregar respostas locais: {error}"))?;
    let values = statement.query_map(params![inspection_id], |row| Ok(LocalAnswer {
        requirement_id: row.get(0)?, result: row.get(1)?, notes: row.get(2)?, answered_at: row.get(3)?,
    })).map_err(|error| format!("Falha ao carregar respostas locais: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Falha ao ler respostas locais: {error}"))?;
    Ok(values)
}

fn evidence_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EvidenceRow> {
    Ok(EvidenceRow {
        id: row.get(0)?, inspection_id: row.get(1)?, requirement_id: row.get(2)?, file_name: row.get(3)?,
        mime_type: row.get(4)?, size_bytes: row.get(5)?, sha256: row.get(6)?, local_path: row.get(7)?,
        description: row.get(8)?, status: row.get(9)?, last_error: row.get(10)?, captured_at: row.get(11)?,
    })
}

fn load_evidence_rows(conn: &Connection, inspection_id: &str) -> Result<Vec<EvidenceRow>, String> {
    let mut statement = conn.prepare(
        "SELECT id, inspection_id, requirement_id, file_name, mime_type, size_bytes, sha256,
                local_path, description, status, last_error, captured_at
         FROM local_evidence WHERE inspection_id = ?1 ORDER BY datetime(captured_at), id",
    ).map_err(|error| format!("Falha ao carregar evidências locais: {error}"))?;
    let values = statement.query_map(params![inspection_id], evidence_from_row)
        .map_err(|error| format!("Falha ao carregar evidências locais: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Falha ao ler evidências locais: {error}"))?;
    Ok(values)
}

fn load_evidence_row(conn: &Connection, evidence_id: &str) -> Result<Option<EvidenceRow>, String> {
    conn.query_row(
        "SELECT id, inspection_id, requirement_id, file_name, mime_type, size_bytes, sha256,
                local_path, description, status, last_error, captured_at
         FROM local_evidence WHERE id = ?1",
        params![evidence_id],
        evidence_from_row,
    ).optional().map_err(|error| format!("Falha ao carregar evidência local: {error}"))
}

fn load_inspection_detail(conn: &Connection, inspection_id: &str, pack: &OfflinePack) -> Result<LocalInspectionDetail, String> {
    let row = conn.query_row(
        "SELECT id, silo_id, inspection_type, notes, status, sync_state, last_error,
                base_server_revision, finalize_requested, started_at, updated_at, checklist_json
         FROM local_inspections WHERE id = ?1",
        params![inspection_id],
        |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?,
            row.get::<_, String>(4)?, row.get::<_, String>(5)?, row.get::<_, Option<String>>(6)?, row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?, row.get::<_, String>(9)?, row.get::<_, String>(10)?, row.get::<_, String>(11)?,
        )),
    ).map_err(|error| format!("Inspeção local não encontrada: {error}"))?;
    let checklist: Vec<PackRequirement> = serde_json::from_str(&row.11)
        .map_err(|error| format!("Checklist local inválido: {error}"))?;
    let silo_name = pack.silos.iter().find(|silo| silo.id == row.1).map(|silo| silo.name.clone()).unwrap_or_else(|| row.1.clone());
    let evidence = load_evidence_rows(conn, inspection_id)?.into_iter().map(|item| LocalEvidence {
        id: item.id,
        requirement_id: item.requirement_id,
        file_name: item.file_name,
        mime_type: item.mime_type,
        size_bytes: item.size_bytes,
        sha256: item.sha256,
        status: item.status,
        last_error: item.last_error,
        captured_at: item.captured_at,
    }).collect();

    Ok(LocalInspectionDetail {
        id: row.0, silo_id: row.1, silo_name, inspection_type: row.2, notes: row.3, status: row.4,
        sync_state: row.5, last_error: row.6, base_server_revision: row.7, finalize_requested: row.8 != 0,
        started_at: row.9, updated_at: row.10, checklist, answers: load_answers(conn, inspection_id)?, evidence,
    })
}

fn summary_from_detail(detail: LocalInspectionDetail) -> LocalInspectionSummary {
    LocalInspectionSummary {
        id: detail.id,
        silo_id: detail.silo_id,
        silo_name: detail.silo_name,
        inspection_type: detail.inspection_type,
        status: detail.status,
        sync_state: detail.sync_state,
        last_error: detail.last_error,
        answered_count: detail.answers.len(),
        checklist_count: detail.checklist.len(),
        evidence_count: detail.evidence.len(),
        started_at: detail.started_at,
        updated_at: detail.updated_at,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn validate_image_bytes(bytes: &[u8], mime: &str) -> Result<(), String> {
    let valid = match mime {
        "image/jpeg" => bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff,
        "image/png" => bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    if valid { Ok(()) } else { Err("OFFLINE_EVIDENCE_CONTENT_MISMATCH".to_string()) }
}

#[allow(dead_code)]
fn path_exists(path: &str) -> bool {
    Path::new(path).exists()
}
