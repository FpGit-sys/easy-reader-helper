import { useSyncExternalStore } from "react";
import { buildDemoState, DEMO_USER } from "@/data/demo/demoData";
import type { AppState, AuditEntry } from "@/types";

const KEY = "silonr:state:v1";

let state: AppState = buildDemoState();
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // quota exceeded — o ambiente demonstrativo segue em memória
    console.warn("SiloNR: não foi possível persistir localmente (limite de armazenamento).");
  }
}

export function hydrateStore() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.requirements)) {
        state = parsed;
      }
    } else {
      persist();
    }
  } catch {
    state = buildDemoState();
  }
  emit();
}

export function getState(): AppState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshotState = buildDemoState();
export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(serverSnapshotState),
  );
}

export function setState(updater: (s: AppState) => AppState) {
  state = updater(state);
  persist();
  emit();
}

export function logAudit(entry: Omit<AuditEntry, "id" | "data" | "usuario">) {
  setState((s) => ({
    ...s,
    audit: [
      {
        id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        data: new Date().toISOString(),
        usuario: DEMO_USER,
        ...entry,
      },
      ...s.audit,
    ],
  }));
}

export function resetDemo() {
  state = buildDemoState();
  persist();
  emit();
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function nextCode(prefix: string, existing: { codigo: string }[]) {
  const n = existing.length + 1;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}
