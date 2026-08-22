import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Disclaimer, EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { TableWrap, Td, Th, Tr } from "@/components/tables/primitives";
import { DISCLAIMER, fmtDate } from "@/lib/formatting";
import { useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/inspections/$inspectionId")({
  component: InspectionDetailPage,
  head: () => ({
    meta: [
      { title: "Detalhe da inspeção — SiloNR" },
      {
        name: "description",
        content: "Itens verificados, resultados, evidências e pendências geradas pela inspeção.",
      },
      { property: "og:title", content: "Detalhe da inspeção — SiloNR" },
      { property: "og:description", content: "Registro completo de uma inspeção interna." },
    ],
  }),
});

function InspectionDetailPage() {
  const { inspectionId } = Route.useParams();
  const state = useAppState((s) => s);
  const inspection = state.inspections.find((i) => i.id === inspectionId);

  if (!inspection) {
    return (
      <div>
        <PageHeader title="Inspeção não encontrada" />
        <EmptyState
          title="Registro indisponível"
          description="A inspeção solicitada não existe neste ambiente."
          action={
            <Button asChild>
              <Link to="/app/inspections">Voltar para inspeções</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const silo = state.silos.find((s) => s.id === inspection.siloId);
  const evidencias = state.evidence.filter((e) => e.inspectionId === inspection.id);
  const pendencias = state.nonconformities.filter((n) =>
    inspection.pendenciasGeradas.includes(n.id),
  );

  return (
    <div>
      <PageHeader
        title={`Inspeção ${inspection.codigo}`}
        subtitle={`${inspection.tipo} — ${silo?.nome ?? "silo não identificado"}`}
        actions={
          <Button asChild variant="outline">
            <Link to="/app/inspections">Voltar</Link>
          </Button>
        }
      />

      <dl className="mb-5 grid gap-3 rounded border border-border bg-card p-4 sm:grid-cols-4">
        <Info label="Data" value={fmtDate(inspection.data)} />
        <Info label="Responsável" value={inspection.responsavel} />
        <Info label="Itens verificados" value={String(inspection.itens.length)} />
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
          <dd className="mt-1">
            <StatusBadge status={inspection.status} />
          </dd>
        </div>
      </dl>

      <h2 className="mb-2 text-sm font-semibold">Itens verificados</h2>
      <TableWrap>
        <thead className="bg-muted/70">
          <tr>
            <Th>Código</Th>
            <Th>Critério</Th>
            <Th>Resultado</Th>
            <Th>Observação</Th>
          </tr>
        </thead>
        <tbody>
          {inspection.itens.map((item) => {
            const req = state.requirements.find((r) => r.id === item.requirementId);
            return (
              <Tr key={item.requirementId}>
                <Td className="font-medium">{req?.codigo ?? "—"}</Td>
                <Td>{req?.titulo ?? "Critério removido"}</Td>
                <Td>
                  <StatusBadge status={item.resultado} />
                </Td>
                <Td className="max-w-md">{item.observacao || "—"}</Td>
              </Tr>
            );
          })}
        </tbody>
      </TableWrap>

      {inspection.observacoes ? (
        <p className="mt-4 rounded border border-border bg-card p-3 text-sm">
          <span className="font-medium">Observações: </span>
          {inspection.observacoes}
        </p>
      ) : null}

      <h2 className="mt-6 mb-2 text-sm font-semibold">Pendências geradas</h2>
      {pendencias.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma pendência gerada por esta inspeção.</p>
      ) : (
        <ul className="space-y-1.5">
          {pendencias.map((n) => (
            <li key={n.id} className="rounded border border-border bg-card p-3 text-sm">
              <span className="font-medium">{n.codigo}</span> — {n.titulo}{" "}
              <StatusBadge status={n.status} className="ml-1" />
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-6 mb-2 text-sm font-semibold">Evidências</h2>
      {evidencias.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma evidência vinculada.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {evidencias.map((e) => (
            <li key={e.id} className="overflow-hidden rounded border border-border bg-card">
              {e.dataUrl && e.tipo === "foto" ? (
                <img
                  src={e.dataUrl}
                  alt={e.descricao || e.nome}
                  loading="lazy"
                  className="h-32 w-full object-cover"
                />
              ) : null}
              <p className="truncate p-2 text-xs">{e.nome}</p>
            </li>
          ))}
        </ul>
      )}

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}
