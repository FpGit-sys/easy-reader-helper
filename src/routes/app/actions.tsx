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
import { ProductionActionsPage } from "@/components/production/ProductionActionsPage";
import { actionsWithStatus } from "@/lib/calculations/derive";
import { DISCLAIMER, fmtDate } from "@/lib/formatting";
import { DEMO_MODE_ENABLED } from "@/lib/runtime-mode";
import { completeAction, createAction, reopenAction, updateAction } from "@/lib/storage/mutations";
import { useAppState } from "@/lib/storage/store";
import type { ActionStatus, Criticidade } from "@/types";

export const Route = createFileRoute("/app/actions")({
  component: ActionsRoutePage,
  head: () => ({
    meta: [
      { title: "Ações corretivas — SiloNR" },
      {
        name: "description",
        content: "Plano de ações corretivas com responsável, prazo, prioridade e conclusão.",
      },
      { property: "og:title", content: "Ações corretivas — SiloNR" },
      { property: "og:description", content: "Acompanhe o tratamento das pendências internas." },
    ],
  }),
});

function ActionsRoutePage() {
  return DEMO_MODE_ENABLED ? <DemoActionsPage /> : <ProductionActionsPage />;
}

function DemoActionsPage() {
  const state = useAppState((s) => s);
  const [filtro, setFiltro] = useState("todas");
  const [novo, setNovo] = useState({ titulo: "", responsavel: "", prazo: "", prioridade: "media" });

  const acoes = useMemo(() => {
    const all = actionsWithStatus(state);
    if (filtro === "atrasadas") return all.filter((a) => a.atrasada);
    if (filtro === "abertas") return all.filter((a) => a.status !== "concluida");
    if (filtro === "concluidas") return all.filter((a) => a.status === "concluida");
    return all;
  }, [state, filtro]);

  return (
    <div>
      <PageHeader
        title="Ações corretivas"
        subtitle="Plano de tratativas internas com responsáveis e prazos definidos."
      />

      <form
        className="mb-5 grid gap-2 rounded border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!novo.titulo.trim() || !novo.responsavel.trim()) {
            toast.error("Informe título e responsável.");
            return;
          }
          createAction({
            titulo: novo.titulo.trim(),
            responsavel: novo.responsavel.trim(),
            prazo: novo.prazo || null,
            prioridade: novo.prioridade as Criticidade,
          });
          setNovo({ titulo: "", responsavel: "", prazo: "", prioridade: "media" });
          toast.success("Ação corretiva registrada.");
        }}
      >
        <Input
          className="lg:col-span-2"
          placeholder="Título da ação"
          aria-label="Título da ação"
          value={novo.titulo}
          onChange={(e) => setNovo((v) => ({ ...v, titulo: e.target.value }))}
        />
        <Select
          value={novo.responsavel}
          onValueChange={(v) => setNovo((n) => ({ ...n, responsavel: v }))}
        >
          <SelectTrigger aria-label="Responsável">
            <SelectValue placeholder="Responsável" />
          </SelectTrigger>
          <SelectContent>
            {state.settings.responsaveis.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          aria-label="Prazo"
          value={novo.prazo}
          onChange={(e) => setNovo((v) => ({ ...v, prazo: e.target.value }))}
        />
        <div className="flex gap-2">
          <Select
            value={novo.prioridade}
            onValueChange={(v) => setNovo((n) => ({ ...n, prioridade: v }))}
          >
            <SelectTrigger aria-label="Prioridade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="media">Média</SelectItem>
              <SelectItem value="baixa">Baixa</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit">Adicionar</Button>
        </div>
      </form>

      <div className="mb-4 w-56">
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger aria-label="Filtrar ações">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="abertas">Em aberto</SelectItem>
            <SelectItem value="atrasadas">Atrasadas</SelectItem>
            <SelectItem value="concluidas">Concluídas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {acoes.length === 0 ? (
        <EmptyState
          title="Nenhuma ação corretiva"
          description="Crie ações manualmente ou gere a partir de uma não conformidade."
        />
      ) : (
        <TableWrap>
          <thead className="bg-muted/70">
            <tr>
              <Th>Código</Th>
              <Th>Ação</Th>
              <Th>Silo</Th>
              <Th>Responsável</Th>
              <Th>Prazo</Th>
              <Th>Prioridade</Th>
              <Th>Status</Th>
              <Th>Concluir</Th>
            </tr>
          </thead>
          <tbody>
            {acoes.map((a) => (
              <Tr key={a.id}>
                <Td className="font-medium">{a.codigo}</Td>
                <Td className="max-w-xs">{a.titulo}</Td>
                <Td>{state.silos.find((s) => s.id === a.siloId)?.nome ?? "—"}</Td>
                <Td>{a.responsavel}</Td>
                <Td>
                  {fmtDate(a.prazo)}
                  {a.atrasada ? (
                    <span className="ml-1 text-xs text-destructive">({a.diasAtraso}d)</span>
                  ) : null}
                </Td>
                <Td>
                  <StatusBadge status={a.prioridade} />
                </Td>
                <Td>
                  <Select
                    value={a.status}
                    onValueChange={(v) => updateAction(a.id, { status: v as ActionStatus })}
                  >
                    <SelectTrigger className="h-8 w-44" aria-label="Alterar status da ação">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nao_iniciada">Não iniciada</SelectItem>
                      <SelectItem value="em_andamento">Em andamento</SelectItem>
                      <SelectItem value="aguardando_evidencia">Aguardando evidência</SelectItem>
                      <SelectItem value="concluida">Concluída</SelectItem>
                    </SelectContent>
                  </Select>
                </Td>
                <Td>
                  {a.status === "concluida" ? (
                    <Button size="sm" variant="outline" onClick={() => reopenAction(a.id)}>
                      Reabrir
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        completeAction(a.id, null);
                        toast.success("Ação concluída.");
                      }}
                    >
                      Concluir
                    </Button>
                  )}
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
