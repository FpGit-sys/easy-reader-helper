import {
  authorizeLicenseClient,
  errorResponse,
  json,
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
    const licenseId = typeof body.licenseId === "string" ? body.licenseId : "";
    const installationId = typeof body.installationId === "string" ? body.installationId : "";
    const installationSecret = typeof body.installationSecret === "string" ? body.installationSecret : "";
    if (!/^[0-9a-f-]{36}$/i.test(licenseId) || !/^[0-9a-f-]{36}$/i.test(installationId) || installationSecret.length < 43) {
      return json({ error: "INSTALLATION_INVALID" }, 400);
    }

    const entitlement = await rpc<CentralEntitlementRecord>("refresh_software_license", {
      p_license_id: licenseId,
      p_installation_id: installationId,
      p_secret_hash: await sha256Hex(installationSecret),
    });
    return json({ entitlement: await signEntitlement(entitlement) });
  } catch (error) {
    return errorResponse(error);
  }
});
