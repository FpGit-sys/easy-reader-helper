import { Link, createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Disclaimer, EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { Td, TableWrap, Th, Tr } from "@/components/tables/primitives";
import { documentsWithStatus, siloStats } from "@/lib/calculations/derive";
import { DISCLAIMER, fmtDate } from "@/lib/formatting";
import { useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/silos/$siloId")({
  component: SiloDetailPage,
  head: () => ({
    meta: [
      { title: "Detalhe do silo — SiloNR" },
      {
        name: "description",
        content: "Resumo, requisitos, inspeções, documentos, evidências e ações do silo fictício.",
      },
      { property: "og:title", content: "Detalhe do silo — SiloNR" },
      { property: "og:description", content: "Histórico e pendências do silo demonstrativo." },
    ],
  }),
});

function SiloDetailPage() {
  const { siloId } = Route.useParams();
  const state = useAppState((s) => s);
  const exists = state.silos.some((s) => s.id === siloId);

  if (!exists) {
    return (
      <EmptyState
        title="Silo não encontrado"
        description="O silo solicitado não existe neste ambiente demonstrativo."
      />
    );
  }

  const st = siloStats(state, siloId);
  const evidencias = state.evidence.filter((e) => e.siloId === siloId);
  const inspecoes = state.inspections.filter((i) => i.siloId === siloId);
  const docs = documentsWithStatus(state).filter((d) => d.siloId === siloId);

  const timeline = [
    st.inspecao.diasDesdeUltima !== null
      ? {
          quando: `${st.inspecao.diasDesdeUltima} dias atrás`,
          texto: "Última inspeção interna cadastrada",
        }
      : { quando: "—", texto: "Nenhuma inspeção interna cadastrada" },
    ...docs
      .filter((d) => d.status === "vencido")
      .map((d) => ({
        quando: `${Math.abs(d.diasRestantes ?? 0)} dias atrás`,
        texto: `Documento venceu: ${d.nome}`,
      })),
    ...docs
      .filter((d) => d.status === "vence_em_breve")
      .map((d) => ({
        quando: `em ${d.diasRestantes} dias`,
        texto: `Documento entra em vencimento: ${d.nome}`,
      })),
    ...st.acoes
      .filter((a) => a.atrasada)
      .map((a) => ({
        quando: `${a.diasAtraso} dias atrás`,
        texto: `Prazo de ação corretiva expirou: ${a.titulo}`,
      })),
    ...st.requisitos
      .filter((r) => r.evidenciaObrigatoria && r.evidencias.length === 0)
      .slice(0, 1)
      .map(() => ({ quando: "Hoje", texto: "Evidência obrigatória continua ausente" })),
  ];

  return (
    <div>
      <PageHeader
        title={st.silo.nome}
        subtitle={`${st.silo.tipo} · ${st.silo.capacidadeToneladas.toLocaleString("pt-BR")} t · periodicidade interna de ${st.silo.periodicidadeInspecaoDias} dias`}
        actions={<StatusBadge status={st.status} />}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Card label="Índice interno" value={`${st.index.percent}%`} />
        <Card label="Pendências" value={String(st.index.pendentes)} />
        <Card label="Críticos" value={String(st.index.criticos)} />
        <Card label="Documentos vencidos" value={String(st.documentosVencidos)} />
      </div>

      <Tabs defaultValue="resumo" className="mt-5">
        <TabsList className="flex-wrap">
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="requisitos">Requisitos</TabsTrigger>
          <TabsTrigger value="inspecoes">Inspeções</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="evidencias">Evidências</TabsTrigger>
          <TabsTrigger value="acoes">Ações</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="mt-4 space-y-4">
          <div className="rounded border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Problemas relevantes identificados</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {st.inspecao.foraDaPeriodicidade ? (
                <li>Inspeção interna fora da periodicidade cadastrada ({st.inspecao.atrasoDias} dias).</li>
              ) : null}
              {st.index.criticos > 0 ? <li>{st.index.criticos} itens classificados como críticos.</li> : null}
              {st.documentosVencidos > 0 ? <li>{st.documentosVencidos} documento(s) vencido(s).</li> : null}
              {st.acoesAtrasadas > 0 ? <li>{st.acoesAtrasadas} ação(ões) corretiva(s) atrasada(s).</li> : null}
              {st.index.criticos === 0 && st.documentosVencidos === 0 && st.acoesAtrasadas === 0 ? (
                <li>Nenhum problema relevante registrado para este silo.</li>
              ) : null}
            </ul>
          </div>

          <div className="rounded border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Linha do tempo (dados fictícios)</h2>
            <ol className="mt-3 space-y-3 border-l border-border pl-4">
              {timeline.map((t, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" aria-hidden="true" />
                  <p className="text-xs font-medium text-muted-foreground">{t.quando}</p>
                  <p className="text-sm">{t.texto}</p>
                </li>
              ))}
            </ol>
          </div>
        </TabsContent>

        <TabsContent value="requisitos" className="mt-4">
          <TableWrap>
            <thead className="bg-muted/70">
              <tr>
                <Th>Código</Th>
                <Th>Título</Th>
                <Th>Categoria</Th>
                <Th>Status</Th>
                <Th>Responsável</Th>
              </tr>
            </thead>
            <tbody>
              {st.requisitos.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link
                      to="/app/requirements/$reqId"
                      params={{ reqId: r.id }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {r.codigo}
                    </Link>
                  </Td>
                  <Td>{r.titulo}</Td>
                  <Td>{r.categoria}</Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td>{r.responsavel}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </TabsContent>

        <TabsContent value="inspecoes" className="mt-4">
          {inspecoes.length === 0 ? (
            <EmptyState
              title="Nenhuma inspeção registrada"
              description="Registre uma inspeção interna para este silo pelo modo campo ou pela tela de inspeções."
            />
          ) : (
            <TableWrap>
              <thead className="bg-muted/70">
                <tr>
                  <Th>Código</Th>
                  <Th>Data</Th>
                  <Th>Tipo</Th>
                  <Th>Responsável</Th>
                  <Th>Itens</Th>
                </tr>
              </thead>
              <tbody>
                {inspecoes.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <Link
                        to="/app/inspections/$inspectionId"
                        params={{ inspectionId: i.id }}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {i.codigo}
                      </Link>
                    </Td>
                    <Td>{fmtDate(i.data)}</Td>
                    <Td>{i.tipo}</Td>
                    <Td>{i.responsavel}</Td>
                    <Td>{i.itens.length}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          {docs.length === 0 ? (
            <EmptyState
              title="Nenhum documento vinculado"
              description="Cadastre documentos na tela Documentos e vincule-os a este silo."
            />
          ) : (
            <TableWrap>
              <thead className="bg-muted/70">
                <tr>
                  <Th>Documento</Th>
                  <Th>Validade</Th>
                  <Th>Dias restantes</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <Tr key={d.id}>
                    <Td>{d.nome}</Td>
                    <Td>{fmtDate(d.validade)}</Td>
                    <Td>{d.diasRestantes ?? "—"}</Td>
                    <Td>
                      <StatusBadge status={d.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </TabsContent>

        <TabsContent value="evidencias" className="mt-4">
          {evidencias.length === 0 ? (
            <EmptyState
              title="Nenhuma evidência cadastrada"
              description="Adicione uma foto, documento ou registro relacionado a este silo."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-3">
              {evidencias.map((e) => (
                <li key={e.id} className="rounded border border-border bg-card p-3">
                  {e.dataUrl ? (
                    <img src={e.dataUrl} alt={e.nome} className="mb-2 h-32 w-full rounded object-cover" />
                  ) : null}
                  <p className="text-sm font-medium">{e.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(e.data)} · {e.responsavel}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="acoes" className="mt-4">
          {st.acoes.length === 0 ? (
            <EmptyState
              title="Nenhuma ação corretiva"
              description="Crie ações corretivas a partir das pendências deste silo."
            />
          ) : (
            <TableWrap>
              <thead className="bg-muted/70">
                <tr>
                  <Th>Código</Th>
                  <Th>Título</Th>
                  <Th>Prazo</Th>
                  <Th>Status</Th>
                  <Th>Atraso</Th>
                </tr>
              </thead>
              <tbody>
                {st.acoes.map((a) => (
                  <Tr key={a.id}>
                    <Td>{a.codigo}</Td>
                    <Td>{a.titulo}</Td>
                    <Td>{fmtDate(a.prazo)}</Td>
                    <Td>
                      <StatusBadge status={a.atrasada ? "atrasada" : a.status} />
                    </Td>
                    <Td>{a.atrasada ? `${a.diasAtraso} dias` : "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <TableWrap>
            <thead className="bg-muted/70">
              <tr>
                <Th>Data</Th>
                <Th>Evento</Th>
                <Th>Resumo</Th>
              </tr>
            </thead>
            <tbody>
              {state.audit.slice(0, 20).map((a) => (
                <Tr key={a.id}>
                  <Td>{fmtDate(a.data.slice(0, 10))}</Td>
                  <Td>{a.evento}</Td>
                  <Td>{a.resumo}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </TabsContent>
      </Tabs>

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
