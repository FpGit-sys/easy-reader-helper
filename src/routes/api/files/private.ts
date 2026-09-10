import { createFileRoute } from "@tanstack/react-router";
import { servePrivateFile } from "@/server/files/storage";

export const Route = createFileRoute("/api/files/private")({
  server: { handlers: { GET: ({ request }) => servePrivateFile(request) } },
});
