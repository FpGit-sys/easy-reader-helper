import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";
import { z } from "zod";

export const centralLicenseStatusSchema = z.enum([
  "available",
  "trial",
  "active",
  "past_due",
  "suspended",
  "expired",
  "cancelled",
]);

const entitlementSchema = z.object({
  iss: z.string().min(1),
  licenseId: z.string().uuid(),
  installationId: z.string().uuid(),
  plan: z.string().min(1).max(80),
  status: centralLicenseStatusSchema,
  validUntil: z.string().datetime().nullable(),
  graceUntil: z.string().datetime(),
  offlineGraceDays: z.number().int().min(0).max(30),
  maxFacilities: z.number().int().positive(),
  maxUsers: z.number().int().positive(),
  maxInstallations: z.number().int().positive(),
  entitlementVersion: z.number().int().nonnegative(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export type EntitlementClaims = z.infer<typeof entitlementSchema>;

export function normalizeLicenseKey(value: string): string {
  const compact = value.trim().toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  if (!/^SLNR[A-Z0-9]{25}$/.test(compact)) throw new Error("LICENSE_KEY_INVALID");
  return compact;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function generateInstallationSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function verifyEntitlementToken(
  token: string,
  publicKeyBase64: string,
  expectedInstallationId?: string,
): EntitlementClaims {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("LICENSE_ENTITLEMENT_MALFORMED");
  }
  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("LICENSE_ENTITLEMENT_MALFORMED");
  }
  if (!header || typeof header !== "object" || (header as { alg?: unknown }).alg !== "EdDSA" || (header as { typ?: unknown }).typ !== "SLNR") {
    throw new Error("LICENSE_ENTITLEMENT_HEADER_INVALID");
  }

  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(publicKeyBase64.replaceAll(/\s/g, ""), "base64"),
      format: "der",
      type: "spki",
    });
  } catch {
    throw new Error("LICENSE_PUBLIC_KEY_INVALID");
  }
  const valid = verify(
    null,
    Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"),
    publicKey,
    Buffer.from(parts[2], "base64url"),
  );
  if (!valid) throw new Error("LICENSE_ENTITLEMENT_SIGNATURE_INVALID");

  const parsed = entitlementSchema.safeParse(claims);
  if (!parsed.success) throw new Error("LICENSE_ENTITLEMENT_CLAIMS_INVALID");
  if (expectedInstallationId && parsed.data.installationId !== expectedInstallationId) {
    throw new Error("LICENSE_INSTALLATION_MISMATCH");
  }
  if (new Date(parsed.data.expiresAt).getTime() <= new Date(parsed.data.issuedAt).getTime()) {
    throw new Error("LICENSE_ENTITLEMENT_TIME_INVALID");
  }
  return parsed.data;
}

function encryptionKey(value: string): Buffer {
  const key = Buffer.from(value.replaceAll(/\s/g, ""), "base64");
  if (key.length !== 32) throw new Error("LICENSE_ENCRYPTION_KEY_INVALID");
  return key;
}

export function encryptInstallationSecret(secret: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyBase64), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptInstallationSecret(encrypted: string, keyBase64: string): string {
  const [version, iv, tag, ciphertext] = encrypted.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("LICENSE_SECRET_MALFORMED");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(keyBase64), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("LICENSE_SECRET_DECRYPTION_FAILED");
  }
}
