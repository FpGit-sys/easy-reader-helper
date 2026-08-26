import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Laptop, Loader2, RefreshCcw, ShieldOff, WifiOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { can, type Role } from "@/server/rbac";
import {
  createDesktopPairingCode,
  listMyDesktopDevices,
  revokeMyDesktopDevice,
} from "@/server/operations/offline.functions";

export function DesktopOfflineSetupCard() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const queryClient = useQueryClient();
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const canUseOffline = workspace ? can(workspace.role as Role, "inspections.execute") : false;

  const queryKey = [
    "production",
    "desktop-devices",
    workspace?.organizationId,
    workspace?.facilityId,
  ];
  const devicesQuery = useQuery({
    queryKey,
    queryFn: () =>
      listMyDesktopDevices({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
        },
      }),
    enabled: Boolean(workspace && canUseOffline),
  });

  const pairingMutation = useMutation({
    mutationFn: () =>
      createDesktopPairingCode({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
        },
      }),
    onSuccess: (result) => {
      setPairing(result);
      toast.success("Código temporário criado.");
    },
    onError: () => toast.error("Não foi possível gerar o código de ativação."),
  });

  const revokeMutation = useMutation({
    mutationFn: (deviceId: string) =>
      revokeMyDesktopDevice({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          deviceId,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["production", "desktop-devices"] });
      toast.success("Computador revogado. O token local não poderá mais sincronizar.");
    },
    onError: () => toast.error("Não foi possível revogar o computador."),
  });

  if (workspaceState.loading || !workspace || !canUseOffline) return null;

  const activeDevices = (devicesQuery.data ?? []).filter((device) => !device.revokedAt);
  const expiresInMinutes = pairing
    ? Math.max(0, Math.ceil((new Date(pairing.expiresAt).getTime() - Date.now()) / 60_000))
    : 0;

  async function copyCode() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      toast.success("Código copiado.");
    } catch {
      toast.error("Não foi possível copiar automaticamente. Selecione o código e copie manualmente.");
    }
  }

  return (
    <section className="mx-auto w-full max-w-6xl rounded border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <WifiOff className="size-4" aria-hidden="true" />
            <h2 className="font-semibold">SiloNR Desktop e modo offline</h2>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Ative um computador Windows para baixar o checklist publicado desta unidade, registrar
            inspeções em SQLite local e sincronizar depois. O servidor continua sendo a fonte
            oficial e valida tenant, usuário, versão do checklist e conflitos antes de aceitar os
            dados.
          </p>
        </div>
        <Button
          onClick={() => pairingMutation.mutate()}
          disabled={pairingMutation.isPending}
        >
          {pairingMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Laptop className="size-4" aria-hidden="true" />
          )}
          Gerar código de ativação
        </Button>
      </div>

      {pairing ? (
        <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Código de uso único
              </p>
              <p className="mt-1 select-all font-mono text-2xl font-semibold tracking-wider">
                {pairing.code}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Expira em aproximadamente {expiresInMinutes} minuto(s). Gerar outro código invalida
                este código ainda não utilizado para o mesmo usuário e unidade.
              </p>
            </div>
            <Button variant="outline" onClick={() => void copyCode()}>
              <Copy className="size-4" aria-hidden="true" />
              Copiar código
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h3 className="text-sm font-semibold">Computadores vinculados a você nesta unidade</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A revogação interrompe novas sincronizações sem apagar o histórico já enviado.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => devicesQuery.refetch()}
          disabled={devicesQuery.isFetching}
        >
          <RefreshCcw
            className={`size-3.5 ${devicesQuery.isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Atualizar
        </Button>
      </div>

      {devicesQuery.isLoading ? (
        <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
          Carregando computadores…
        </div>
      ) : devicesQuery.error ? (
        <p className="py-5 text-sm text-destructive">Não foi possível carregar os computadores vinculados.</p>
      ) : activeDevices.length === 0 ? (
        <p className="py-5 text-sm text-muted-foreground">
          Nenhum computador ativo para este usuário e unidade. Gere um código acima e use-o no
          SiloNR Desktop instalado no Windows.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {activeDevices.map((device) => (
            <div key={device.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <p className="truncate text-sm font-medium">{device.name}</p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                    <Check className="size-3" aria-hidden="true" /> Ativo
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {device.platform} · app {device.appVersion} · ativado {formatDate(device.activatedAt)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Último contato: {formatDate(device.lastSeenAt)} · último sync: {formatDate(device.lastSyncAt)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={revokeMutation.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Revogar ${device.name}? Inspeções locais ainda não sincronizadas continuarão no computador, mas o servidor rejeitará novas sincronizações até uma nova ativação.`,
                    )
                  ) {
                    revokeMutation.mutate(device.id);
                  }
                }}
              >
                <ShieldOff className="size-3.5" aria-hidden="true" />
                Revogar
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 rounded border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-muted-foreground">
        O modo offline desta fase não guarda a senha da conta. A instalação usa um token revogável
        próprio do dispositivo. Evidências obrigatórias ainda devem ser anexadas no ambiente online
        antes da conclusão definitiva da inspeção.
      </div>
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) return "ainda não realizado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
