import { describe, expect, it } from "vitest";
import { assertTrustedMutationOrigin } from "@/server/security/origin";

const APP_URL = "https://silonr.example.com";

describe("mutation origin guard", () => {
  it("aceita origem da própria aplicação", () => {
    const request = new Request("https://silonr.example.com/api/documents/upload", {
      method: "POST",
      headers: { origin: "https://silonr.example.com" },
    });
    expect(() => assertTrustedMutationOrigin(request, APP_URL)).not.toThrow();
  });

  it("bloqueia origem cross-site", () => {
    const request = new Request("https://silonr.example.com/api/documents/upload", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(() => assertTrustedMutationOrigin(request, APP_URL)).toThrow(
      "FORBIDDEN:CROSS_SITE_REQUEST",
    );
  });

  it("bloqueia Sec-Fetch-Site cross-site quando Origin não existe", () => {
    const request = new Request("https://silonr.example.com/api/documents/upload", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(() => assertTrustedMutationOrigin(request, APP_URL)).toThrow(
      "FORBIDDEN:CROSS_SITE_REQUEST",
    );
  });

  it("mantém suporte a clientes não-browser autenticados sem Origin", () => {
    const request = new Request("https://silonr.example.com/api/documents/upload", {
      method: "POST",
    });
    expect(() => assertTrustedMutationOrigin(request, APP_URL)).not.toThrow();
  });
});
