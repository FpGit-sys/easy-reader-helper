import { createFileRoute } from "@tanstack/react-router";
import { DemoNewInspectionPage } from "@/components/demo/DemoNewInspectionPage";
import { ProductionNewInspectionPage } from "@/components/production/ProductionNewInspectionPage";
import { DEMO_MODE_ENABLED } from "@/lib/runtime-mode";

export const Route = createFileRoute("/app/inspections/new")({
  component: NewInspectionRoute,
  head: () => ({
    meta: [
      { title: "Nova inspeção — SiloNR" },
      {
        name: "description",
        content: "Assistente para iniciar uma inspeção versionada de silo.",
      },
      { property: "og:title", content: "Nova inspeção — SiloNR" },
      { property: "og:description", content: "Checklist versionado e rastreável para inspeções internas." },
    ],
  }),
});

function NewInspectionRoute() {
  return DEMO_MODE_ENABLED ? <DemoNewInspectionPage /> : <ProductionNewInspectionPage />;
}
