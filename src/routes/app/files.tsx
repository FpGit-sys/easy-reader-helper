import { createFileRoute } from "@tanstack/react-router";
import { ProductionDocumentsPage } from "@/components/production/ProductionDocumentsPage";

export const Route = createFileRoute("/app/files")({
  component: ProductionDocumentsPage,
  head: () => ({
    meta: [
      { title: "Documentos — SiloNR" },
      {
        name: "description",
        content: "Documentos privados, versionados e rastreáveis da unidade selecionada.",
      },
    ],
  }),
});
