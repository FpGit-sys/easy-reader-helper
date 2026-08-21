import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Disclaimer, EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { TableWrap, Td, Th, Tr } from "@/components/tables/primitives";
import { DISCLAIMER, fmtDate } from "@/lib/formatting";
import { useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/inspections/")({
  component: InspectionsPage,
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

function InspectionsPage() {
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
            {state.inspections.map((i) => (
              <Tr key={i.id}>
                <Td className="font-medium">{i.codigo}</Td>
                <Td>{fmtDate(i.data)}</Td>
                <Td>{state.silos.find((s) => s.id === i.siloId)?.nome ?? "—"}</Td>
                <Td>{i.tipo}</Td>
                <Td>{i.responsavel}</Td>
                <Td>{i.itens.length}</Td>
                <Td>{i.pendenciasGeradas.length}</Td>
                <Td>
                  <StatusBadge status={i.status} />
                </Td>
                <Td>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/app/inspections/$inspectionId" params={{ inspectionId: i.id }}>
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
