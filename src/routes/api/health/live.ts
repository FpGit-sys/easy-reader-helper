import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health/live")({
  server: {
    handlers: {
      GET: async () =>
        new Response(
          JSON.stringify({
            status: "ok",
            service: "silonr",
            timestamp: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        ),
    },
  },
});
