import { Link, createFileRoute } from "@tanstack/react-router";
import { ProductionInspectionsPage } from "@/components/production/ProductionInspectionsPage";
import { Button } from "@/components/ui/button";
import { Disclaimer, EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { TableWrap, Td, Th, Tr } from "@/components/tables/primitives";
import { DISCLAIMER, fmtDate } from "@/lib/formatting";
import { DEMO_MODE_ENABLED } from "@/lib/runtime-mode";
import { useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/inspections/")({
  component: InspectionsRoute,
  head: () => ({
    meta: [
      { title: "Inspeções — SiloNR" },
      {
        name: "description",
        content: "Histórico de inspeções internas por silo, com itens verificados e pendências.",
      },
      { property: "og:title", content: "Inspeções — SiloNR" },
      { property: "og:description", content: "Checklists internos aplicados em campo." },
    ],
  }),
});

function InspectionsRoute() {
  return DEMO_MODE_ENABLED ? <DemoInspectionsPage /> : <ProductionInspectionsPage />;
}

function DemoInspectionsPage() {
  const state = useAppState((s) => s);

  return (
    <div>
      <PageHeader
        title="Inspeções"
        subtitle="Registros de verificação interna aplicados aos silos."
        actions={
          <Button asChild>
            <Link to="/app/inspections/new">Nova inspeção</Link>
          </Button>
        }
      />

      {state.inspections.length === 0 ? (
        <EmptyState
          title="Nenhuma inspeção registrada"
          description="Inicie uma inspeção para registrar o estado atual dos critérios de um silo."
          action={
            <Button asChild>
              <Link to="/app/inspections/new">Nova inspeção</Link>
            </Button>
          }
        />
      ) : (
        <TableWrap>
          <thead className="bg-muted/70">
            <tr>
              <Th>Código</Th>
              <Th>Data</Th>
              <Th>Silo</Th>
              <Th>Tipo</Th>
              <Th>Responsável</Th>
              <Th>Itens</Th>
              <Th>Pendências</Th>
              <Th>Status</Th>
              <Th>Ações</Th>
            </tr>
          </thead>
          <tbody>
            {state.inspections.map((inspection) => (
              <Tr key={inspection.id}>
                <Td className="font-medium">{inspection.codigo}</Td>
                <Td>{fmtDate(inspection.data)}</Td>
                <Td>{state.silos.find((silo) => silo.id === inspection.siloId)?.nome ?? "—"}</Td>
                <Td>{inspection.tipo}</Td>
                <Td>{inspection.responsavel}</Td>
                <Td>{inspection.itens.length}</Td>
                <Td>{inspection.pendenciasGeradas.length}</Td>
                <Td>
                  <StatusBadge status={inspection.status} />
                </Td>
                <Td>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/app/inspections/$inspectionId" params={{ inspectionId: inspection.id }}>
                      Ver
                    </Link>
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}
