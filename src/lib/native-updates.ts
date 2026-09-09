export interface DesktopUpdate {
  supported: boolean;
  currentVersion: string;
  available: boolean;
  version: string | null;
  notes: string | null;
  publishedAt: string | null;
  mandatory: boolean;
  message: string | null;
}

type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function invoke(): NativeInvoke | null {
  const tauriWindow = window as typeof window & {
    __TAURI__?: { core?: { invoke?: NativeInvoke } };
  };
  return tauriWindow.__TAURI__?.core?.invoke ?? null;
}

export async function checkDesktopUpdate(): Promise<DesktopUpdate | null> {
  const native = invoke();
  return native ? native<DesktopUpdate>("check_for_update") : null;
}

export async function installDesktopUpdate(): Promise<boolean> {
  const native = invoke();
  if (!native) throw new Error("Abra o SiloNR pelo atalho instalado no PC servidor para atualizar.");
  return native<boolean>("install_update");
}
