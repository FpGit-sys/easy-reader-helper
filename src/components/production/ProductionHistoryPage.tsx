import { useQuery } from "@tanstack/react-query";
import { Eye, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace";
import { listProductionAuditEvents } from "@/server/operations/audit.functions";

type AuditResult = Awaited<ReturnType<typeof listProductionAuditEvents>>;
type AuditRow = AuditResult["rows"][number];

export function ProductionHistoryPage() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("todos");
  const [actorUserId, setActorUserId] = useState("todos");
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [offset, setOffset] = useState(0);

  const auditQuery = useQuery({
    queryKey: [
      "production",
      "audit",
      workspace?.organizationId,
      workspace?.facilityId,
      search,
      entityType,
      actorUserId,
      offset,
    ],
    queryFn: () =>
      listProductionAuditEvents({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          search,
          entityType: entityType === "todos" ? null : entityType,
          eventType: null,
          actorUserId: actorUserId === "todos" ? null : actorUserId,
          from: null,
          to: null,
          limit: 100,
          offset,
        },
      }),
    enabled: Boolean(workspace),
  });

  if (workspaceState.loading) return <Loading text="Carregando unidade…" />;
  if (workspaceState.error) return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  if (!workspace) return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e uma unidade para continuar." />;

  const data = auditQuery.data;
  return (
    <div>
      <PageHeader
        title="Histórico e auditoria"
        subtitle={`${workspace.facilityName} · registro cronológico de operações persistidas no servidor`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
            placeholder="Buscar evento, objeto ou identificador"
            className="pl-8"
          />
        </div>
        <Select value={entityType} onValueChange={(value) => { setEntityType(value); setOffset(0); }}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os objetos</SelectItem>
            {(data?.facets.entityTypes ?? []).map((type) => (
              <SelectItem key={type} value={type}>{entityLabel(type)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actorUserId} onValueChange={(value) => { setActorUserId(value); setOffset(0); }}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os usuários</SelectItem>
            {(data?.facets.actors ?? []).map((actor) => (
              <SelectItem key={actor.id} value={actor.id}>{actor.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-4 rounded border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
        Esta trilha registra eventos operacionais do SiloNR no banco de produção. O aplicativo não oferece edição ou exclusão desses registros. Em implantação endurecida, a credencial de runtime também deve ser impedida de executar UPDATE/DELETE na tabela de auditoria.
      </div>

      {auditQuery.isLoading ? (
        <Loading text="Carregando histórico…" />
      ) : auditQuery.error ? (
        <EmptyState title="Não foi possível carregar o histórico" description="Verifique sua conexão e permissão de auditoria." />
      ) : !data?.rows.length ? (
        <EmptyState title="Nenhum evento encontrado" description="As operações realizadas nesta unidade aparecerão aqui." />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-card">
          <table className="w-full table-dense">
            <thead className="bg-muted/70 text-left"><tr><Th>Data/hora</Th><Th>Usuário</Th><Th>Evento</Th><Th>Objeto</Th><Th>Identificador</Th><Th><span className="sr-only">Detalhes</span></Th></tr></thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <Td className="whitespace-nowrap">{formatDateTime(row.occurredAt)}</Td>
                  <Td>{row.actorName}</Td>
                  <Td><span className="font-medium">{eventLabel(row.eventType)}</span><p className="mt-0.5 text-xs text-muted-foreground">{row.eventType}</p></Td>
                  <Td>{entityLabel(row.entityType)}</Td>
                  <Td className="max-w-56 truncate font-mono text-xs text-muted-foreground" title={row.entityId}>{row.entityId}</Td>
                  <Td><Button size="sm" variant="outline" onClick={() => setSelected(row)}><Eye className="size-3.5" aria-hidden="true" />Ver</Button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data ? (
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="outline" disabled={offset === 0 || auditQuery.isFetching} onClick={() => setOffset(Math.max(0, offset - 100))}>Mais recentes</Button>
          <p className="text-xs text-muted-foreground">Mostrando registros {offset + 1}–{offset + data.rows.length}</p>
          <Button variant="outline" disabled={!data.hasMore || auditQuery.isFetching} onClick={() => setOffset(data.nextOffset)}>Mais antigos</Button>
        </div>
      ) : null}

      {selected ? <AuditDetailDialog row={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function AuditDetailDialog({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{eventLabel(row.eventType)}</DialogTitle>
          <DialogDescription>{formatDateTime(row.occurredAt)} · {row.actorName} · {entityLabel(row.entityType)}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-3 rounded border border-border bg-muted/20 p-3 sm:grid-cols-2">
          <Info label="Tipo técnico" value={row.eventType} />
          <Info label="Objeto" value={row.entityType} />
          <Info label="Identificador" value={row.entityId} mono />
          <Info label="ID do evento" value={row.id} mono />
        </dl>
        <JsonSection title="Antes" value={row.before} />
        <JsonSection title="Depois" value={row.after} />
        <JsonSection title="Metadados" value={row.metadata} />
      </DialogContent>
    </Dialog>
  );
}

function JsonSection({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) return null;
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-3 text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt><dd className={`mt-1 break-all text-sm ${mono ? "font-mono text-xs" : "font-medium"}`}>{value}</dd></div>;
}

function eventLabel(value: string) {
  const labels: Record<string, string> = {
    "tenant.provisioned": "Ambiente provisionado",
    "silo.created": "Silo criado",
    "silo.updated": "Silo atualizado",
    "silo.archived": "Silo arquivado",
    "requirement.created": "Critério criado",
    "requirement.revised": "Critério revisado",
    "requirement.lifecycle_changed": "Ciclo do critério alterado",
    "requirement.state_changed": "Status operacional do critério alterado",
    "document.created": "Documento cadastrado",
    "document.version_uploaded": "Nova versão de documento",
    "document.metadata_updated": "Metadados do documento alterados",
    "document.downloaded": "Documento acessado",
    "inspection.started": "Inspeção iniciada",
    "inspection.answers_saved": "Rascunho de inspeção salvo",
    "inspection.completed": "Inspeção concluída",
    "evidence.uploaded": "Evidência de inspeção anexada",
    "corrective_action.created": "Ação corretiva criada",
    "corrective_action.updated": "Ação corretiva atualizada",
    "corrective_action.completed": "Ação corretiva concluída",
    "corrective_action.reopened": "Ação corretiva reaberta",
    "corrective_action.evidence_uploaded": "Evidência de ação anexada",
    "corrective_action.evidence_downloaded": "Evidência de ação acessada",
    "nonconformity.updated": "Não conformidade atualizada",
  };
  return labels[value] ?? value.replaceAll("_", " ").replaceAll(".", " · ");
}

function entityLabel(value: string) {
  const labels: Record<string, string> = {
    organization: "Organização",
    facility: "Unidade",
    silo: "Silo",
    requirement: "Critério",
    requirement_state: "Estado de critério",
    document: "Documento",
    inspection: "Inspeção",
    evidence: "Evidência",
    nonconformity: "Não conformidade",
    corrective_action: "Ação corretiva",
  };
  return labels[value] ?? value;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

function Th({ children }: { children: React.ReactNode }) { return <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</th>; }
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <td className={`px-3 py-2 text-sm ${className}`}>{children}</td>; }
function Loading({ text }: { text: string }) { return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{text}</div>; }
