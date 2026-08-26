import { createHash, randomBytes } from "node:crypto";

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizePairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function generatePairingCode(): string {
  const bytes = randomBytes(18);
  let compact = "";
  for (const byte of bytes) compact += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  return compact.match(/.{1,6}/g)?.join("-") ?? compact;
}

export function pairingCodeHash(value: string): string {
  return sha256Hex(normalizePairingCode(value));
}

export function generateDeviceToken(): string {
  return `slnr_${randomBytes(32).toString("base64url")}`;
}

export function tokenHash(value: string): string {
  return sha256Hex(value.trim());
}

export function bearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || null;
}
