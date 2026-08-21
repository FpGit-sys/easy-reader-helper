import { Link, createFileRoute } from "@tanstack/react-router";
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
import { StatusBadge } from "@/components/layout/StatusBadge";
import { TableWrap, Td, Th, Tr } from "@/components/tables/primitives";
import { CATEGORIAS } from "@/data/demo/demoData";
import { DISCLAIMER, fmtDate } from "@/lib/formatting";
import { useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/requirements/")({
  component: RequirementsPage,
  head: () => ({
    meta: [
      { title: "Matriz de requisitos — SiloNR" },
      {
        name: "description",
        content:
          "Matriz demonstrativa com 52 critérios internos: status, criticidade, responsável e evidência.",
      },
      { property: "og:title", content: "Matriz de requisitos — SiloNR" },
      { property: "og:description", content: "52 critérios internos fictícios com filtros e busca." },
    ],
  }),
});

const TODOS = "__todos__";

function RequirementsPage() {
  const state = useAppState((s) => s);
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState(TODOS);
  const [status, setStatus] = useState(TODOS);
  const [criticidade, setCriticidade] = useState(TODOS);
  const [responsavel, setResponsavel] = useState(TODOS);
  const [aplicabilidade, setAplicabilidade] = useState(TODOS);

  const linhas = useMemo(
    () =>
      state.requirements.filter((r) => {
        if (categoria !== TODOS && r.categoria !== categoria) return false;
        if (status !== TODOS && r.status !== status) return false;
        if (criticidade !== TODOS && r.criticidade !== criticidade) return false;
        if (responsavel !== TODOS && r.responsavel !== responsavel) return false;
        if (aplicabilidade !== TODOS && String(r.aplicavel) !== aplicabilidade) return false;
        const q = busca.toLowerCase();
        return (
          !q ||
          r.titulo.toLowerCase().includes(q) ||
          r.codigo.toLowerCase().includes(q) ||
          r.descricao.toLowerCase().includes(q)
        );
      }),
    [state.requirements, busca, categoria, status, criticidade, responsavel, aplicabilidade],
  );

  return (
    <div>
      <PageHeader
        title="Matriz de requisitos"
        subtitle={`${state.requirements.length} critérios internos demonstrativos cadastrados.`}
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por código, título ou descrição"
          aria-label="Buscar requisito"
          className="lg:col-span-2"
        />
        <Filtro label="Categoria" value={categoria} onChange={setCategoria} options={CATEGORIAS} />
        <Filtro
          label="Status"
          value={status}
          onChange={setStatus}
          options={["atendido", "pendente", "critico", "nao_aplicavel"]}
          labels={{ atendido: "Atendido", pendente: "Pendente", critico: "Crítico", nao_aplicavel: "Não aplicável" }}
        />
        <Filtro
          label="Criticidade"
          value={criticidade}
          onChange={setCriticidade}
          options={["alta", "media", "baixa"]}
          labels={{ alta: "Alta", media: "Média", baixa: "Baixa" }}
        />
        <Filtro
          label="Responsável"
          value={responsavel}
          onChange={setResponsavel}
          options={state.settings.responsaveis}
        />
        <Filtro
          label="Aplicabilidade"
          value={aplicabilidade}
          onChange={setAplicabilidade}
          options={["true", "false"]}
          labels={{ true: "Aplicável", false: "Não aplicável" }}
        />
      </div>

      {linhas.length === 0 ? (
        <EmptyState
          title="Nenhum requisito encontrado"
          description="Ajuste os filtros ou limpe a busca para ver os critérios cadastrados."
        />
      ) : (
        <TableWrap>
          <thead className="bg-muted/70">
            <tr>
              <Th>Código</Th>
              <Th>Título</Th>
              <Th>Categoria</Th>
              <Th>Aplicabilidade</Th>
              <Th>Criticidade</Th>
              <Th>Status</Th>
              <Th>Responsável</Th>
              <Th>Prazo</Th>
              <Th>Evidência</Th>
              <Th>Fonte</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Link
                    to="/app/requirements/$reqId"
                    params={{ reqId: r.id }}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {r.codigo}
                  </Link>
                </Td>
                <Td className="max-w-[280px]">{r.titulo}</Td>
                <Td>{r.categoria}</Td>
                <Td>{r.aplicavel ? "Aplicável" : "Não aplicável"}</Td>
                <Td>
                  <StatusBadge status={r.criticidade} />
                </Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td>{r.responsavel}</Td>
                <Td>{fmtDate(r.prazo)}</Td>
                <Td>
                  {r.evidenciaObrigatoria
                    ? r.evidencias.length > 0
                      ? `${r.evidencias.length} anexada(s)`
                      : "Obrigatória — ausente"
                    : "Opcional"}
                </Td>
                <Td className="text-xs text-muted-foreground">{r.fonteReferencia}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}

function Filtro({
  label,
  value,
  onChange,
  options,
  labels,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  labels?: Record<string, string>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__todos__">{label}: todos</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {labels?.[o] ?? o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
