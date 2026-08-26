import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Disclaimer, EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { TableWrap, Td, Th, Tr } from "@/components/tables/primitives";
import { ProductionNonconformitiesPage } from "@/components/production/ProductionNonconformitiesPage";
import { DISCLAIMER, fmtDate } from "@/lib/formatting";
import { DEMO_MODE_ENABLED } from "@/lib/runtime-mode";
import { createAction, updateNonconformity } from "@/lib/storage/mutations";
import { useAppState } from "@/lib/storage/store";
import type { NcStatus } from "@/types";

export const Route = createFileRoute("/app/nonconformities")({
  component: NonconformitiesRoutePage,
  head: () => ({
    meta: [
      { title: "Não conformidades — SiloNR" },
      {
        name: "description",
        content: "Pendências abertas por silo, com criticidade, responsável e prazo de tratamento.",
      },
      { property: "og:title", content: "Não conformidades — SiloNR" },
      { property: "og:description", content: "Controle interno de pendências e tratativas." },
    ],
  }),
});

function NonconformitiesRoutePage() {
  return DEMO_MODE_ENABLED ? <DemoNonconformitiesPage /> : <ProductionNonconformitiesPage />;
}

function DemoNonconformitiesPage() {
  const state = useAppState((s) => s);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("todos");
  const [silo, setSilo] = useState("todos");

  const lista = useMemo(
    () =>
      state.nonconformities.filter((n) => {
        if (status !== "todos" && n.status !== status) return false;
        if (silo !== "todos" && n.siloId !== silo) return false;
        if (busca && !`${n.codigo} ${n.titulo}`.toLowerCase().includes(busca.toLowerCase()))
          return false;
        return true;
      }),
    [state.nonconformities, status, silo, busca],
  );

  return (
    <div>
      <PageHeader
        title="Não conformidades"
        subtitle="Pendências identificadas em inspeções, documentos e verificações internas."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por código ou título"
          className="w-full sm:w-64"
          aria-label="Buscar não conformidade"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Filtrar por status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="aberta">Aberta</SelectItem>
            <SelectItem value="em_tratamento">Em tratamento</SelectItem>
            <SelectItem value="resolvida">Resolvida</SelectItem>
          </SelectContent>
        </Select>
        <Select value={silo} onValueChange={setSilo}>
          <SelectTrigger className="w-48" aria-label="Filtrar por silo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os silos</SelectItem>
            {state.silos.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {lista.length === 0 ? (
        <EmptyState
          title="Nenhuma pendência encontrada"
          description="Ajuste os filtros ou registre novas verificações para gerar pendências."
        />
      ) : (
        <TableWrap>
          <thead className="bg-muted/70">
            <tr>
              <Th>Código</Th>
              <Th>Título</Th>
              <Th>Silo</Th>
              <Th>Origem</Th>
              <Th>Criticidade</Th>
              <Th>Responsável</Th>
              <Th>Prazo</Th>
              <Th>Status</Th>
              <Th>Ações</Th>
            </tr>
          </thead>
          <tbody>
            {lista.map((n) => (
              <Tr key={n.id}>
                <Td className="font-medium">{n.codigo}</Td>
                <Td className="max-w-xs">{n.titulo}</Td>
                <Td>{state.silos.find((s) => s.id === n.siloId)?.nome ?? "—"}</Td>
                <Td>{n.origem}</Td>
                <Td>
                  <StatusBadge status={n.criticidade} />
                </Td>
                <Td>{n.responsavel}</Td>
                <Td>{fmtDate(n.prazo)}</Td>
                <Td>
                  <StatusBadge status={n.status} />
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <Select
                      value={n.status}
                      onValueChange={(v) => {
                        updateNonconformity(n.id, { status: v as NcStatus });
                        toast.success("Status da pendência atualizado.");
                      }}
                    >
                      <SelectTrigger className="h-8 w-36" aria-label="Alterar status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="aberta">Aberta</SelectItem>
                        <SelectItem value="em_tratamento">Em tratamento</SelectItem>
                        <SelectItem value="resolvida">Resolvida</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        createAction({
                          titulo: `Tratar ${n.codigo} — ${n.titulo}`,
                          ncId: n.id,
                          siloId: n.siloId,
                          responsavel: n.responsavel,
                          prazo: n.prazo,
                          prioridade: n.criticidade,
                        });
                        toast.success("Ação corretiva criada a partir da pendência.");
                      }}
                    >
                      Gerar ação
                    </Button>
                  </div>
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
