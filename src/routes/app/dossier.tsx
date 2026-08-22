import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Disclaimer, PageHeader } from "@/components/layout/PageHeader";
import { DISCLAIMER } from "@/lib/formatting";
import { DEFAULT_DOSSIER_OPTIONS, downloadDossier, type DossierOptions } from "@/lib/reports/dossier";
import { getState, useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/dossier")({
  component: DossierPage,
  head: () => ({
    meta: [
      { title: "Dossiê de prontidão — SiloNR" },
      {
        name: "description",
        content: "Gere um PDF consolidado com requisitos, documentos, inspeções, pendências e ações.",
      },
      { property: "og:title", content: "Dossiê de prontidão — SiloNR" },
      { property: "og:description", content: "Relatório consolidado do ambiente demonstrativo." },
    ],
  }),
});

const SECOES = [
  ["incluirRequisitos", "Matriz de requisitos"],
  ["incluirDocumentos", "Documentos e validades"],
  ["incluirInspecoes", "Inspeções realizadas"],
  ["incluirPendencias", "Não conformidades"],
  ["incluirAcoes", "Ações corretivas"],
  ["incluirEvidencias", "Índice de evidências"],
  ["incluirHistorico", "Trilha de auditoria"],
] as const;

function DossierPage() {
  const silos = useAppState((s) => s.silos);
  const [options, setOptions] = useState<DossierOptions>({
    ...DEFAULT_DOSSIER_OPTIONS,
    siloIds: [],
  });

  function toggleSilo(id: string, on: boolean) {
    setOptions((o) => ({
      ...o,
      siloIds: on ? [...o.siloIds, id] : o.siloIds.filter((x) => x !== id),
    }));
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Dossiê de prontidão"
        subtitle="Selecione o escopo e gere o PDF consolidado da unidade."
        actions={
          <Button
            onClick={() => {
              try {
                downloadDossier(getState(), options);
                toast.success("Dossiê gerado.");
              } catch {
                toast.error("Não foi possível gerar o dossiê.");
              }
            }}
          >
            Gerar PDF
          </Button>
        }
      />

      <section className="space-y-3 rounded border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Silos incluídos</h2>
        <p className="text-xs text-muted-foreground">
          Sem seleção, o dossiê considera todos os silos da unidade.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {silos.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <Checkbox
                id={`silo-${s.id}`}
                checked={options.siloIds.includes(s.id)}
                onCheckedChange={(v) => toggleSilo(s.id, v === true)}
              />
              <Label htmlFor={`silo-${s.id}`} className="text-sm font-normal">
                {s.nome}
              </Label>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4 space-y-3 rounded border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Seções do relatório</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {SECOES.map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={key}
                checked={options[key]}
                onCheckedChange={(v) => setOptions((o) => ({ ...o, [key]: v === true }))}
              />
              <Label htmlFor={key} className="text-sm font-normal">
                {label}
              </Label>
            </div>
          ))}
        </div>
      </section>

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}
