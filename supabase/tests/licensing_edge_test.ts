import { canonicalizeEntitlementTimestamp } from "../functions/_shared/licensing.ts";

Deno.test("canonicaliza timestamps PostgreSQL antes de assinar a concessão", () => {
  const actual = canonicalizeEntitlementTimestamp("2026-09-28T04:55:14.258828+00:00");
  const expected = "2026-09-28T04:55:14.258Z";
  if (actual !== expected) {
    throw new Error(`Esperado ${expected}, recebido ${actual}`);
  }
});

Deno.test("recusa timestamp inválido", () => {
  let rejected = false;
  try {
    canonicalizeEntitlementTimestamp("sem-data");
  } catch (error) {
    rejected = error instanceof Error && error.message === "LICENSE_ENTITLEMENT_TIME_INVALID";
  }
  if (!rejected) throw new Error("Timestamp inválido deveria ser recusado");
});
