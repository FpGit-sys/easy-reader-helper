use chrono::{DateTime, Utc};
use reqwest::Client;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager, WebviewWindow};
use uuid::Uuid;

const PROTOCOL_VERSION: i32 = 1;

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
struct PackSilo {
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
struct PackRequirement {
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
struct LocalAnswer {
    requirement_id: String,
    result: String,
    notes: String,
    answered_at: String,
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

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível localizar os dados locais: {error}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Não foi possível preparar os dados locais: {error}"))?;
    Ok(dir.join("silonr-offline.db"))
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
         CREATE TABLE IF NOT EXISTS outbox (
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
        .timeout(Duration::from_secs(20))
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
        .map(|raw| {
            serde_json::from_str(&raw)
                .map_err(|error| format!("Pacote offline local inválido: {error}"))
        })
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
    let conn = open_db(app)?;
    let token = get_meta(&conn, "device_token")?
        .ok_or_else(|| "DEVICE_NOT_PAIRED".to_string())?;
    drop(conn);

    let response = http_client()?
        .get(format!("{server_url}/api/offline/bootstrap"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("NETWORK:{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("NETWORK:{error}"))?;
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
         ON CONFLICT(id) DO UPDATE SET
           payload = excluded.payload,
           downloaded_at = excluded.downloaded_at,
           offline_allowed_until = excluded.offline_allowed_until",
        params![body, pack.downloaded_at, pack.offline_allowed_until],
    )
    .map_err(|error| format!("Falha ao salvar pacote offline: {error}"))?;
    Ok(pack)
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
    let conn = open_db(&app)?;
    let fingerprint = install_id(&conn)?;
    drop(conn);

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
    let body = response
        .text()
        .await
        .map_err(|error| format!("NETWORK:{error}"))?;
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
    let conn = open_db(&app)?;
    set_meta(&conn, "device_token", &activation.token)?;
    set_meta(&conn, "device_id", &activation.device_id)?;
    set_meta(&conn, "organization_id", &activation.organization_id)?;
    set_meta(&conn, "facility_id", &activation.facility_id)?;
    set_meta(&conn, "user_id", &activation.user_id)?;
    set_meta(
        &conn,
        "offline_allowed_until",
        &activation.offline_allowed_until,
    )?;
    drop(conn);

    refresh_pack_internal(&app).await?;
    desktop_status_inner(&app)
}

#[tauri::command]
pub async fn refresh_offline_pack(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<DesktopStatus, String> {
    ensure_offline_window(&window)?;
    refresh_pack_internal(&app).await?;
    desktop_status_inner(&app)
}

#[tauri::command]
pub fn desktop_status(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<DesktopStatus, String> {
    ensure_offline_window(&window)?;
    desktop_status_inner(&app)
}

fn desktop_status_inner(app: &AppHandle) -> Result<DesktopStatus, String> {
    let conn = open_db(app)?;
    let server_url = super::read_config(app)?.map(|config| config.server_url);
    let device_id = get_meta(&conn, "device_id")?;
    let paired = get_meta(&conn, "device_token")?.is_some();
    let pending_events: i64 = conn
        .query_row("SELECT COUNT(*) FROM outbox", [], |row| row.get(0))
        .map_err(|error| format!("Falha ao contar pendências locais: {error}"))?;
    let conflicts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM local_inspections WHERE sync_state IN ('conflict', 'rejected')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Falha ao contar conflitos locais: {error}"))?;
    let pack = read_pack(&conn)?;

    Ok(DesktopStatus {
        configured: server_url.is_some(),
        paired,
        server_url,
        device_id,
        organization_name: pack.as_ref().map(|value| value.workspace.organization_name.clone()),
        facility_name: pack.as_ref().map(|value| value.workspace.facility_name.clone()),
        downloaded_at: pack.as_ref().map(|value| value.downloaded_at.clone()),
        offline_allowed_until: pack
            .as_ref()
            .map(|value| value.offline_allowed_until.clone()),
        pending_events,
        conflicts,
    })
}

#[tauri::command]
pub fn list_offline_silos(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<PackSilo>, String> {
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
    let checklist: Vec<PackRequirement> = pack
        .requirements
        .iter()
        .filter(|item| item.silo_id == silo_id)
        .cloned()
        .collect();
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
    let tx = conn
        .transaction()
        .map_err(|error| format!("Falha ao iniciar inspeção local: {error}"))?;
    tx.execute(
        "INSERT INTO local_inspections(
           id, silo_id, inspection_type, notes, started_at, checklist_json,
           base_server_revision, finalize_requested, status, sync_state,
           created_at, updated_at
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 'em_andamento', 'pending', ?5, ?5)",
        params![id, silo_id, inspection_type, notes, now, checklist_json],
    )
    .map_err(|error| format!("Falha ao criar inspeção local: {error}"))?;
    queue_snapshot(&tx, &id)?;
    tx.commit()
        .map_err(|error| format!("Falha ao salvar inspeção local: {error}"))?;
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
    if !matches!(
        result.as_str(),
        "atendido" | "pendente" | "critico" | "nao_aplicavel"
    ) {
        return Err("OFFLINE_ANSWER_INVALID".to_string());
    }
    if notes.len() > 5000 {
        return Err("OFFLINE_NOTES_TOO_LONG".to_string());
    }

    let mut conn = open_db(&app)?;
    let pack = read_pack(&conn)?.ok_or_else(|| "OFFLINE_PACK_MISSING".to_string())?;
    let detail = load_inspection_detail(&conn, &inspection_id, &pack)?;
    if detail.status != "em_andamento" {
        return Err("OFFLINE_INSPECTION_LOCKED".to_string());
    }
    if matches!(detail.sync_state.as_str(), "conflict" | "rejected") {
        return Err("OFFLINE_CONFLICT_REQUIRES_REVIEW".to_string());
    }
    if !detail
        .checklist
        .iter()
        .any(|item| item.requirement_id == requirement_id)
    {
        return Err("OFFLINE_ANSWER_OUT_OF_SCOPE".to_string());
    }

    let now = Utc::now().to_rfc3339();
    let tx = conn
        .transaction()
        .map_err(|error| format!("Falha ao salvar resposta local: {error}"))?;
    tx.execute(
        "INSERT INTO local_answers(inspection_id, requirement_id, result, notes, answered_at)
         VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(inspection_id, requirement_id) DO UPDATE SET
           result = excluded.result,
           notes = excluded.notes,
           answered_at = excluded.answered_at",
        params![inspection_id, requirement_id, result, notes, now],
    )
    .map_err(|error| format!("Falha ao salvar resposta local: {error}"))?;
    tx.execute(
        "UPDATE local_inspections
         SET finalize_requested = 0, sync_state = 'pending', last_error = NULL, updated_at = ?2
         WHERE id = ?1",
        params![inspection_id, now],
    )
    .map_err(|error| format!("Falha ao atualizar inspeção local: {error}"))?;
    queue_snapshot(&tx, &inspection_id)?;
    tx.commit()
        .map_err(|error| format!("Falha ao concluir gravação local: {error}"))?;
    load_inspection_detail(&conn, &inspection_id, &pack)
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
    if detail.status != "em_andamento" {
        return Err("OFFLINE_INSPECTION_LOCKED".to_string());
    }
    if detail.answers.len() != detail.checklist.len() {
        return Err("OFFLINE_CHECKLIST_INCOMPLETE".to_string());
    }
    for item in &detail.checklist {
        let answer = detail
            .answers
            .iter()
            .find(|answer| answer.requirement_id == item.requirement_id)
            .ok_or_else(|| "OFFLINE_CHECKLIST_INCOMPLETE".to_string())?;
        if item.evidence_required && answer.result != "nao_aplicavel" {
            return Err("OFFLINE_EVIDENCE_REQUIRED_ONLINE".to_string());
        }
    }

    let now = Utc::now().to_rfc3339();
    let tx = conn
        .transaction()
        .map_err(|error| format!("Falha ao preparar conclusão local: {error}"))?;
    tx.execute(
        "UPDATE local_inspections
         SET finalize_requested = 1, sync_state = 'pending', last_error = NULL, updated_at = ?2
         WHERE id = ?1",
        params![inspection_id, now],
    )
    .map_err(|error| format!("Falha ao preparar conclusão local: {error}"))?;
    queue_snapshot(&tx, &inspection_id)?;
    tx.commit()
        .map_err(|error| format!("Falha ao salvar conclusão local: {error}"))?;
    load_inspection_detail(&conn, &inspection_id, &pack)
}

#[tauri::command]
pub fn list_offline_inspections(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<LocalInspectionSummary>, String> {
    ensure_offline_window(&window)?;
    let conn = open_db(&app)?;
    let pack = read_pack(&conn)?.ok_or_else(|| "OFFLINE_PACK_MISSING".to_string())?;
    let mut statement = conn
        .prepare(
            "SELECT id FROM local_inspections
             ORDER BY datetime(updated_at) DESC, id DESC",
        )
        .map_err(|error| format!("Falha ao listar inspeções locais: {error}"))?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Falha ao listar inspeções locais: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Falha ao ler inspeções locais: {error}"))?;

    ids.into_iter()
        .map(|id| load_inspection_detail(&conn, &id, &pack).map(summary_from_detail))
        .collect()
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
pub async fn sync_now(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<DesktopStatus, String> {
    ensure_offline_window(&window)?;
    let server_url = current_server_url(&app)?;
    let conn = open_db(&app)?;
    let token = get_meta(&conn, "device_token")?
        .ok_or_else(|| "DEVICE_NOT_PAIRED".to_string())?;
    let mut statement = conn
        .prepare("SELECT payload FROM outbox ORDER BY datetime(created_at), event_id")
        .map_err(|error| format!("Falha ao ler fila de sincronização: {error}"))?;
    let events = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Falha ao ler fila de sincronização: {error}"))?
        .map(|row| {
            row.map_err(|error| format!("Falha ao ler evento local: {error}"))
                .and_then(|raw| {
                    serde_json::from_str::<Value>(&raw)
                        .map_err(|error| format!("Evento local inválido: {error}"))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    drop(conn);

    if events.is_empty() {
        return desktop_status_inner(&app);
    }

    let response = http_client()?
        .post(format!("{server_url}/api/offline/sync"))
        .bearer_auth(token)
        .json(&json!({ "protocolVersion": PROTOCOL_VERSION, "events": events }))
        .send()
        .await
        .map_err(|error| format!("NETWORK:{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("NETWORK:{error}"))?;
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    let sync: SyncResponse = serde_json::from_str(&body)
        .map_err(|error| format!("Resposta de sync inválida: {error}"))?;
    if sync.protocol_version != PROTOCOL_VERSION {
        return Err("OFFLINE_PROTOCOL_UNSUPPORTED".to_string());
    }

    let mut conn = open_db(&app)?;
    let tx = conn
        .transaction()
        .map_err(|error| format!("Falha ao aplicar retorno da sincronização: {error}"))?;
    for result in sync.results {
        match result.status.as_str() {
            "applied" => {
                tx.execute("DELETE FROM outbox WHERE event_id = ?1", params![result.event_id])
                    .map_err(|error| format!("Falha ao confirmar evento sincronizado: {error}"))?;
                tx.execute(
                    "UPDATE local_inspections SET
                       base_server_revision = COALESCE(?2, base_server_revision),
                       status = COALESCE(?3, status),
                       sync_state = 'synced',
                       last_error = NULL,
                       finalize_requested = CASE WHEN ?3 = 'concluida' THEN 0 ELSE finalize_requested END,
                       updated_at = ?4
                     WHERE id = ?1",
                    params![
                        result.entity_id,
                        result.server_revision,
                        result.inspection_status,
                        Utc::now().to_rfc3339()
                    ],
                )
                .map_err(|error| format!("Falha ao atualizar inspeção sincronizada: {error}"))?;
            }
            "conflict" | "rejected" => {
                tx.execute("DELETE FROM outbox WHERE event_id = ?1", params![result.event_id])
                    .map_err(|error| format!("Falha ao encerrar evento rejeitado: {error}"))?;
                tx.execute(
                    "UPDATE local_inspections SET sync_state = ?2, last_error = ?3, updated_at = ?4 WHERE id = ?1",
                    params![
                        result.entity_id,
                        result.status,
                        result.code.unwrap_or_else(|| "SYNC_REJECTED".to_string()),
                        Utc::now().to_rfc3339()
                    ],
                )
                .map_err(|error| format!("Falha ao registrar conflito local: {error}"))?;
            }
            _ => return Err("OFFLINE_SYNC_RESULT_INVALID".to_string()),
        }
    }
    tx.commit()
        .map_err(|error| format!("Falha ao confirmar sincronização local: {error}"))?;
    desktop_status_inner(&app)
}

fn queue_snapshot(conn: &Connection, inspection_id: &str) -> Result<(), String> {
    let row = conn
        .query_row(
            "SELECT silo_id, inspection_type, notes, started_at, checklist_json,
                    base_server_revision, finalize_requested
             FROM local_inspections WHERE id = ?1",
            params![inspection_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .map_err(|error| format!("Inspeção local não encontrada: {error}"))?;
    let checklist: Vec<PackRequirement> = serde_json::from_str(&row.4)
        .map_err(|error| format!("Checklist local inválido: {error}"))?;
    let answers = load_answers(conn, inspection_id)?;
    let event_id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let payload = json!({
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
            "finalize": row.6 != 0,
            "checklist": checklist.iter().map(|item| json!({
                "requirementId": item.requirement_id,
                "requirementVersionId": item.requirement_version_id
            })).collect::<Vec<_>>(),
            "answers": answers
        }
    });
    let serialized = serde_json::to_string(&payload)
        .map_err(|error| format!("Falha ao preparar evento local: {error}"))?;
    conn.execute(
        "INSERT INTO outbox(event_id, inspection_id, payload, created_at)
         VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(inspection_id) DO UPDATE SET
           event_id = excluded.event_id,
           payload = excluded.payload,
           created_at = excluded.created_at",
        params![event_id, inspection_id, serialized, created_at],
    )
    .map_err(|error| format!("Falha ao enfileirar sincronização: {error}"))?;
    Ok(())
}

fn load_answers(conn: &Connection, inspection_id: &str) -> Result<Vec<LocalAnswer>, String> {
    let mut statement = conn
        .prepare(
            "SELECT requirement_id, result, notes, answered_at
             FROM local_answers WHERE inspection_id = ?1 ORDER BY requirement_id",
        )
        .map_err(|error| format!("Falha ao carregar respostas locais: {error}"))?;
    statement
        .query_map(params![inspection_id], |row| {
            Ok(LocalAnswer {
                requirement_id: row.get(0)?,
                result: row.get(1)?,
                notes: row.get(2)?,
                answered_at: row.get(3)?,
            })
        })
        .map_err(|error| format!("Falha ao carregar respostas locais: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Falha ao ler respostas locais: {error}"))
}

fn load_inspection_detail(
    conn: &Connection,
    inspection_id: &str,
    pack: &OfflinePack,
) -> Result<LocalInspectionDetail, String> {
    let row = conn
        .query_row(
            "SELECT id, silo_id, inspection_type, notes, status, sync_state, last_error,
                    base_server_revision, finalize_requested, started_at, updated_at, checklist_json
             FROM local_inspections WHERE id = ?1",
            params![inspection_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                ))
            },
        )
        .map_err(|error| format!("Inspeção local não encontrada: {error}"))?;
    let checklist: Vec<PackRequirement> = serde_json::from_str(&row.11)
        .map_err(|error| format!("Checklist local inválido: {error}"))?;
    let silo_name = pack
        .silos
        .iter()
        .find(|silo| silo.id == row.1)
        .map(|silo| silo.name.clone())
        .unwrap_or_else(|| row.1.clone());

    Ok(LocalInspectionDetail {
        id: row.0,
        silo_id: row.1,
        silo_name,
        inspection_type: row.2,
        notes: row.3,
        status: row.4,
        sync_state: row.5,
        last_error: row.6,
        base_server_revision: row.7,
        finalize_requested: row.8 != 0,
        started_at: row.9,
        updated_at: row.10,
        checklist,
        answers: load_answers(conn, inspection_id)?,
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
        started_at: detail.started_at,
        updated_at: detail.updated_at,
    }
}
