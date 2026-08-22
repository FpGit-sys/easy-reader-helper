import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Disclaimer, EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { TableWrap, Td, Th, Tr } from "@/components/tables/primitives";
import { DISCLAIMER, fmtDateTime } from "@/lib/formatting";
import { useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/history")({
  component: HistoryPage,
  head: () => ({
    meta: [
      { title: "Histórico — SiloNR" },
      {
        name: "description",
        content: "Trilha de auditoria com data, usuário, evento e objeto alterado.",
      },
      { property: "og:title", content: "Histórico — SiloNR" },
      { property: "og:description", content: "Registro cronológico das alterações internas." },
    ],
  }),
});

function HistoryPage() {
  const audit = useAppState((s) => s.audit);
  const [busca, setBusca] = useState("");
  const [objeto, setObjeto] = useState("todos");

  const objetos = useMemo(() => [...new Set(audit.map((a) => a.objeto))], [audit]);
  const lista = useMemo(
    () =>
      audit.filter((a) => {
        if (objeto !== "todos" && a.objeto !== objeto) return false;
        if (busca && !`${a.evento} ${a.resumo} ${a.objetoId}`.toLowerCase().includes(busca.toLowerCase()))
          return false;
        return true;
      }),
    [audit, objeto, busca],
  );

  return (
    <div>
      <PageHeader
        title="Histórico"
        subtitle="Trilha de auditoria das alterações feitas no ambiente demonstrativo."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar evento"
          aria-label="Buscar evento"
          className="w-full sm:w-64"
        />
        <Select value={objeto} onValueChange={setObjeto}>
          <SelectTrigger className="w-52" aria-label="Filtrar por objeto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os objetos</SelectItem>
            {objetos.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {lista.length === 0 ? (
        <EmptyState
          title="Sem registros"
          description="As alterações realizadas no sistema aparecerão aqui automaticamente."
        />
      ) : (
        <TableWrap>
          <thead className="bg-muted/70">
            <tr>
              <Th>Data</Th>
              <Th>Usuário</Th>
              <Th>Evento</Th>
              <Th>Objeto</Th>
              <Th>Identificador</Th>
              <Th>Resumo</Th>
            </tr>
          </thead>
          <tbody>
            {lista.map((a) => (
              <Tr key={a.id}>
                <Td className="whitespace-nowrap">{fmtDateTime(a.data)}</Td>
                <Td>{a.usuario}</Td>
                <Td className="font-medium">{a.evento}</Td>
                <Td>{a.objeto}</Td>
                <Td className="text-xs text-muted-foreground">{a.objetoId}</Td>
                <Td className="max-w-md">{a.resumo}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}
