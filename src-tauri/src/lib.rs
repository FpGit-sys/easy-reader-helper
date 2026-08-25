mod offline;

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, WebviewWindow};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct DesktopConfig {
    pub(crate) server_url: String,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Não foi possível localizar a pasta de configuração: {error}"))?;
    Ok(dir.join("desktop.json"))
}

pub(crate) fn read_config(app: &AppHandle) -> Result<Option<DesktopConfig>, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Não foi possível ler a configuração local: {error}"))?;
    let config = serde_json::from_str::<DesktopConfig>(&raw)
        .map_err(|error| format!("Configuração local inválida: {error}"))?;
    Ok(Some(config))
}

pub(crate) fn write_config(app: &AppHandle, config: DesktopConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Não foi possível criar a pasta de configuração: {error}"))?;
    }
    let serialized = serde_json::to_vec_pretty(&config)
        .map_err(|error| format!("Não foi possível preparar a configuração: {error}"))?;
    fs::write(path, serialized)
        .map_err(|error| format!("Não foi possível salvar a configuração: {error}"))
}

pub(crate) fn validate_server_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|_| "Endereço do servidor inválido.".to_string())?;
    let local_dev = matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"));

    if url.scheme() != "https" && !(local_dev && url.scheme() == "http") {
        return Err("O servidor deve usar HTTPS. HTTP é aceito somente em localhost para desenvolvimento.".into());
    }
    if url.username() != "" || url.password().is_some() {
        return Err("Não inclua usuário ou senha no endereço do servidor.".into());
    }
    if url.host_str().is_none() {
        return Err("O endereço precisa conter um domínio ou host válido.".into());
    }
    Ok(url)
}

pub(crate) fn ensure_local_configuration_page(window: &WebviewWindow) -> Result<(), String> {
    let current = window
        .url()
        .map_err(|error| format!("Não foi possível validar a origem da janela: {error}"))?;
    let is_local = matches!(current.scheme(), "tauri" | "http" | "https")
        && matches!(current.host_str(), Some("tauri.localhost") | Some("localhost"));

    if !is_local {
        return Err("Comandos locais do SiloNR só podem ser usados pela interface empacotada do aplicativo.".into());
    }
    Ok(())
}

#[tauri::command]
fn get_saved_server_url(app: AppHandle, window: WebviewWindow) -> Result<Option<String>, String> {
    ensure_local_configuration_page(&window)?;
    Ok(read_config(&app)?.map(|config| config.server_url))
}

#[tauri::command]
fn connect_to_server(app: AppHandle, window: WebviewWindow, server_url: String) -> Result<(), String> {
    ensure_local_configuration_page(&window)?;
    let parsed = validate_server_url(&server_url)?;
    write_config(
        &app,
        DesktopConfig {
            server_url: parsed.as_str().trim_end_matches('/').to_string(),
        },
    )?;
    window
        .navigate(parsed)
        .map_err(|error| format!("Não foi possível abrir o servidor SiloNR: {error}"))
}

#[tauri::command]
fn open_online(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    ensure_local_configuration_page(&window)?;
    let config = read_config(&app)?.ok_or_else(|| "SERVER_NOT_CONFIGURED".to_string())?;
    let parsed = validate_server_url(&config.server_url)?;
    window
        .navigate(parsed)
        .map_err(|error| format!("Não foi possível abrir o SiloNR online: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_saved_server_url,
            connect_to_server,
            open_online,
            offline::desktop_status,
            offline::pair_device,
            offline::refresh_offline_pack,
            offline::list_offline_silos,
            offline::start_offline_inspection,
            offline::save_offline_answer,
            offline::request_offline_finalize,
            offline::list_offline_inspections,
            offline::get_offline_inspection,
            offline::sync_now
        ])
        .setup(|app| {
            offline::initialize(app.handle()).map_err(std::io::Error::other)?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("SiloNR — Desktop e modo offline")?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o SiloNR Desktop");
}
