import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Disclaimer, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { DISCLAIMER } from "@/lib/formatting";
import { addEvidence, createNonconformity, fileToDataUrl, updateRequirement } from "@/lib/storage/mutations";
import { useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/field")({
  component: FieldPage,
  head: () => ({
    meta: [
      { title: "Modo campo — SiloNR" },
      {
        name: "description",
        content: "Verificação rápida em campo: marque critérios, anexe fotos e registre pendências.",
      },
      { property: "og:title", content: "Modo campo — SiloNR" },
      { property: "og:description", content: "Interface móvel para vistoria rápida nos silos." },
    ],
  }),
});

function FieldPage() {
  const state = useAppState((s) => s);
  const [siloId, setSiloId] = useState(state.silos[0]?.id ?? "");
  const [obs, setObs] = useState("");

  const requisitos = useMemo(
    () => state.requirements.filter((r) => r.siloIds.includes(siloId) && r.aplicavel),
    [state.requirements, siloId],
  );

  const silo = state.silos.find((s) => s.id === siloId);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Modo campo"
        subtitle="Registro rápido durante a vistoria, otimizado para celular."
        actions={
          <Button asChild variant="outline">
            <Link to="/app/inspections/new">Inspeção completa</Link>
          </Button>
        }
      />

      <div className="space-y-2 rounded border border-border bg-card p-3">
        <Select value={siloId} onValueChange={setSiloId}>
          <SelectTrigger aria-label="Selecionar silo">
            <SelectValue placeholder="Selecione o silo" />
          </SelectTrigger>
          <SelectContent>
            {state.silos.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {silo ? (
          <p className="text-xs text-muted-foreground">
            {silo.tipo} · {silo.capacidadeToneladas} t · inspeção a cada{" "}
            {silo.periodicidadeInspecaoDias} dias
          </p>
        ) : null}
      </div>

      <ul className="mt-4 space-y-2">
        {requisitos.map((r) => (
          <li key={r.id} className="rounded border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  {r.codigo} — {r.titulo}
                </p>
                <p className="text-xs text-muted-foreground">{r.categoria}</p>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  updateRequirement(r.id, { status: "atendido" }, "Marcado como atendido no modo campo.");
                  toast.success("Critério marcado como atendido.");
                }}
              >
                Conforme
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  updateRequirement(
                    r.id,
                    { status: r.criticidade === "alta" ? "critico" : "pendente" },
                    "Pendência registrada no modo campo.",
                  );
                  createNonconformity({
                    titulo: `Pendência em ${r.codigo} — ${r.titulo}`,
                    siloId,
                    origem: "Modo campo",
                    criticidade: r.criticidade,
                    responsavel: r.responsavel,
                    requirementId: r.id,
                  });
                  toast.success("Pendência registrada.");
                }}
              >
                Não conforme
              </Button>
              <label className="inline-flex">
                <span className="sr-only">Anexar foto para {r.codigo}</span>
                <Input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="h-8 w-44 text-xs"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const dataUrl = await fileToDataUrl(file);
                    addEvidence({
                      nome: file.name,
                      tipo: "foto",
                      dataUrl,
                      requirementId: r.id,
                      siloId,
                      descricao: `Registro de campo — ${r.codigo}`,
                    });
                    toast.success("Foto anexada ao critério.");
                  }}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 space-y-2 rounded border border-border bg-card p-3">
        <Textarea
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Observação geral da vistoria"
          aria-label="Observação geral da vistoria"
        />
        <Button
          onClick={() => {
            if (!obs.trim()) {
              toast.error("Escreva uma observação antes de registrar.");
              return;
            }
            addEvidence({
              nome: "Observação de campo",
              tipo: "registro",
              siloId,
              descricao: obs.trim(),
            });
            setObs("");
            toast.success("Observação registrada.");
          }}
        >
          Registrar observação
        </Button>
      </div>

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}
