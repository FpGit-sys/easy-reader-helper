import { Download, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  checkDesktopUpdate,
  installDesktopUpdate,
  type DesktopUpdate,
} from "@/lib/native-updates";

export function UpdateBanner() {
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let active = true;
    void checkDesktopUpdate()
      .then((result) => {
        if (active && result?.available) setUpdate(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!update?.available || !update.version) return null;

  const install = async () => {
    if (
      !window.confirm(
        `Instalar o SiloNR ${update.version} agora? O sistema fará backup, fechará esta janela e atualizará sem apagar os dados.`,
      )
    )
      return;
    setInstalling(true);
    try {
      await installDesktopUpdate();
    } catch (error) {
      setInstalling(false);
      toast.error(
        error instanceof Error ? error.message : "Não foi possível instalar a atualização.",
      );
    }
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm lg:px-8"
    >
      <ShieldCheck className="size-5 text-amber-700" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          Atualização SiloNR {update.version} disponível
          {update.mandatory ? " — necessária" : ""}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {update.notes || "Correções e melhorias verificadas digitalmente."}
        </p>
      </div>
      <Button size="sm" onClick={() => void install()} disabled={installing}>
        {installing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
        {installing ? "Baixando e verificando…" : "Atualizar agora"}
      </Button>
    </div>
  );
}
