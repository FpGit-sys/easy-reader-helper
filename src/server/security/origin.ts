export function assertTrustedMutationOrigin(request: Request, appUrl: string): void {
  const expectedOrigin = new URL(appUrl).origin;
  const originHeader = request.headers.get("origin");

  if (originHeader) {
    let requestOrigin: string;
    try {
      requestOrigin = new URL(originHeader).origin;
    } catch {
      throw new Error("FORBIDDEN:INVALID_ORIGIN");
    }
    if (requestOrigin !== expectedOrigin) throw new Error("FORBIDDEN:CROSS_SITE_REQUEST");
    return;
  }

  // Modern browsers send Sec-Fetch-Site on navigational/fetch requests. If an
  // Origin-less request explicitly identifies itself as cross-site, reject it.
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") throw new Error("FORBIDDEN:CROSS_SITE_REQUEST");

  // Non-browser clients may omit both headers. Authentication/RBAC still apply.
  // Reverse proxies can require Origin for browser-only deployments if desired.
}
