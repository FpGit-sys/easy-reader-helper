use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, time::Duration};
use tauri::{AppHandle, Manager, WebviewWindow};
use url::Url;

use crate::{ensure_trusted_application_page, local_launch_requested};

const DEFAULT_MANIFEST_URL: &str =
    "https://github.com/FpGit-sys/easy-reader-helper/releases/latest/download/silonr-update.json";
const MAX_INSTALLER_BYTES: u64 = 500 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct SignedManifest {
    payload: String,
    signature: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePayload {
    version: String,
    url: String,
    sha256: String,
    notes: String,
    published_at: String,
    mandatory: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheck {
    supported: bool,
    current_version: String,
    available: bool,
    version: Option<String>,
    notes: Option<String>,
    published_at: Option<String>,
    mandatory: bool,
    message: Option<String>,
}

fn current_version() -> &'static str {
    option_env!("SILONR_APP_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}

fn manifest_url() -> &'static str {
    option_env!("SILONR_UPDATE_MANIFEST_URL").unwrap_or(DEFAULT_MANIFEST_URL)
}

fn parse_version(value: &str) -> Result<(u64, u64, u64), String> {
    let core = value
        .trim()
        .trim_start_matches('v')
        .split(|character| character == '-' || character == '+')
        .next()
        .unwrap_or("");
    let parts = core.split('.').collect::<Vec<_>>();
    if parts.len() != 3 {
        return Err("Versão de atualização inválida.".into());
    }
    let parse = |part: &str| {
        part.parse::<u64>()
            .map_err(|_| "Versão de atualização inválida.".to_string())
    };
    Ok((parse(parts[0])?, parse(parts[1])?, parse(parts[2])?))
}

fn verify_manifest(raw: &[u8]) -> Result<UpdatePayload, String> {
    let public_key = option_env!("SILONR_UPDATE_PUBLIC_KEY")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "UPDATE_NOT_CONFIGURED".to_string())?;
    let manifest: SignedManifest = serde_json::from_slice(raw)
        .map_err(|_| "O manifesto de atualização está corrompido.".to_string())?;
    let payload_bytes = URL_SAFE_NO_PAD
        .decode(manifest.payload)
        .map_err(|_| "O conteúdo assinado da atualização é inválido.".to_string())?;
    let public_bytes = URL_SAFE_NO_PAD
        .decode(public_key)
        .map_err(|_| "A chave pública de atualizações é inválida.".to_string())?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(manifest.signature)
        .map_err(|_| "A assinatura da atualização é inválida.".to_string())?;
    let verifying_key = VerifyingKey::from_bytes(
        public_bytes
            .as_slice()
            .try_into()
            .map_err(|_| "A chave pública de atualizações deve ter 32 bytes.".to_string())?,
    )
    .map_err(|_| "A chave pública de atualizações foi recusada.".to_string())?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| "A assinatura da atualização tem tamanho inválido.".to_string())?;
    verifying_key
        .verify(&payload_bytes, &signature)
        .map_err(|_| "A assinatura digital da atualização não confere.".to_string())?;
    let payload: UpdatePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| "Os dados assinados da atualização são inválidos.".to_string())?;
    parse_version(&payload.version)?;
    if payload.sha256.len() != 64
        || !payload.sha256.chars().all(|character| character.is_ascii_hexdigit())
    {
        return Err("O SHA-256 assinado da atualização é inválido.".into());
    }
    let url = Url::parse(&payload.url)
        .map_err(|_| "A URL assinada da atualização é inválida.".to_string())?;
    if url.scheme() != "https"
        || !matches!(url.host_str(), Some("github.com") | Some("objects.githubusercontent.com"))
    {
        return Err("A atualização não aponta para um host HTTPS autorizado.".into());
    }
    Ok(payload)
}

async fn fetch_manifest() -> Result<UpdatePayload, String> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Não foi possível preparar a verificação: {error}"))?
        .get(manifest_url())
        .send()
        .await
        .map_err(|error| format!("Não foi possível consultar atualizações: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "O servidor de atualizações respondeu HTTP {}.",
            response.status()
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Manifesto incompleto: {error}"))?;
    verify_manifest(&bytes)
}

#[tauri::command]
pub(crate) async fn check_for_update(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<UpdateCheck, String> {
    ensure_trusted_application_page(&app, &window)?;
    let current = current_version().to_string();
    if !local_launch_requested(std::env::args()) {
        return Ok(UpdateCheck {
            supported: false,
            current_version: current,
            available: false,
            version: None,
            notes: None,
            published_at: None,
            mandatory: false,
            message: Some("As atualizações do servidor aparecem somente no PC servidor.".into()),
        });
    }
    if option_env!("SILONR_UPDATE_PUBLIC_KEY").is_none_or(|value| value.trim().is_empty()) {
        return Ok(UpdateCheck {
            supported: false,
            current_version: current,
            available: false,
            version: None,
            notes: None,
            published_at: None,
            mandatory: false,
            message: Some(
                "Atualizações automáticas ainda não foram configuradas nesta compilação.".into(),
            ),
        });
    }
    let payload = fetch_manifest().await?;
    let available = parse_version(&payload.version)? > parse_version(&current)?;
    Ok(UpdateCheck {
        supported: true,
        current_version: current,
        available,
        version: Some(payload.version),
        notes: Some(payload.notes),
        published_at: Some(payload.published_at),
        mandatory: payload.mandatory,
        message: None,
    })
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Não foi possível verificar o instalador: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

#[cfg(windows)]
fn launch_elevated_installer(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let operation = "runas\0".encode_utf16().collect::<Vec<_>>();
    let target = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let arguments = "/SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS\0"
        .encode_utf16()
        .collect::<Vec<_>>();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            arguments.as_ptr(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        return Err(
            "A atualização foi cancelada ou o Windows não autorizou o instalador.".into(),
        );
    }
    Ok(())
}

#[cfg(not(windows))]
fn launch_elevated_installer(_path: &Path) -> Result<(), String> {
    Err("A instalação automática está disponível somente no Windows.".into())
}

#[tauri::command]
pub(crate) async fn install_update(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<bool, String> {
    ensure_trusted_application_page(&app, &window)?;
    if !local_launch_requested(std::env::args()) {
        return Err(
            "A atualização do servidor deve ser iniciada no atalho principal do PC servidor."
                .into(),
        );
    }
    let payload = fetch_manifest().await?;
    if parse_version(&payload.version)? <= parse_version(current_version())? {
        return Err("Nenhuma atualização mais recente está disponível.".into());
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| format!("Não foi possível preparar a atualização: {error}"))?
        .get(&payload.url)
        .send()
        .await
        .map_err(|error| format!("Não foi possível baixar a atualização: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "O download da atualização respondeu HTTP {}.",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_INSTALLER_BYTES)
    {
        return Err("O instalador excede o limite de 500 MB.".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Atualização incompleta: {error}"))?;
    if bytes.len() as u64 > MAX_INSTALLER_BYTES || !bytes.starts_with(b"MZ") {
        return Err(
            "O arquivo baixado não é um instalador Windows válido ou excede 500 MB.".into(),
        );
    }
    let update_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Não foi possível localizar a pasta temporária: {error}"))?
        .join("updates");
    fs::create_dir_all(&update_dir)
        .map_err(|error| format!("Não foi possível preparar a atualização: {error}"))?;
    let path = update_dir.join(format!("SiloNR-Servidor-Setup-{}.exe", payload.version));
    fs::write(&path, &bytes)
        .map_err(|error| format!("Não foi possível salvar a atualização: {error}"))?;
    if sha256_file(&path)?.to_ascii_lowercase() != payload.sha256.to_ascii_lowercase() {
        let _ = fs::remove_file(&path);
        return Err("O SHA-256 do instalador não confere. A atualização foi descartada.".into());
    }
    launch_elevated_installer(&path)?;
    app.exit(0);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn orders_release_versions() {
        assert!(parse_version("0.3.0").unwrap() > parse_version("0.2.2").unwrap());
        assert_eq!(parse_version("v1.2.3").unwrap(), (1, 2, 3));
    }

    #[test]
    fn rejects_incomplete_versions() {
        assert!(parse_version("1.2").is_err());
        assert!(parse_version("latest").is_err());
    }
}
