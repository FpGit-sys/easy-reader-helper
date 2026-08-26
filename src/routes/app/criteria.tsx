import { createFileRoute } from "@tanstack/react-router";
import { ProductionRequirementsPage } from "@/components/production/ProductionRequirementsPage";

export const Route = createFileRoute("/app/criteria")({
  component: ProductionRequirementsPage,
  head: () => ({
    meta: [
      { title: "Matriz de requisitos — SiloNR" },
      {
        name: "description",
        content: "Critérios internos e fontes externas versionados e rastreáveis no SiloNR.",
      },
    ],
  }),
});
