import {
  authorizeLicenseClient,
  errorResponse,
  json,
  normalizeLicenseKey,
  rpc,
  sha256Hex,
  signEntitlement,
  type CentralEntitlementRecord,
} from "../_shared/licensing.ts";

declare const Deno: { serve(handler: (request: Request) => Response | Promise<Response>): void };

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST") throw new Error("METHOD_NOT_ALLOWED");
    await authorizeLicenseClient(request);
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return json({ error: "CONTENT_TYPE_REQUIRED" }, 415);
    }
    const body = await request.json() as Record<string, unknown>;
    const licenseKey = typeof body.licenseKey === "string" ? normalizeLicenseKey(body.licenseKey) : "";
    const installationId = typeof body.installationId === "string" ? body.installationId : "";
    const installationSecret = typeof body.installationSecret === "string" ? body.installationSecret : "";
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "SiloNR local";
    if (!/^SLNR[A-Z0-9]{25}$/.test(licenseKey)) return json({ error: "LICENSE_KEY_INVALID" }, 400);
    if (!/^[0-9a-f-]{36}$/i.test(installationId) || installationSecret.length < 43) {
      return json({ error: "INSTALLATION_INVALID" }, 400);
    }

    const entitlement = await rpc<CentralEntitlementRecord>("activate_software_license", {
      p_key_hash: await sha256Hex(licenseKey),
      p_installation_id: installationId,
      p_secret_hash: await sha256Hex(installationSecret),
      p_label: label,
    });
    return json({ entitlement: await signEntitlement(entitlement) });
  } catch (error) {
    return errorResponse(error);
  }
});
