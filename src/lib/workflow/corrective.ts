export type CorrectiveActionStatus =
  | "nao_iniciada"
  | "em_andamento"
  | "aguardando_evidencia"
  | "concluida"
  | "cancelada";

export type NonconformityStatus = "aberta" | "em_tratamento" | "resolvida" | "cancelada";

const ACTION_TRANSITIONS: Record<CorrectiveActionStatus, ReadonlySet<CorrectiveActionStatus>> = {
  nao_iniciada: new Set(["em_andamento", "aguardando_evidencia", "cancelada"]),
  em_andamento: new Set(["aguardando_evidencia", "cancelada"]),
  aguardando_evidencia: new Set(["em_andamento", "cancelada"]),
  concluida: new Set(["em_andamento"]),
  cancelada: new Set([]),
};

const NONCONFORMITY_TRANSITIONS: Record<NonconformityStatus, ReadonlySet<NonconformityStatus>> = {
  aberta: new Set(["em_tratamento", "cancelada"]),
  em_tratamento: new Set(["resolvida", "cancelada"]),
  resolvida: new Set(["em_tratamento"]),
  cancelada: new Set([]),
};

export function canTransitionCorrectiveAction(
  from: CorrectiveActionStatus,
  to: CorrectiveActionStatus,
): boolean {
  return from === to || ACTION_TRANSITIONS[from].has(to);
}

export function canTransitionNonconformity(
  from: NonconformityStatus,
  to: NonconformityStatus,
): boolean {
  return from === to || NONCONFORMITY_TRANSITIONS[from].has(to);
}

export function assertActionCanBeCompleted(evidenceCount: number): void {
  if (evidenceCount < 1) throw new Error("ACTION_COMPLETION_EVIDENCE_REQUIRED");
}

export function assertNonconformityCanBeResolved(input: {
  linkedActionCount: number;
  openActionCount: number;
}): void {
  if (input.linkedActionCount < 1) throw new Error("NONCONFORMITY_ACTION_REQUIRED");
  if (input.openActionCount > 0) throw new Error("NONCONFORMITY_OPEN_ACTIONS");
}
