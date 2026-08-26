import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, FileWarning, Loader2, ShieldCheck, Wrench } from "lucide-react";
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
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { getProductionDashboard } from "@/server/operations/dashboard.functions";

export const Route = createFileRoute("/app/overview")({
  component: ProductionOverviewPage,
  head: () => ({
    meta: [
      { title: "Visão geral — SiloNR" },
      {
        name: "description",
        content: "Visão operacional da unidade selecionada no SiloNR.",
      },
    ],
  }),
});

function ProductionOverviewPage() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const dashboardQuery = useQuery({
    queryKey: ["production", "dashboard", workspace?.organizationId, workspace?.facilityId],
    queryFn: () =>
      getProductionDashboard({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
        },
      }),
    enabled: Boolean(workspace),
  });

  if (workspaceState.loading) return <Loading text="Carregando sua unidade…" />;
  if (workspaceState.error) {
    return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  }
  if (!workspace) {
    return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e uma unidade na barra lateral." />;
  }
  if (dashboardQuery.isLoading) return <Loading text="Calculando o panorama operacional…" />;
  if (dashboardQuery.error || !dashboardQuery.data) {
    return (
      <EmptyState
        title="Não foi possível carregar a visão geral"
        description="Verifique a conexão com o servidor e as permissões da sua conta."
      />
    );
  }

  const data = dashboardQuery.data;
  const chart = data.statusChart.map((item, index) => ({
    ...item,
    fill: `var(--color-chart-${Math.min(index + 1, 5)})`,
  }));

  return (
    <div>
      <PageHeader
        title={data.facility.name}
        subtitle={
          [data.facility.city, data.facility.state].filter(Boolean).join(" — ") ||
          "Visão operacional da unidade"
        }
        actions={
          <Button asChild variant="outline">
            <Link to="/app/silos">
              Ver silos
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Prontidão interna</p>
          <p className="mt-1 text-4xl font-semibold text-primary">{data.readiness}%</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.attended} de {data.totalApplicable} critérios aplicáveis atendidos
          </p>
        </div>
        <Kpi label="Itens críticos" value={data.critical} icon={AlertTriangle} tone="danger" />
        <Kpi label="Documentos vencidos" value={data.documentsExpired} icon={FileWarning} tone="danger" />
        <Kpi label="Ações atrasadas" value={data.actionsOverdue} icon={Wrench} tone="warning" />
      </section>

      <section className="mt-3 grid gap-3 sm:grid-cols-3">
        <Kpi label="Pendências" value={data.pending} icon={AlertTriangle} tone="warning" compact />
        <Kpi label={`Documentos vencendo em ${data.expirationWindowDays} dias`} value={data.documentsExpiring} icon={FileWarning} compact />
        <Kpi label="Não conformidades abertas" value={data.openNonconformities} icon={ShieldCheck} compact />
      </section>

      <p className="mt-4 rounded border border-info/30 bg-info/10 p-3 text-xs text-muted-foreground">
        O índice de prontidão é uma projeção interna calculada sobre os critérios cadastrados no SiloNR. Ele não representa certificação, laudo, conformidade legal automática ou parecer de responsável técnico.
      </p>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Critérios por status</h2>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={chart} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}>
                  {chart.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {chart.map((item) => (
              <li key={item.name} className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: item.fill }} aria-hidden="true" />
                {item.name}: {item.value}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Pendências por categoria</h2>
          {data.pendingByCategory.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              Nenhuma pendência categorizada na unidade.
            </div>
          ) : (
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.pendingByCategory} layout="vertical" margin={{ left: 36 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} fontSize={11} />
                  <YAxis dataKey="category" type="category" width={140} fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="value" fill="var(--color-chart-2)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      <section className="mt-5 rounded border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Maior prioridade por silo</p>
            {data.prioritySilo ? (
              <>
                <h2 className="mt-1 text-lg font-semibold">{data.prioritySilo.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data.prioritySilo.critical} crítico(s), {data.prioritySilo.pending} pendência(s) e {data.prioritySilo.readiness}% de prontidão interna.
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Nenhum silo ativo cadastrado nesta unidade.</p>
            )}
          </div>
          <Button asChild>
            <Link to="/app/silos">Gerenciar silos</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  compact = false,
}: {
  label: string;
  value: number;
  icon: typeof AlertTriangle;
  tone?: "neutral" | "warning" | "danger";
  compact?: boolean;
}) {
  const valueClass =
    tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className={`rounded border border-border bg-card ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className={`mt-1 font-semibold ${compact ? "text-2xl" : "text-3xl"} ${valueClass}`}>{value}</p>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex min-h-64 items-center justify-center rounded border border-border bg-card text-sm text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
      {text}
    </div>
  );
}
