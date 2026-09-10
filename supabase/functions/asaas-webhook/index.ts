import {
  constantTimeEqual,
  env,
  errorResponse,
  json,
  rpc,
  sha256Hex,
} from "../_shared/licensing.ts";

declare const Deno: { serve(handler: (request: Request) => Response | Promise<Response>): void };

interface AsaasWebhook {
  id?: string;
  event?: string;
  payment?: { id?: string };
}

interface AsaasPayment {
  id?: string;
  subscription?: string | null;
  externalReference?: string | null;
  status?: string;
}

function paymentStatusMatchesEvent(event: string, status: string | undefined): boolean {
  const expected: Record<string, string[]> = {
    PAYMENT_RECEIVED: ["RECEIVED", "RECEIVED_IN_CASH"],
    PAYMENT_CONFIRMED: ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"],
    PAYMENT_OVERDUE: ["OVERDUE"],
    PAYMENT_REFUNDED: ["REFUNDED", "REFUND_IN_PROGRESS"],
    PAYMENT_CHARGEBACK_REQUESTED: ["CHARGEBACK_REQUESTED"],
    PAYMENT_CHARGEBACK_DISPUTE: ["CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"],
  };
  return !expected[event] || expected[event].includes(status ?? "");
}

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST") throw new Error("METHOD_NOT_ALLOWED");
    const suppliedToken = request.headers.get("asaas-access-token") ?? "";
    if (!await constantTimeEqual(suppliedToken, env("ASAAS_WEBHOOK_TOKEN"))) {
      return json({ error: "UNAUTHORIZED" }, 401);
    }

    const rawBody = await request.text();
    const event = JSON.parse(rawBody) as AsaasWebhook;
    if (!event.id || !event.event || !event.payment?.id) {
      return json({ error: "INVALID_WEBHOOK" }, 400);
    }

    const paymentResponse = await fetch(`${env("ASAAS_API_URL").replace(/\/$/, "")}/payments/${encodeURIComponent(event.payment.id)}`, {
      headers: {
        access_token: env("ASAAS_API_KEY"),
        accept: "application/json",
        "user-agent": "SiloNR-Licensing/0.1",
      },
    });
    const payment = await paymentResponse.json().catch(() => null) as AsaasPayment | null;
    if (!paymentResponse.ok || payment?.id !== event.payment.id) {
      throw new Error("ASAAS_PAYMENT_VERIFICATION_FAILED");
    }
    if (!paymentStatusMatchesEvent(event.event, payment.status)) {
      throw new Error("ASAAS_PAYMENT_STATUS_MISMATCH");
    }

    const result = await rpc<Record<string, unknown>>("process_asaas_payment_event", {
      p_event_id: event.id,
      p_event_type: event.event,
      p_payment_id: payment.id,
      p_subscription_id: payment.subscription ?? null,
      p_external_reference: payment.externalReference ?? null,
      p_payload_sha256: await sha256Hex(rawBody),
    });
    return json({ received: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
});
