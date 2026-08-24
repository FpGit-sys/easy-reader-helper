import { createFileRoute } from "@tanstack/react-router";
import { DemoSilosPage } from "@/components/demo/DemoSilosPage";
import { ProductionSilosPage } from "@/components/production/ProductionSilosPage";
import { DEMO_MODE_ENABLED } from "@/lib/runtime-mode";

export const Route = createFileRoute("/app/silos/")({
  component: SilosPage,
  head: () => ({
    meta: [
      { title: "Silos — SiloNR" },
      {
        name: "description",
        content: "Cadastro e acompanhamento operacional dos silos da unidade selecionada.",
      },
      { property: "og:title", content: "Silos — SiloNR" },
      { property: "og:description", content: "Prontidão interna e pendências por silo." },
    ],
  }),
});

function SilosPage() {
  return DEMO_MODE_ENABLED ? <DemoSilosPage /> : <ProductionSilosPage />;
}
