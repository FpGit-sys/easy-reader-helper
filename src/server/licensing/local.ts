import { getPool } from "@/server/db/client";
import { getServerEnv } from "@/server/env";
import {
  decryptInstallationSecret,
  encryptInstallationSecret,
  generateInstallationSecret,
  normalizeLicenseKey,
  sha256Hex,
  verifyEntitlementToken,
  type EntitlementClaims,
} from "./crypto";

interface LeaseRow {
  organization_id: string;
  central_license_id: string;
  installation_id: string;
  installation_secret_ciphertext: string;
  entitlement_token: string;
  entitlement_expires_at: Date;
  subscription_valid_until: Date | null;
  grace_until: Date;
  central_status: string;
  last_checked_at: Date;
  last_server_time: Date;
  last_error: string | null;
}

interface LocalLicenseRow {
  id: string;
  plan: string;
  status: "trial" | "active" | "suspended" | "expired" | "cancelled";
  valid_until: Date | null;
  max_facilities: number;
  max_users: number;
  offline_grace_days: number;
}

export interface LocalLicenseState {
  id: string;
  plan: string;
  status: string;
  validUntil: string | null;
  maxFacilities: number;
  maxUsers: number;
  offlineGraceDays: number;
  managed: boolean;
  centralStatus: string | null;
  subscriptionValidUntil: string | null;
  graceUntil: string | null;
  entitlementExpiresAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  readOnly: boolean;
  readOnlyReason: string | null;
}

function licensingEnv() {
  const env = getServerEnv();
  if (!env.LICENSE_SERVICE_URL || !env.LICENSE_SERVICE_KEY || !env.LICENSE_SIGNING_PUBLIC_KEY || !env.LICENSE_INSTALLATION_ENCRYPTION_KEY) {
    throw new Error("LICENSE_SERVICE_NOT_CONFIGURED");
  }
  return {
    serviceUrl: env.LICENSE_SERVICE_URL.replace(/\/$/, ""),
    serviceKey: env.LICENSE_SERVICE_KEY,
    publicKey: env.LICENSE_SIGNING_PUBLIC_KEY,
    encryptionKey: env.LICENSE_INSTALLATION_ENCRYPTION_KEY,
    refreshHours: env.LICENSE_REFRESH_INTERVAL_HOURS,
  };
}

async function callService(path: string, body: Record<string, unknown>): Promise<string> {
  const env = licensingEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${env.serviceUrl}/${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.serviceKey}`,
        apikey: env.serviceKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as { entitlement?: string; error?: string } | null;
    if (!response.ok || !payload?.entitlement) {
      throw new Error(payload?.error ?? `LICENSE_SERVICE_HTTP_${response.status}`);
    }
    return payload.entitlement;
  } finally {
    clearTimeout(timeout);
  }
}

async function readRows(organizationId: string): Promise<{ license: LocalLicenseRow | null; lease: LeaseRow | null }> {
  let result;
  try {
    result = await getPool().query<LocalLicenseRow & Partial<LeaseRow>>(
      `select l.id, l.plan, l.status, l.valid_until, l.max_facilities, l.max_users,
            l.offline_grace_days, ll.organization_id, ll.central_license_id,
            ll.installation_id, ll.installation_secret_ciphertext, ll.entitlement_token,
            ll.entitlement_expires_at, ll.subscription_valid_until, ll.grace_until,
            ll.central_status, ll.last_checked_at, ll.last_server_time, ll.last_error
       from licenses l
       left join silonr_license_leases ll on ll.organization_id = l.organization_id
      where l.organization_id = $1
      order by l.created_at desc
      limit 1`,
      [organizationId],
    );
  } catch (error) {
    if (!error || typeof error !== "object" || (error as { code?: unknown }).code !== "42P01") throw error;
    result = await getPool().query<LocalLicenseRow & Partial<LeaseRow>>(
      `select id, plan, status, valid_until, max_facilities, max_users, offline_grace_days
         from licenses where organization_id = $1 order by created_at desc limit 1`,
      [organizationId],
    );
  }
  const row = result.rows[0];
  if (!row) return { license: null, lease: null };
  const license: LocalLicenseRow = {
    id: row.id,
    plan: row.plan,
    status: row.status,
    valid_until: row.valid_until,
    max_facilities: row.max_facilities,
    max_users: row.max_users,
    offline_grace_days: row.offline_grace_days,
  };
  const lease = row.central_license_id ? row as LocalLicenseRow & LeaseRow : null;
  return { license, lease };
}

function projectStatus(status: string): LocalLicenseRow["status"] {
  if (status === "active" || status === "past_due" || status === "trial") return status === "trial" ? "trial" : "active";
  if (status === "suspended" || status === "expired" || status === "cancelled") return status;
  return "suspended";
}

async function persistEntitlement(input: {
  organizationId: string;
  token: string;
  installationSecret: string;
  expectedInstallationId: string;
  keyHash?: string;
}) {
  const env = licensingEnv();
  const claims = verifyEntitlementToken(input.token, env.publicKey, input.expectedInstallationId);
  const encryptedSecret = encryptInstallationSecret(input.installationSecret, env.encryptionKey);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const updated = await client.query(
      `update licenses set plan = $2, status = $3, valid_until = $4,
         max_facilities = $5, max_users = $6, offline_grace_days = $7,
         license_key_hash = coalesce($8, license_key_hash), updated_at = now()
       where organization_id = $1`,
      [
        input.organizationId,
        claims.plan,
        projectStatus(claims.status),
        claims.validUntil ? new Date(claims.validUntil) : null,
        claims.maxFacilities,
        claims.maxUsers,
        claims.offlineGraceDays,
        input.keyHash ?? null,
      ],
    );
    if (updated.rowCount !== 1) throw new Error("LOCAL_LICENSE_NOT_FOUND");
    await client.query(
      `insert into silonr_license_leases (
         organization_id, central_license_id, installation_id,
         installation_secret_ciphertext, entitlement_token, entitlement_expires_at,
         subscription_valid_until, grace_until, central_status, entitlement_version,
         last_checked_at, last_server_time, last_error, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,null,now())
       on conflict (organization_id) do update set
         central_license_id = excluded.central_license_id,
         installation_id = excluded.installation_id,
         installation_secret_ciphertext = excluded.installation_secret_ciphertext,
         entitlement_token = excluded.entitlement_token,
         entitlement_expires_at = excluded.entitlement_expires_at,
         subscription_valid_until = excluded.subscription_valid_until,
         grace_until = excluded.grace_until,
         central_status = excluded.central_status,
         entitlement_version = excluded.entitlement_version,
         last_checked_at = excluded.last_checked_at,
         last_server_time = excluded.last_server_time,
         last_error = null,
         updated_at = now()`,
      [
        input.organizationId,
        claims.licenseId,
        claims.installationId,
        encryptedSecret,
        input.token,
        new Date(claims.expiresAt),
        claims.validUntil ? new Date(claims.validUntil) : null,
        new Date(claims.graceUntil),
        claims.status,
        claims.entitlementVersion,
        new Date(claims.issuedAt),
      ],
    );
    await client.query("commit");
    return claims;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function activateLocalLicense(input: { organizationId: string; licenseKey: string; label: string }) {
  const normalizedKey = normalizeLicenseKey(input.licenseKey);
  const current = await readRows(input.organizationId);
  const installationId = current.lease?.installation_id ?? crypto.randomUUID();
  const installationSecret = generateInstallationSecret();
  const token = await callService("license-activate", {
    licenseKey: normalizedKey,
    installationId,
    installationSecret,
    label: input.label,
  });
  return persistEntitlement({
    organizationId: input.organizationId,
    token,
    installationSecret,
    expectedInstallationId: installationId,
    keyHash: sha256Hex(normalizedKey),
  });
}

export async function refreshLocalLicense(organizationId: string): Promise<EntitlementClaims> {
  const { lease } = await readRows(organizationId);
  if (!lease) throw new Error("LICENSE_NOT_ACTIVATED");
  const env = licensingEnv();
  const installationSecret = decryptInstallationSecret(lease.installation_secret_ciphertext, env.encryptionKey);
  try {
    const token = await callService("license-refresh", {
      licenseId: lease.central_license_id,
      installationId: lease.installation_id,
      installationSecret,
    });
    return await persistEntitlement({
      organizationId,
      token,
      installationSecret,
      expectedInstallationId: lease.installation_id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LICENSE_REFRESH_FAILED";
    await getPool().query(
      "update silonr_license_leases set last_error = $2, updated_at = now() where organization_id = $1",
      [organizationId, message.slice(0, 500)],
    ).catch(() => undefined);
    throw error;
  }
}

function stateFromRows(license: LocalLicenseRow, lease: LeaseRow | null, now: Date): LocalLicenseState {
  if (!lease) {
    const usable = (license.status === "trial" || license.status === "active") && (!license.valid_until || license.valid_until.getTime() >= now.getTime());
    return {
      id: license.id,
      plan: license.plan,
      status: license.status,
      validUntil: license.valid_until?.toISOString() ?? null,
      maxFacilities: license.max_facilities,
      maxUsers: license.max_users,
      offlineGraceDays: license.offline_grace_days,
      managed: false,
      centralStatus: null,
      subscriptionValidUntil: null,
      graceUntil: null,
      entitlementExpiresAt: null,
      lastCheckedAt: null,
      lastError: null,
      readOnly: !usable,
      readOnlyReason: usable ? null : license.status === "trial" || license.status === "active" ? "LICENSE_EXPIRED" : "LICENSE_NOT_ACTIVE",
    };
  }
  const clockRolledBack = now.getTime() + 5 * 60_000 < lease.last_server_time.getTime();
  const usableStatus = lease.central_status === "trial" || lease.central_status === "active" || lease.central_status === "past_due";
  const entitlementValid = lease.entitlement_expires_at.getTime() >= now.getTime() && lease.grace_until.getTime() >= now.getTime();
  const readOnlyReason = clockRolledBack ? "LICENSE_CLOCK_ROLLBACK"
    : !usableStatus ? "LICENSE_NOT_ACTIVE"
      : !entitlementValid ? "LICENSE_EXPIRED"
        : null;
  return {
    id: license.id,
    plan: license.plan,
    status: lease.central_status,
    validUntil: license.valid_until?.toISOString() ?? null,
    maxFacilities: license.max_facilities,
    maxUsers: license.max_users,
    offlineGraceDays: license.offline_grace_days,
    managed: true,
    centralStatus: lease.central_status,
    subscriptionValidUntil: lease.subscription_valid_until?.toISOString() ?? null,
    graceUntil: lease.grace_until.toISOString(),
    entitlementExpiresAt: lease.entitlement_expires_at.toISOString(),
    lastCheckedAt: lease.last_checked_at.toISOString(),
    lastError: lease.last_error,
    readOnly: readOnlyReason !== null,
    readOnlyReason,
  };
}

export async function getLocalLicenseState(organizationId: string, now = new Date()): Promise<LocalLicenseState | null> {
  const { license, lease } = await readRows(organizationId);
  return license ? stateFromRows(license, lease, now) : null;
}

export async function assertLicenseAllowsMutation(organizationId: string): Promise<void> {
  let rows = await readRows(organizationId);
  if (!rows.license) throw new Error("LICENSE_NOT_CONFIGURED");
  if (rows.lease) {
    const env = licensingEnv();
    const staleAt = rows.lease.last_checked_at.getTime() + env.refreshHours * 3_600_000;
    if (Date.now() >= staleAt) {
      await refreshLocalLicense(organizationId).catch(() => undefined);
      rows = await readRows(organizationId);
    }
  }
  const state = stateFromRows(rows.license, rows.lease, new Date());
  if (state.readOnly) throw new Error(state.readOnlyReason ?? "LICENSE_READ_ONLY");
}
