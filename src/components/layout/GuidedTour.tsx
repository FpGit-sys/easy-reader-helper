import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { setState, useAppState } from "@/lib/storage/store";

const STEPS = [
  "Veja o nível de prontidão da unidade.",
  "Identifique os itens que precisam de atenção primeiro.",
  "Cada requisito pode possuir documentos, evidências e responsável.",
  "Crie ações corretivas e acompanhe prazos.",
  "Gere um dossiê organizado em PDF.",
];

export function GuidedTour() {
  const concluido = useAppState((s) => s.settings.tourConcluido);
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!concluido);
  }, [concluido]);

  if (!visible) return null;

  const finish = () => {
    setState((s) => ({ ...s, settings: { ...s.settings, tourConcluido: true } }));
    setVisible(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Tour guiado"
    >
      <div className="w-full max-w-md rounded border border-border bg-card p-5 shadow-xl">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tour guiado — passo {step + 1} de {STEPS.length}
        </p>
        <p className="mt-2 text-base font-medium">{STEPS[step]}</p>
        <div className="mt-5 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={finish}>
            Pular
          </Button>
          <div className="flex gap-2">
            {step > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setStep((s) => s - 1)}>
                Voltar
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => (step === STEPS.length - 1 ? finish() : setStep((s) => s + 1))}
            >
              {step === STEPS.length - 1 ? "Começar" : "Próximo"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
