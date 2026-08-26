import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck, Loader2, Plus } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { listProductionInspections } from "@/server/operations/inspections.functions";
import { can, type Role } from "@/server/rbac";

type InspectionRow = Awaited<ReturnType<typeof listProductionInspections>>[number];

export function ProductionInspectionsPage() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;

  const inspectionsQuery = useQuery({
    queryKey: ["production", "inspections", workspace?.organizationId, workspace?.facilityId],
    queryFn: () =>
      listProductionInspections({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
        },
      }),
    enabled: Boolean(workspace),
  });

  if (workspaceState.loading) return <Loading text="Carregando inspeções…" />;
  if (workspaceState.error) {
    return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  }
  if (!workspace) {
    return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e uma unidade para continuar." />;
  }

  const canExecute = can(workspace.role as Role, "inspections.execute");
  const rows = inspectionsQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Inspeções"
        subtitle={`${workspace.facilityName} · checklists congelados por versão e histórico rastreável`}
        actions={
          canExecute ? (
            <Button asChild>
              <Link to="/app/inspections/new">
                <Plus className="size-4" aria-hidden="true" />
                Nova inspeção
              </Link>
            </Button>
          ) : undefined
        }
      />

      {inspectionsQuery.isLoading ? (
        <Loading text="Carregando inspeções…" />
      ) : inspectionsQuery.error ? (
        <EmptyState
          title="Não foi possível carregar as inspeções"
          description="Verifique a conexão e suas permissões para esta unidade."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhuma inspeção registrada"
          description="Inicie uma inspeção a partir de critérios publicados e vinculados a um silo."
          action={
            canExecute ? (
              <Button asChild>
                <Link to="/app/inspections/new">Iniciar primeira inspeção</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-card">
          <table className="w-full table-dense">
            <thead className="bg-muted/70 text-left">
              <tr>
                <Th>Código</Th>
                <Th>Silo</Th>
                <Th>Tipo</Th>
                <Th>Início</Th>
                <Th>Itens</Th>
                <Th>Pontos de atenção</Th>
                <Th>Não conformidades abertas</Th>
                <Th>Status</Th>
                <Th>Ações</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <InspectionRowView key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 rounded border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Importante:</strong> uma inspeção no SiloNR registra o que foi verificado e preserva a versão dos critérios utilizada naquele momento. O registro não substitui responsável técnico, auditoria, laudo, fiscalização ou interpretação normativa aplicável.
      </div>
    </div>
  );
}

function InspectionRowView({ row }: { row: InspectionRow }) {
  return (
    <tr className="border-t border-border align-top">
      <Td className="font-medium">{row.code}</Td>
      <Td>
        <span className="font-medium">{row.siloName}</span>
        <span className="block text-xs text-muted-foreground">{row.siloCode}</span>
      </Td>
      <Td>{row.type}</Td>
      <Td>{formatDateTime(row.startedAt)}</Td>
      <Td>{row.itemCount}</Td>
      <Td>{row.issueCount}</Td>
      <Td>{row.openFindingCount}</Td>
      <Td><StatusBadge status={row.status} /></Td>
      <Td>
        <Button asChild size="sm" variant="outline">
          <Link to="/app/inspections/$inspectionId" params={{ inspectionId: row.id }}>
            {row.status === "em_andamento" ? "Continuar" : "Ver registro"}
          </Link>
        </Button>
      </Td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-sm ${className}`}>{children}</td>;
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {text}
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
