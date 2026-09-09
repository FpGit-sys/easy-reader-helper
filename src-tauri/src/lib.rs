mod offline_v2;
mod secure_store;
mod updates;

use offline_v2 as offline;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{fs, net::IpAddr, path::{Path, PathBuf}, time::Duration};
use tauri::{AppHandle, Manager, WebviewWindow};
use url::Url;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerProbe {
    server_url: String,
    deployment: String,
    live: bool,
    ready: bool,
}

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

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

pub(crate) fn ensure_trusted_application_page(app: &AppHandle, window: &WebviewWindow) -> Result<Url, String> {
    let current = window
        .url()
        .map_err(|error| format!("Não foi possível validar a origem da janela: {error}"))?;
    if matches!(current.host_str(), Some("tauri.localhost") | Some("localhost")) {
        return Ok(current);
    }

    let local_server = Url::parse("https://silonr.local").expect("fixed local server URL");
    if local_launch_requested(std::env::args()) && same_origin(&current, &local_server) {
        return Ok(current);
    }

    if let Some(config) = read_config(app)? {
        let configured = validate_server_url(&config.server_url)?;
        if same_origin(&current, &configured) {
            return Ok(current);
        }
    }
    Err("A página atual não tem permissão para acessar arquivos deste computador.".into())
}

fn safe_filename(value: &str, fallback: &str) -> String {
    let candidate = value
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0'..='\u{1f}' => '_',
            _ => character,
        })
        .collect::<String>()
        .trim_matches(|character| character == ' ' || character == '.')
        .chars()
        .take(180)
        .collect::<String>();
    if candidate.is_empty() { fallback.to_string() } else { candidate }
}

fn available_download_path(download_dir: &Path, filename: &str) -> PathBuf {
    let requested = download_dir.join(filename);
    if !requested.exists() {
        return requested;
    }
    let path = Path::new(filename);
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("arquivo");
    let extension = path.extension().and_then(|value| value.to_str());
    for number in 2..10_000 {
        let next = match extension {
            Some(extension) => format!("{stem} ({number}).{extension}"),
            None => format!("{stem} ({number})"),
        };
        let candidate = download_dir.join(next);
        if !candidate.exists() {
            return candidate;
        }
    }
    download_dir.join(format!("{stem}-{}", uuid::Uuid::new_v4()))
}

#[cfg(windows)]
fn open_with_default_application(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let operation = "open\0".encode_utf16().collect::<Vec<_>>();
    let target = path.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        return Err("O Windows não encontrou um aplicativo para abrir o arquivo.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn open_with_default_application(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedFile {
    path: String,
    opened_externally: bool,
}

fn save_download(app: &AppHandle, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|error| format!("Não foi possível localizar a pasta Downloads: {error}"))?;
    fs::create_dir_all(&download_dir)
        .map_err(|error| format!("Não foi possível preparar a pasta Downloads: {error}"))?;
    let path = available_download_path(&download_dir, &safe_filename(filename, "silonr-arquivo"));
    fs::write(&path, bytes).map_err(|error| format!("Não foi possível salvar o arquivo: {error}"))?;
    Ok(path)
}

#[tauri::command]
fn save_pdf_and_open(
    app: AppHandle,
    window: WebviewWindow,
    filename: String,
    content_base64: String,
) -> Result<SavedFile, String> {
    ensure_trusted_application_page(&app, &window)?;
    let bytes = BASE64_STANDARD
        .decode(content_base64)
        .map_err(|_| "O PDF gerado está corrompido.".to_string())?;
    if bytes.len() > 50 * 1024 * 1024 || !bytes.starts_with(b"%PDF-") {
        return Err("O conteúdo gerado não é um PDF válido ou excede 50 MB.".into());
    }
    let filename = if filename.to_ascii_lowercase().ends_with(".pdf") {
        filename
    } else {
        format!("{filename}.pdf")
    };
    let path = save_download(&app, &filename, &bytes)?;
    open_with_default_application(&path)?;
    Ok(SavedFile { path: path.display().to_string(), opened_externally: true })
}

#[tauri::command]
async fn download_and_open_file(
    app: AppHandle,
    window: WebviewWindow,
    url: String,
    filename: String,
) -> Result<SavedFile, String> {
    let current = ensure_trusted_application_page(&app, &window)?;
    let download_url = Url::parse(&url).map_err(|_| "Endereço de download inválido.".to_string())?;
    if !same_origin(&current, &download_url) || download_url.scheme() != "https" {
        return Err("O download foi recusado porque não pertence ao servidor SiloNR atual.".into());
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("Não foi possível preparar o download: {error}"))?
        .get(download_url)
        .send()
        .await
        .map_err(|error| format!("Não foi possível baixar o arquivo: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("O servidor recusou o download (HTTP {}).", response.status()));
    }
    if response.content_length().is_some_and(|length| length > 100 * 1024 * 1024) {
        return Err("O arquivo excede o limite de 100 MB.".into());
    }
    let bytes = response.bytes().await.map_err(|error| format!("Download incompleto: {error}"))?;
    if bytes.len() > 100 * 1024 * 1024 {
        return Err("O arquivo excede o limite de 100 MB.".into());
    }
    let path = save_download(&app, &filename, &bytes)?;
    open_with_default_application(&path)?;
    Ok(SavedFile { path: path.display().to_string(), opened_externally: true })
}

#[tauri::command]
fn get_saved_server_url(app: AppHandle, window: WebviewWindow) -> Result<Option<String>, String> {
    ensure_local_configuration_page(&window)?;
    Ok(read_config(&app)?.map(|config| config.server_url))
}

fn deployment_kind(url: &Url) -> &'static str {
    match url.host_str().and_then(|host| host.parse::<IpAddr>().ok()) {
        Some(IpAddr::V4(ip)) if ip.is_private() || ip.is_loopback() => "local",
        _ => "cloud",
    }
}

#[tauri::command]
async fn probe_server(window: WebviewWindow, server_url: String) -> Result<ServerProbe, String> {
    ensure_local_configuration_page(&window)?;
    check_server(&server_url).await
}

async fn check_server(server_url: &str) -> Result<ServerProbe, String> {
    let parsed = validate_server_url(server_url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("Não foi possível preparar o teste: {error}"))?;

    async fn healthy(client: &reqwest::Client, base: &Url, path: &str) -> Result<bool, String> {
        let endpoint = base.join(path).map_err(|_| "Endereço do servidor inválido.".to_string())?;
        let response = client
            .get(endpoint)
            .send()
            .await
            .map_err(|error| format!("NETWORK: {error}"))?;
        Ok(response.status().is_success())
    }

    let live = healthy(&client, &parsed, "api/health/live").await?;
    let ready = healthy(&client, &parsed, "api/health/ready").await?;
    if !live || !ready {
        return Err("O servidor respondeu, mas ainda não está pronto para uso.".into());
    }

    Ok(ServerProbe {
        server_url: parsed.as_str().trim_end_matches('/').to_string(),
        deployment: deployment_kind(&parsed).to_string(),
        live,
        ready,
    })
}

pub(crate) fn local_launch_requested(args: impl Iterator<Item = String>) -> bool {
    args.skip(1).any(|arg| arg == "--local-server")
}

#[tauri::command]
async fn open_local_server(window: WebviewWindow) -> Result<bool, String> {
    ensure_local_configuration_page(&window)?;
    if !local_launch_requested(std::env::args()) {
        return Ok(false);
    }
    // The unified installer shortcut selects a fixed origin, never a URL from argv.
    let server = "https://silonr.local";
    check_server(server).await?;
    let mut destination = validate_server_url(server)?;
    destination.set_path("/app/dashboard");
    window
        .navigate(destination)
        .map_err(|error| format!("Nao foi possivel abrir o servidor local: {error}"))?;
    Ok(true)
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

#[cfg(test)]
mod tests {
    use super::{deployment_kind, local_launch_requested, validate_server_url};
    use url::Url;

    #[test]
    fn rejects_plain_http_on_lan() {
        assert!(validate_server_url("http://192.168.1.50").is_err());
    }

    #[test]
    fn accepts_https_local_server() {
        let url = validate_server_url("https://192.168.1.50").expect("private HTTPS URL");
        assert_eq!(deployment_kind(&url), "local");
    }

    #[test]
    fn classifies_public_hostname_as_cloud() {
        let url = Url::parse("https://silonr.example.com").expect("valid URL");
        assert_eq!(deployment_kind(&url), "cloud");
    }

    #[test]
    fn local_launch_requires_explicit_flag() {
        assert!(local_launch_requested(
            ["silonr.exe", "--local-server"].into_iter().map(str::to_string)
        ));
        assert!(!local_launch_requested(
            ["silonr.exe"].into_iter().map(str::to_string)
        ));
        assert!(!local_launch_requested(
            ["--local-server"].into_iter().map(str::to_string)
        ));
        assert!(!local_launch_requested(
            ["silonr.exe", "--local-server=https://other.example"]
                .into_iter()
                .map(str::to_string)
        ));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_saved_server_url,
            probe_server,
            connect_to_server,
            open_online,
            open_local_server,
            save_pdf_and_open,
            download_and_open_file,
            updates::check_for_update,
            updates::install_update,
            offline::desktop_status,
            offline::pair_device,
            offline::refresh_offline_pack,
            offline::list_offline_silos,
            offline::start_offline_inspection,
            offline::save_offline_answer,
            offline::add_offline_evidence,
            offline::remove_offline_evidence,
            offline::request_offline_finalize,
            offline::list_offline_inspections,
            offline::get_offline_inspection,
            offline::sync_now
        ])
        .setup(|app| {
            offline::initialize(app.handle()).map_err(std::io::Error::other)?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("SiloNR — Desktop e modo offline")?;
                if local_launch_requested(std::env::args()) {
                    window.maximize()?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o SiloNR Desktop");
}
