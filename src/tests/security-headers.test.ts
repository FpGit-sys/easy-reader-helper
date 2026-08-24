import { describe, expect, it } from "vitest";
import { withSecurityHeaders } from "@/server/security/headers";

describe("security response headers", () => {
  it("aplica proteções de navegador sem alterar status ou corpo", async () => {
    const hardened = withSecurityHeaders(new Response("ok", { status: 201 }));

    expect(hardened.status).toBe(201);
    expect(await hardened.text()).toBe("ok");
    expect(hardened.headers.get("x-content-type-options")).toBe("nosniff");
    expect(hardened.headers.get("x-frame-options")).toBe("DENY");
    expect(hardened.headers.get("referrer-policy")).toBe("no-referrer");
    expect(hardened.headers.get("permissions-policy")).toContain("microphone=()");
    expect(hardened.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(hardened.headers.get("strict-transport-security")).toBeNull();
  });

  it("habilita HSTS somente no modo de produção", () => {
    const hardened = withSecurityHeaders(new Response("ok"), { production: true });
    expect(hardened.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("preserva cabeçalhos mais específicos definidos pela rota", () => {
    const response = new Response("ok", { headers: { "referrer-policy": "same-origin" } });
    const hardened = withSecurityHeaders(response, { production: true });
    expect(hardened.headers.get("referrer-policy")).toBe("same-origin");
  });
});
