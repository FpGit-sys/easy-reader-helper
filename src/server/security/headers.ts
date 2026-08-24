const BASE_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "no-referrer"],
  ["permissions-policy", "camera=(self), microphone=(), geolocation=()"],
  ["cross-origin-opener-policy", "same-origin"],
];

/**
 * Applies transport/browser hardening without mutating the original response.
 * CSP is intentionally not enforced yet because TanStack Start hydration may
 * require nonce-aware inline scripts; adding a partial CSP would risk breaking
 * production while creating a false sense of safety.
 */
export function withSecurityHeaders(response: Response, options?: { production?: boolean }): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of BASE_SECURITY_HEADERS) {
    if (!headers.has(name)) headers.set(name, value);
  }

  if (options?.production && !headers.has("strict-transport-security")) {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
