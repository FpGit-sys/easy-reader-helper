import { describe, expect, it } from "vitest";
import {
  assertActionCanBeCompleted,
  assertNonconformityCanBeResolved,
  canTransitionCorrectiveAction,
  canTransitionNonconformity,
} from "@/lib/workflow/corrective";

describe("corrective action workflow", () => {
  it("requires evidence before completion", () => {
    expect(() => assertActionCanBeCompleted(0)).toThrow("ACTION_COMPLETION_EVIDENCE_REQUIRED");
    expect(() => assertActionCanBeCompleted(1)).not.toThrow();
  });

  it("allows operational transitions but keeps completion explicit", () => {
    expect(canTransitionCorrectiveAction("nao_iniciada", "em_andamento")).toBe(true);
    expect(canTransitionCorrectiveAction("em_andamento", "aguardando_evidencia")).toBe(true);
    expect(canTransitionCorrectiveAction("aguardando_evidencia", "concluida")).toBe(false);
    expect(canTransitionCorrectiveAction("concluida", "em_andamento")).toBe(true);
  });
});

describe("nonconformity workflow", () => {
  it("requires at least one completed corrective action before resolution", () => {
    expect(() =>
      assertNonconformityCanBeResolved({ linkedActionCount: 0, openActionCount: 0 }),
    ).toThrow("NONCONFORMITY_ACTION_REQUIRED");
    expect(() =>
      assertNonconformityCanBeResolved({ linkedActionCount: 2, openActionCount: 1 }),
    ).toThrow("NONCONFORMITY_OPEN_ACTIONS");
    expect(() =>
      assertNonconformityCanBeResolved({ linkedActionCount: 2, openActionCount: 0 }),
    ).not.toThrow();
  });

  it("supports reopening a resolved nonconformity for treatment", () => {
    expect(canTransitionNonconformity("aberta", "em_tratamento")).toBe(true);
    expect(canTransitionNonconformity("em_tratamento", "resolvida")).toBe(true);
    expect(canTransitionNonconformity("resolvida", "em_tratamento")).toBe(true);
    expect(canTransitionNonconformity("resolvida", "aberta")).toBe(false);
  });
});
