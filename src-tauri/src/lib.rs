use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, WebviewWindow};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DesktopConfig {
    server_url: String,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Não foi possível localizar a pasta de configuração: {error}"))?;
    Ok(dir.join("desktop.json"))
}

fn read_config(app: &AppHandle) -> Result<Option<DesktopConfig>, String> {
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

fn validate_server_url(value: &str) -> Result<Url, String> {
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

fn ensure_local_configuration_page(window: &WebviewWindow) -> Result<(), String> {
    let current = window
        .url()
        .map_err(|error| format!("Não foi possível validar a origem da janela: {error}"))?;
    let is_local = matches!(current.scheme(), "tauri" | "http" | "https")
        && matches!(current.host_str(), Some("tauri.localhost") | Some("localhost"));

    if !is_local {
        return Err("A configuração do servidor só pode ser alterada pela tela local do instalador.".into());
    }

    Ok(())
}

#[tauri::command]
fn get_saved_server_url(app: AppHandle) -> Result<Option<String>, String> {
    Ok(read_config(&app)?.map(|config| config.server_url))
}

#[tauri::command]
fn connect_to_server(app: AppHandle, window: WebviewWindow, server_url: String) -> Result<(), String> {
    ensure_local_configuration_page(&window)?;
    let parsed = validate_server_url(&server_url)?;
    let path = config_path(&app)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Não foi possível criar a pasta de configuração: {error}"))?;
    }

    let config = DesktopConfig {
        server_url: parsed.as_str().trim_end_matches('/').to_string(),
    };
    let serialized = serde_json::to_vec_pretty(&config)
        .map_err(|error| format!("Não foi possível preparar a configuração: {error}"))?;
    fs::write(path, serialized)
        .map_err(|error| format!("Não foi possível salvar a configuração: {error}"))?;

    window
        .navigate(parsed)
        .map_err(|error| format!("Não foi possível abrir o servidor SiloNR: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_saved_server_url,
            connect_to_server
        ])
        .setup(|app| {
            if let Some(config) = read_config(app.handle())? {
                if let Ok(url) = validate_server_url(&config.server_url) {
                    if let Some(window) = app.get_webview_window("main") {
                        window.navigate(url)?;
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o SiloNR Desktop");
}
