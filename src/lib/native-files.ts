interface NativeFileResult {
  path: string;
  openedExternally: boolean;
}

type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function nativeInvoke(): NativeInvoke | null {
  const tauriWindow = window as typeof window & {
    __TAURI__?: { core?: { invoke?: NativeInvoke } };
  };
  return tauriWindow.__TAURI__?.core?.invoke ?? null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

export async function savePdfForUser(
  filename: string,
  pdf: ArrayBuffer,
): Promise<NativeFileResult | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  return invoke<NativeFileResult>("save_pdf_and_open", {
    filename,
    contentBase64: bytesToBase64(new Uint8Array(pdf)),
  });
}

export async function downloadAndOpenForUser(
  url: string,
  filename: string,
): Promise<NativeFileResult | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  return invoke<NativeFileResult>("download_and_open_file", { url, filename });
}

export function openDownloadInBrowser(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
