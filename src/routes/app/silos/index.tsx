import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Disclaimer, EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { siloStats } from "@/lib/calculations/derive";
import { DISCLAIMER, fmtDate } from "@/lib/formatting";
import { useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/silos/")({
  component: SilosPage,
  head: () => ({
    meta: [
      { title: "Silos — SiloNR" },
      {
        name: "description",
        content: "Lista demonstrativa de silos com índice interno, pendências e última inspeção.",
      },
      { property: "og:title", content: "Silos — SiloNR" },
      { property: "og:description", content: "Índice interno e pendências por silo." },
    ],
  }),
});

const FILTROS = ["todos", "bom", "atencao", "critico"] as const;

function SilosPage() {
  const state = useAppState((s) => s);
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]>("todos");
  const [busca, setBusca] = useState("");

  const linhas = state.silos
    .map((s) => siloStats(state, s.id))
    .filter((s) => (filtro === "todos" ? true : s.status === filtro))
    .filter((s) => s.silo.nome.toLowerCase().includes(busca.toLowerCase()));

  return (
    <div>
      <PageHeader title="Silos" subtitle="Unidade fictícia com 5 silos cadastrados." />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filtro === f ? "default" : "outline"}
            onClick={() => setFiltro(f)}
          >
            {f === "todos" ? "Todos" : f === "bom" ? "Bom" : f === "atencao" ? "Atenção" : "Crítico"}
          </Button>
        ))}
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar silo"
          aria-label="Buscar silo"
          className="h-9 w-48"
        />
      </div>

      {linhas.length === 0 ? (
        <EmptyState
          title="Nenhum silo encontrado"
          description="Ajuste os filtros ou a busca para visualizar os silos cadastrados."
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-card">
          <table className="w-full table-dense">
            <thead className="bg-muted/70 text-left">
              <tr>
                <Th>Silo</Th>
                <Th>Status</Th>
                <Th>Índice interno</Th>
                <Th>Pendências</Th>
                <Th>Críticos</Th>
                <Th>Última inspeção</Th>
                <Th>Próxima ação</Th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.silo.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <Link
                      to="/app/silos/$siloId"
                      params={{ siloId: l.silo.id }}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {l.silo.nome}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {l.silo.tipo} · {l.silo.capacidadeToneladas.toLocaleString("pt-BR")} t
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={l.status} />
                  </td>
                  <td className="px-3 py-2 font-medium">{l.index.percent}%</td>
                  <td className="px-3 py-2">{l.index.pendentes}</td>
                  <td className="px-3 py-2">{l.index.criticos}</td>
                  <td className="px-3 py-2">
                    {fmtDate(l.silo.ultimaInspecao)}
                    {l.inspecao.foraDaPeriodicidade ? (
                      <span className="block text-xs text-destructive">
                        {l.inspecao.atrasoDias} dias além da periodicidade cadastrada
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {l.proximaAcao ? l.proximaAcao.titulo : "Sem ação aberta"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide">{children}</th>;
}
