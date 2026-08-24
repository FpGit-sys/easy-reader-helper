import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/workspace";
import { createProductionInspection } from "@/server/operations/inspections.functions";
import { listProductionSilos } from "@/server/operations/silos.functions";
import { can, type Role } from "@/server/rbac";

const TYPES = [
  "Inspeção periódica",
  "Inspeção pós-manutenção",
  "Verificação de pendências",
  "Inspeção extraordinária",
] as const;

export function ProductionNewInspectionPage() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [siloId, setSiloId] = useState("");
  const [type, setType] = useState<string>(TYPES[0]);
  const [notes, setNotes] = useState("");

  const silosQuery = useQuery({
    queryKey: ["production", "silos", workspace?.organizationId, workspace?.facilityId],
    queryFn: () =>
      listProductionSilos({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
        },
      }),
    enabled: Boolean(workspace),
  });

  const selectedSilo = useMemo(
    () => (silosQuery.data ?? []).find((silo) => silo.id === siloId) ?? null,
    [siloId, silosQuery.data],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      createProductionInspection({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          siloId,
          type,
          notes,
        },
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["production", "inspections"] });
      toast.success(`Inspeção ${created.code} iniciada.`);
      await navigate({
        to: "/app/inspections/$inspectionId",
        params: { inspectionId: created.id },
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "INSPECTION_CREATE_FAILED";
      if (message.includes("INSPECTION_NO_PUBLISHED_CRITERIA")) {
        toast.error("Este silo não possui critérios publicados vinculados para formar o checklist.");
        return;
      }
      toast.error("Não foi possível iniciar a inspeção.");
    },
  });

  if (workspaceState.loading) return <Loading text="Carregando unidade…" />;
  if (workspaceState.error) {
    return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  }
  if (!workspace) {
    return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e uma unidade para continuar." />;
  }
  if (!can(workspace.role as Role, "inspections.execute")) {
    return (
      <EmptyState
        title="Sem permissão para executar inspeções"
        description="Seu perfil pode consultar registros, mas não iniciar uma nova inspeção nesta unidade."
        action={
          <Button asChild variant="outline">
            <Link to="/app/inspections">Voltar para inspeções</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Nova inspeção"
        subtitle={`${workspace.facilityName} · o checklist será congelado no momento em que a inspeção iniciar`}
        actions={
          <Button asChild variant="outline">
            <Link to="/app/inspections">Cancelar</Link>
          </Button>
        }
      />

      {silosQuery.isLoading ? (
        <Loading text="Carregando silos…" />
      ) : silosQuery.error ? (
        <EmptyState
          title="Não foi possível carregar os silos"
          description="Verifique a conexão e tente novamente."
        />
      ) : (silosQuery.data ?? []).length === 0 ? (
        <EmptyState
          title="Nenhum silo disponível"
          description="Cadastre um silo antes de iniciar uma inspeção."
          action={
            <Button asChild variant="outline">
              <Link to="/app/silos">Ir para silos</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-5 rounded border border-border bg-card p-5">
          <div>
            <Label htmlFor="inspection-silo">Silo</Label>
            <Select value={siloId} onValueChange={setSiloId}>
              <SelectTrigger id="inspection-silo">
                <SelectValue placeholder="Selecione o silo" />
              </SelectTrigger>
              <SelectContent>
                {(silosQuery.data ?? []).map((silo) => (
                  <SelectItem key={silo.id} value={silo.id}>
                    {silo.code} — {silo.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedSilo ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Periodicidade interna cadastrada: {selectedSilo.inspectionPeriodDays} dias.
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="inspection-type">Tipo</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="inspection-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="inspection-notes">Contexto / observações iniciais</Label>
            <Textarea
              id="inspection-notes"
              rows={4}
              value={notes}
              maxLength={5000}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Ex.: inspeção periódica do turno da manhã; área liberada pela operação."
            />
          </div>

          <div className="rounded border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Ao iniciar, o SiloNR registra a versão exata dos critérios publicados vinculados ao silo. Alterações posteriores na matriz não mudam retroativamente este checklist.
          </div>

          <div className="flex justify-end">
            <Button
              disabled={!siloId || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              Iniciar inspeção
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 rounded border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-muted-foreground">
        O checklist usa somente critérios publicados e explicitamente vinculados ao silo. O SiloNR registra uma verificação operacional; não emite certificação de conformidade legal.
      </div>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {text}
    </div>
  );
}
