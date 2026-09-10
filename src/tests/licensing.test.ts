import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptInstallationSecret,
  encryptInstallationSecret,
  normalizeLicenseKey,
  verifyEntitlementToken,
} from "@/server/licensing/crypto";

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

describe("licenciamento local", () => {
  it("normaliza a apresentação sem mudar a identidade da licença", () => {
    expect(normalizeLicenseKey("slnr-abcde-fghjk-mnpqr-stuvw-xyz23")).toBe("SLNRABCDEFGHJKMNPQRSTUVWXYZ23");
    expect(() => normalizeLicenseKey("SLNR-curta")).toThrow("LICENSE_KEY_INVALID");
  });

  it("aceita apenas concessões Ed25519 autênticas e vinculadas à instalação", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const installationId = "10000000-0000-4000-8000-000000000001";
    const header = base64Url(JSON.stringify({ alg: "EdDSA", typ: "SLNR" }));
    const payload = base64Url(JSON.stringify({
      iss: "silonr-license-service",
      licenseId: "20000000-0000-4000-8000-000000000001",
      installationId,
      plan: "professional",
      status: "active",
      validUntil: "2026-09-26T00:00:00.000Z",
      graceUntil: "2026-10-03T00:00:00.000Z",
      offlineGraceDays: 7,
      maxFacilities: 1,
      maxUsers: 5,
      maxInstallations: 3,
      entitlementVersion: 1,
      issuedAt: "2026-08-26T00:00:00.000Z",
      expiresAt: "2026-09-02T00:00:00.000Z",
    }));
    const input = `${header}.${payload}`;
    const signature = sign(null, Buffer.from(input), privateKey).toString("base64url");
    const token = `${input}.${signature}`;
    const publicDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(verifyEntitlementToken(token, publicDer, installationId).status).toBe("active");
    expect(() => verifyEntitlementToken(`${input}.${signature.slice(1)}A`, publicDer, installationId)).toThrow("LICENSE_ENTITLEMENT_SIGNATURE_INVALID");
    expect(() => verifyEntitlementToken(token, publicDer, "30000000-0000-4000-8000-000000000001")).toThrow("LICENSE_INSTALLATION_MISMATCH");
  });

  it("protege o segredo da instalação com AES-256-GCM", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptInstallationSecret("segredo-local", key);
    expect(encrypted).not.toContain("segredo-local");
    expect(decryptInstallationSecret(encrypted, key)).toBe("segredo-local");
    expect(() => decryptInstallationSecret(encrypted, randomBytes(32).toString("base64"))).toThrow("LICENSE_SECRET_DECRYPTION_FAILED");
  });
});
