import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Disclaimer, EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { Input } from "@/components/ui/input";
import { siloStats } from "@/lib/calculations/derive";
import { DISCLAIMER, fmtDate } from "@/lib/formatting";
import { useAppState } from "@/lib/storage/store";

const FILTERS = ["todos", "bom", "atencao", "critico"] as const;

export function DemoSilosPage() {
  const state = useAppState((s) => s);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("todos");
  const [search, setSearch] = useState("");

  const rows = state.silos
    .map((s) => siloStats(state, s.id))
    .filter((s) => (filter === "todos" ? true : s.status === filter))
    .filter((s) => s.silo.nome.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <PageHeader title="Silos" subtitle="Unidade fictícia com 5 silos cadastrados." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <Button
            key={item}
            size="sm"
            variant={filter === item ? "default" : "outline"}
            onClick={() => setFilter(item)}
          >
            {item === "todos" ? "Todos" : item === "bom" ? "Bom" : item === "atencao" ? "Atenção" : "Crítico"}
          </Button>
        ))}
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar silo"
          aria-label="Buscar silo"
          className="h-9 w-48"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nenhum silo encontrado" description="Ajuste os filtros ou a busca para visualizar os silos cadastrados." />
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
              {rows.map((row) => (
                <tr key={row.silo.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <Link
                      to="/app/silos/$siloId"
                      params={{ siloId: row.silo.id }}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {row.silo.nome}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {row.silo.tipo} · {row.silo.capacidadeToneladas.toLocaleString("pt-BR")} t
                    </span>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                  <td className="px-3 py-2 font-medium">{row.index.percent}%</td>
                  <td className="px-3 py-2">{row.index.pendentes}</td>
                  <td className="px-3 py-2">{row.index.criticos}</td>
                  <td className="px-3 py-2">
                    {fmtDate(row.silo.ultimaInspecao)}
                    {row.inspecao.foraDaPeriodicidade ? (
                      <span className="block text-xs text-destructive">
                        {row.inspecao.atrasoDias} dias além da periodicidade cadastrada
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.proximaAcao ? row.proximaAcao.titulo : "Sem ação aberta"}
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
