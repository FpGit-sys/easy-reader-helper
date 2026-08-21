import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Disclaimer, PageHeader } from "@/components/layout/PageHeader";
import { DISCLAIMER } from "@/lib/formatting";
import { newId, useAppState } from "@/lib/storage/store";
import {
  addEvidence,
  createNonconformity,
  fileToDataUrl,
  nextInspectionCode,
  saveInspection,
} from "@/lib/storage/mutations";
import type { InspectionItem } from "@/types";

export const Route = createFileRoute("/app/inspections/new")({
  component: NewInspectionPage,
  head: () => ({
    meta: [
      { title: "Nova inspeção — SiloNR" },
      {
        name: "description",
        content: "Assistente em etapas para registrar uma inspeção interna de silo.",
      },
      { property: "og:title", content: "Nova inspeção — SiloNR" },
      { property: "og:description", content: "Checklist guiado com evidências e pendências." },
    ],
  }),
});

const TIPOS = ["Inspeção periódica", "Inspeção pós-manutenção", "Verificação de pendências"];

function NewInspectionPage() {
  const state = useAppState((s) => s);
  const navigate = useNavigate();
  const [etapa, setEtapa] = useState(1);
  const [siloId, setSiloId] = useState(state.silos[0]?.id ?? "");
  const [tipo, setTipo] = useState(TIPOS[0]!);
  const [responsavel, setResponsavel] = useState(state.settings.responsaveis[0]!);
  const [data, setData] = useState(format(new Date(), "yyyy-MM-dd"));
  const [observacoes, setObservacoes] = useState("");
  const [respostas, setRespostas] = useState<Record<string, InspectionItem>>({});
  const [evidencias, setEvidencias] = useState<{ nome: string; dataUrl: string }[]>([]);

  const itens = useMemo(
    () => state.requirements.filter((r) => r.siloIds.includes(siloId) && r.aplicavel),
    [state.requirements, siloId],
  );

  const respondidos = itens.filter((r) => respostas[r.id]).length;
  const pendentes = itens.filter((r) => respostas[r.id]?.resultado === "pendente");

  const concluir = () => {
    const id = newId("insp");
    const codigo = nextInspectionCode(state.inspections);
    const evidenceIds = evidencias.map((e) =>
      addEvidence({
        nome: e.nome,
        tipo: "foto",
        dataUrl: e.dataUrl,
        siloId,
        inspectionId: id,
        descricao: `Evidência da inspeção ${codigo}.`,
      }),
    );
    const pendenciasGeradas = pendentes.map((r) =>
      createNonconformity({
        titulo: `${r.codigo} pendente na inspeção ${codigo}`,
        descricao: respostas[r.id]?.observacao || r.titulo,
        siloId,
        criticidade: r.criticidade,
        responsavel,
        origem: `Inspeção ${codigo}`,
        requirementId: r.id,
      }),
    );
    saveInspection({
      id,
      codigo,
      data,
      siloId,
      tipo,
      responsavel,
      status: "concluida",
      itens: itens.map(
        (r) =>
          respostas[r.id] ?? { requirementId: r.id, resultado: "nao_aplicavel" as const },
      ),
      observacoes,
      evidencias: evidenceIds,
      pendenciasGeradas,
    });
    toast.success(
      `Inspeção ${codigo} concluída. ${pendenciasGeradas.length} pendência(s) gerada(s).`,
    );
    void navigate({ to: "/app/inspections" });
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Nova inspeção" subtitle={`Etapa ${etapa} de 4`} />

      <ol className="mb-4 flex flex-wrap gap-2 text-xs">
        {["Contexto", "Checklist", "Evidências", "Revisão"].map((label, i) => (
          <li
            key={label}
            className={
              etapa === i + 1
                ? "rounded border border-primary bg-primary/10 px-2 py-1 font-medium text-primary"
                : "rounded border border-border px-2 py-1 text-muted-foreground"
            }
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {etapa === 1 ? (
        <section className="space-y-3 rounded border border-border bg-card p-4">
          <div>
            <Label htmlFor="silo">Silo</Label>
            <Select value={siloId} onValueChange={setSiloId}>
              <SelectTrigger id="silo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.silos.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="tipo">Tipo de inspeção</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger id="tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="resp">Responsável</Label>
            <Select value={responsavel} onValueChange={setResponsavel}>
              <SelectTrigger id="resp">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.settings.responsaveis.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="data">Data</Label>
            <Input id="data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
        </section>
      ) : null}

      {etapa === 2 ? (
        <section className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {respondidos} de {itens.length} itens respondidos.
          </p>
          {itens.map((r) => (
            <div key={r.id} className="rounded border border-border bg-card p-3">
              <p className="text-sm font-medium">
                {r.codigo} — {r.titulo}
              </p>
              <p className="text-xs text-muted-foreground">{r.categoria}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["atendido", "pendente", "nao_aplicavel"] as const).map((op) => (
                  <Button
                    key={op}
                    size="sm"
                    variant={respostas[r.id]?.resultado === op ? "default" : "outline"}
                    onClick={() =>
                      setRespostas((prev) => ({
                        ...prev,
                        [r.id]: {
                          requirementId: r.id,
                          resultado: op,
                          observacao: prev[r.id]?.observacao,
                        },
                      }))
                    }
                  >
                    {op === "atendido" ? "Atendido" : op === "pendente" ? "Pendente" : "N/A"}
                  </Button>
                ))}
              </div>
              {respostas[r.id]?.resultado === "pendente" ? (
                <Textarea
                  className="mt-2"
                  rows={2}
                  placeholder="Descreva a pendência observada"
                  aria-label={`Observação para ${r.codigo}`}
                  value={respostas[r.id]?.observacao ?? ""}
                  onChange={(e) =>
                    setRespostas((prev) => ({
                      ...prev,
                      [r.id]: {
                        requirementId: r.id,
                        resultado: "pendente",
                        observacao: e.target.value,
                      },
                    }))
                  }
                />
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {etapa === 3 ? (
        <section className="space-y-3 rounded border border-border bg-card p-4">
          <Label htmlFor="fotos">Fotos da inspeção</Label>
          <Input
            id="fotos"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              for (const f of files) {
                try {
                  const dataUrl = await fileToDataUrl(f);
                  setEvidencias((prev) => [...prev, { nome: f.name, dataUrl }]);
                } catch {
                  toast.error(`Não foi possível processar ${f.name}.`);
                }
              }
            }}
          />
          <div className="grid grid-cols-3 gap-2">
            {evidencias.map((e) => (
              <img
                key={e.nome}
                src={e.dataUrl}
                alt={e.nome}
                className="h-24 w-full rounded object-cover"
              />
            ))}
          </div>
          <div>
            <Label htmlFor="obs">Observações gerais</Label>
            <Textarea
              id="obs"
              rows={3}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          </div>
        </section>
      ) : null}

      {etapa === 4 ? (
        <section className="space-y-2 rounded border border-border bg-card p-4 text-sm">
          <p>
            <strong>Silo:</strong> {state.silos.find((s) => s.id === siloId)?.nome}
          </p>
          <p>
            <strong>Itens respondidos:</strong> {respondidos} de {itens.length}
          </p>
          <p>
            <strong>Pendências que serão criadas:</strong> {pendentes.length}
          </p>
          <p>
            <strong>Evidências:</strong> {evidencias.length}
          </p>
          <p className="text-muted-foreground">
            Ao concluir, os critérios respondidos terão o status atualizado e as pendências serão
            registradas automaticamente.
          </p>
        </section>
      ) : null}

      <div className="mt-4 flex justify-between gap-2">
        <Button
          variant="ghost"
          disabled={etapa === 1}
          onClick={() => setEtapa((e) => Math.max(1, e - 1))}
        >
          Voltar
        </Button>
        {etapa < 4 ? (
          <Button onClick={() => setEtapa((e) => e + 1)}>Avançar</Button>
        ) : (
          <Button onClick={concluir}>Concluir inspeção</Button>
        )}
      </div>

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}
