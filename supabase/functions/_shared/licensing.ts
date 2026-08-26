declare const Deno: { env: { get(name: string): string | undefined } };

export type CentralLicenseStatus =
  | "available"
  | "trial"
  | "active"
  | "past_due"
  | "suspended"
  | "expired"
  | "cancelled";

export interface CentralEntitlementRecord {
  licenseId: string;
  installationId: string;
  plan: string;
  status: CentralLicenseStatus;
  validUntil: string | null;
  graceUntil: string;
  offlineGraceDays: number;
  maxFacilities: number;
  maxUsers: number;
  maxInstallations: number;
  entitlementVersion: number;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`CONFIGURATION_MISSING:${name}`);
  return value;
}

export function normalizeLicenseKey(value: string): string {
  return value.trim().toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function authorizeLicenseClient(request: Request): Promise<void> {
  const supplied = request.headers.get("x-silonr-license-key") ?? "";
  if (!await constantTimeEqual(supplied, env("LICENSE_CLIENT_API_KEY"))) {
    throw new Error("LICENSE_CLIENT_UNAUTHORIZED");
  }
}

function supabaseAdminKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, unknown>;
    const current = typeof keys.default === "string" ? keys.default.trim() : "";
    if (current) return current;
  } catch {
    // The configuration error below intentionally avoids logging secret material.
  }
  throw new Error("CONFIGURATION_MISSING:SUPABASE_ADMIN_KEY");
}

export async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const adminKey = supabaseAdminKey();
  const headers: Record<string, string> = {
    apikey: adminKey,
    "content-type": "application/json",
  };
  if (adminKey.split(".").length === 3) headers.authorization = `Bearer ${adminKey}`;
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.message?.match(/[A-Z][A-Z0-9_]+/)?.[0] ?? "LICENSE_DATABASE_ERROR");
  }
  return payload as T;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll(/\s/g, ""));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function signEntitlement(record: CentralEntitlementRecord): Promise<string> {
  const issuedAt = new Date();
  const graceUntil = new Date(record.graceUntil);
  const requestedTtlDays = Number(Deno.env.get("LICENSE_TOKEN_TTL_DAYS") ?? "7");
  const ttlDays = Number.isFinite(requestedTtlDays) ? Math.min(Math.max(requestedTtlDays, 1), 30) : 7;
  const normalExpiry = new Date(issuedAt.getTime() + ttlDays * 86_400_000);
  const usable = record.status === "trial" || record.status === "active" || record.status === "past_due";
  const expiresAt = usable
    ? new Date(Math.min(graceUntil.getTime(), normalExpiry.getTime()))
    : new Date(issuedAt.getTime() + 5 * 60_000);

  const header = base64Url(JSON.stringify({ alg: "EdDSA", typ: "SLNR" }));
  const payload = base64Url(JSON.stringify({
    iss: Deno.env.get("LICENSE_ISSUER")?.trim() || "silonr-license-service",
    licenseId: record.licenseId,
    installationId: record.installationId,
    plan: record.plan,
    status: record.status,
    validUntil: record.validUntil,
    graceUntil: record.graceUntil,
    offlineGraceDays: record.offlineGraceDays,
    maxFacilities: record.maxFacilities,
    maxUsers: record.maxUsers,
    maxInstallations: record.maxInstallations,
    entitlementVersion: record.entitlementVersion,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(env("LICENSE_SIGNING_PRIVATE_KEY")),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

export function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "LICENSE_SERVICE_ERROR";
  const status = message === "METHOD_NOT_ALLOWED" ? 405
    : message.startsWith("CONFIGURATION_MISSING") ? 500
      : message.includes("INVALID") || message.includes("NOT_ACTIVE") || message.includes("EXPIRED") || message.includes("REVOKED") || message.includes("LIMIT") || message.includes("AUTHORIZED") ? 403
        : 500;
  if (status >= 500) console.error("SiloNR licensing function failed", message);
  return json({ error: status >= 500 ? "LICENSE_SERVICE_ERROR" : message }, status);
}
