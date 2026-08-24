import { createFileRoute } from "@tanstack/react-router";
import { DemoInspectionDetailPage } from "@/components/demo/DemoInspectionDetailPage";
import { ProductionInspectionDetailPage } from "@/components/production/ProductionInspectionDetailPage";
import { DEMO_MODE_ENABLED } from "@/lib/runtime-mode";

export const Route = createFileRoute("/app/inspections/$inspectionId")({
  component: InspectionDetailRoute,
  head: () => ({
    meta: [
      { title: "Detalhe da inspeção — SiloNR" },
      {
        name: "description",
        content: "Checklist versionado, resultados e não conformidades geradas por uma inspeção.",
      },
      { property: "og:title", content: "Detalhe da inspeção — SiloNR" },
      { property: "og:description", content: "Registro rastreável de uma inspeção interna." },
    ],
  }),
});

function InspectionDetailRoute() {
  const { inspectionId } = Route.useParams();
  return DEMO_MODE_ENABLED ? (
    <DemoInspectionDetailPage inspectionId={inspectionId} />
  ) : (
    <ProductionInspectionDetailPage inspectionId={inspectionId} />
  );
}
