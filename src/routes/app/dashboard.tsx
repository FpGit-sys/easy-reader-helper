import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, FileDown, Info, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Disclaimer, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  dashboardMetrics,
  pendenciasPorCategoria,
  siloStats,
  statusChartData,
} from "@/lib/calculations/derive";
import { DISCLAIMER } from "@/lib/formatting";
import { useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Visão geral — SiloNR" },
      {
        name: "description",
        content:
          "Painel demonstrativo de prontidão para auditoria da unidade armazenadora fictícia Santa Rita.",
      },
      { property: "og:title", content: "Visão geral — SiloNR" },
      {
        property: "og:description",
        content: "Prontidão documental e operacional, pendências e riscos por silo.",
      },
    ],
  }),
});

function DashboardPage() {
  const state = useAppState((s) => s);
  const m = dashboardMetrics(state);
  const chart = statusChartData(state);
  const categorias = pendenciasPorCategoria(state);
  const silo3 = siloStats(state, "silo-03");
  const [diag, setDiag] = useState<"idle" | "loading" | "done">("idle");

  const runDiagnostico = () => {
    setDiag("loading");
    setTimeout(() => setDiag("done"), 1400);
  };

  return (
    <div>
      <PageHeader
        title={state.settings.unidadeNome}
        subtitle="Prontidão para auditoria"
        actions={
          <>
            <Button variant="outline" onClick={runDiagnostico} disabled={diag === "loading"}>
              {diag === "loading" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <PlayCircle className="size-4" aria-hidden="true" />
              )}
              Executar diagnóstico demonstrativo
            </Button>
            <Button asChild>
              <Link to="/app/dossier">
                <FileDown className="size-4" aria-hidden="true" />
                Gerar dossiê de auditoria
              </Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-border bg-card p-4 md:col-span-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Prontidão documental e operacional
          </p>
          <p className="mt-1 text-4xl font-semibold text-primary">{m.percent}%</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {m.atendidos} de {m.totalAplicaveis} itens aplicáveis atendidos
          </p>
          <IndexExplainer atendidos={m.atendidos} total={m.totalAplicaveis} exato={m.percentExato} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:col-span-3 lg:grid-cols-3">
          <Kpi label="Riscos críticos" value={m.criticos} tone="danger" to="/app/requirements" />
          <Kpi label="Pendências" value={m.pendentes} tone="warning" to="/app/nonconformities" />
          <Kpi label="Itens atendidos" value={m.atendidos} tone="success" to="/app/requirements" />
          <Kpi label="Documentos vencidos" value={m.documentosVencidos} tone="danger" to="/app/documents" />
          <Kpi label="Documentos vencendo" value={m.documentosVencendo} tone="warning" to="/app/documents" />
          <Kpi label="Ações atrasadas" value={m.acoesAtrasadas} tone="danger" to="/app/actions" />
        </div>
      </section>

      <p className="mt-3 rounded border border-info/30 bg-info/10 p-3 text-xs text-foreground">
        Índice interno calculado com base nos critérios cadastrados. Não representa certificação ou
        parecer legal.
      </p>

      {diag !== "idle" ? (
        <section className="mt-5 rounded border border-primary/30 bg-primary/5 p-4">
          {diag === "loading" ? (
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Processando critérios cadastrados…
            </p>
          ) : (
            <div>
              <h2 className="text-base font-semibold">Diagnóstico concluído</h2>
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-5">
                <li>{m.totalAplicaveis} itens analisados</li>
                <li>{m.atendidos} atendidos</li>
                <li>{m.pendentes} pendentes</li>
                <li>{m.criticos} críticos</li>
                <li>{m.percent}% prontidão</li>
              </ul>
              <p className="mt-3 text-sm font-medium">
                {m.criticos} itens merecem atenção imediata
              </p>
              <p className="text-sm text-muted-foreground">
                Silo 03 — conjunto de evidências incompleto
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to="/app/silos/$siloId" params={{ siloId: "silo-03" }}>
                    Ver por que foi classificado como crítico
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/app/dossier">GERAR DOSSIÊ DE AUDITORIA</Link>
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Itens por status</h2>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={chart} dataKey="valor" nameKey="name" innerRadius={55} outerRadius={90}>
                  {chart.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {chart.map((c) => (
              <li key={c.name} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 rounded-sm"
                  style={{ backgroundColor: c.fill }}
                  aria-hidden="true"
                />
                {c.name}: {c.valor}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Pendências por categoria</h2>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categorias} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} fontSize={11} />
                <YAxis dataKey="categoria" type="category" width={140} fontSize={11} />
                <Tooltip />
                <Bar dataKey="valor" fill="var(--color-chart-2)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="mt-5 rounded border border-destructive/30 bg-card p-4">
        <h2 className="text-sm font-semibold">Riscos que exigem atenção</h2>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold">SILO 03</span>
              <StatusBadge status="critico" />
            </div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>
                Última inspeção interna registrada há {silo3.inspecao.diasDesdeUltima ?? "—"} dias
              </li>
              <li>Evidência obrigatória ausente</li>
              <li>Documento relacionado vencido</li>
              <li>Ação corretiva atrasada</li>
            </ul>
          </div>
          <Button asChild variant="outline">
            <Link to="/app/silos/$siloId" params={{ siloId: "silo-03" }}>
              Investigar Silo 03
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  to,
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "success";
  to: "/app/requirements" | "/app/nonconformities" | "/app/documents" | "/app/actions";
}) {
  const color =
    tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-success";
  return (
    <Link
      to={to}
      className="rounded border border-border bg-card p-3 transition-colors hover:border-primary/40"
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
    </Link>
  );
}

function IndexExplainer({
  atendidos,
  total,
  exato,
}: {
  atendidos: number;
  total: number;
  exato: number;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="mt-3 h-7 px-2 text-xs">
          <Info className="size-3.5" aria-hidden="true" />
          Como este índice é calculado?
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Cálculo do índice interno</SheetTitle>
          <SheetDescription>Função pura, sem ponderação silenciosa.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 text-sm">
          <p className="rounded bg-muted p-3 font-mono text-xs">
            {atendidos} itens atendidos / {total} itens aplicáveis = {exato.toFixed(2)}%
          </p>
          <p>Itens marcados como não aplicáveis saem do denominador.</p>
          <p>
            A criticidade não é ponderada. Qualquer ponderação futura precisará ser configurável e
            explicada.
          </p>
          <p className="text-muted-foreground">
            Este índice mede apenas os critérios cadastrados no SiloNR e não representa certificação
            legal.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
