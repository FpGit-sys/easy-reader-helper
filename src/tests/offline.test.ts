import { describe, expect, it } from "vitest";
import {
  generateDeviceToken,
  generatePairingCode,
  normalizePairingCode,
  pairingCodeHash,
  tokenHash,
} from "@/server/offline/crypto";
import { calculateOfflineAllowedUntil } from "@/server/offline/device-auth";\nimport { offlineEventSchema } from "@/server/offline/sync";

describe("protocolo offline", () => {
  it("normaliza código de ativação sem depender da formatação exibida", () => {
    const code = "ABCDEF-GHJKLM-234567";
    expect(normalizePairingCode(` ${code.toLowerCase()} `)).toBe("ABCDEFGHJKLM234567");
    expect(pairingCodeHash(code)).toBe(pairingCodeHash("abcdef ghjklm 234567"));
  });

  it("gera códigos de ativação humanos sem caracteres ambíguos", () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}(?:-[A-HJ-NP-Z2-9]{6}){2}$/);
    expect(normalizePairingCode(code)).toHaveLength(18);
  });

  it("gera token de dispositivo com entropia e persiste somente hash no servidor", () => {
    const first = generateDeviceToken();
    const second = generateDeviceToken();
    expect(first).toMatch(/^slnr_[A-Za-z0-9_-]{40,}$/);
    expect(first).not.toBe(second);
    expect(tokenHash(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash(first)).not.toContain(first);
  });

  it("aceita timestamps RFC3339 com offset produzidos pelo desktop", () => {
    const parsed = offlineEventSchema.safeParse({
      id: "61000000-0000-4000-8000-000000000001",
      type: "inspection.snapshot",
      entityId: "62000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-25T07:28:06+00:00",
      payload: {
        siloId: "63000000-0000-4000-8000-000000000001",
        inspectionType: "Inspeção offline",
        notes: "",
        startedAt: "2026-08-25T04:28:06-03:00",
        baseRevision: 0,
        finalize: false,
        checklist: [
          {
            requirementId: "64000000-0000-4000-8000-000000000001",
            requirementVersionId: "65000000-0000-4000-8000-000000000001",
          },
        ],
        answers: [
          {
            requirementId: "64000000-0000-4000-8000-000000000001",
            result: "atendido",
            notes: "",
            answeredAt: "2026-08-25T07:28:06+00:00",
          },
        ],
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("limita a janela offline ao menor valor entre grace e validade da licença", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    expect(
      calculateOfflineAllowedUntil({ now, offlineGraceDays: 30 }).toISOString(),
    ).toBe("2026-09-23T12:00:00.000Z");

    expect(
      calculateOfflineAllowedUntil({
        now,
        offlineGraceDays: 30,
        licenseValidUntil: new Date("2026-08-31T18:00:00.000Z"),
      }).toISOString(),
    ).toBe("2026-08-31T18:00:00.000Z");
  });
});
