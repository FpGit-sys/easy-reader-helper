import { format } from "date-fns";
import { useNavigate } from "@tanstack/react-router";
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

const TYPES = ["Inspeção periódica", "Inspeção pós-manutenção", "Verificação de pendências"];

export function DemoNewInspectionPage() {
  const state = useAppState((s) => s);
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [siloId, setSiloId] = useState(state.silos[0]?.id ?? "");
  const [type, setType] = useState(TYPES[0]!);
  const [responsible, setResponsible] = useState(state.settings.responsaveis[0]!);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [answers, setAnswers] = useState<Record<string, InspectionItem>>({});
  const [evidence, setEvidence] = useState<{ name: string; dataUrl: string }[]>([]);

  const items = useMemo(
    () => state.requirements.filter((requirement) => requirement.siloIds.includes(siloId) && requirement.aplicavel),
    [state.requirements, siloId],
  );

  const answered = items.filter((requirement) => answers[requirement.id]).length;
  const pending = items.filter((requirement) => answers[requirement.id]?.resultado === "pendente");

  const finish = () => {
    const id = newId("insp");
    const code = nextInspectionCode(state.inspections);
    const evidenceIds = evidence.map((item) =>
      addEvidence({
        nome: item.name,
        tipo: "foto",
        dataUrl: item.dataUrl,
        siloId,
        inspectionId: id,
        descricao: `Evidência da inspeção ${code}.`,
      }),
    );
    const generatedFindings = pending.map((requirement) =>
      createNonconformity({
        titulo: `${requirement.codigo} pendente na inspeção ${code}`,
        descricao: answers[requirement.id]?.observacao || requirement.titulo,
        siloId,
        criticidade: requirement.criticidade,
        responsavel: responsible,
        origem: `Inspeção ${code}`,
        requirementId: requirement.id,
      }),
    );
    saveInspection({
      id,
      codigo: code,
      data: date,
      siloId,
      tipo: type,
      responsavel: responsible,
      status: "concluida",
      itens: items.map(
        (requirement) =>
          answers[requirement.id] ?? {
            requirementId: requirement.id,
            resultado: "nao_aplicavel" as const,
          },
      ),
      observacoes: notes,
      evidencias: evidenceIds,
      pendenciasGeradas: generatedFindings,
    });
    toast.success(
      `Inspeção ${code} concluída. ${generatedFindings.length} pendência(s) gerada(s).`,
    );
    void navigate({ to: "/app/inspections" });
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Nova inspeção" subtitle={`Etapa ${step} de 4`} />

      <ol className="mb-4 flex flex-wrap gap-2 text-xs">
        {["Contexto", "Checklist", "Evidências", "Revisão"].map((label, index) => (
          <li
            key={label}
            className={
              step === index + 1
                ? "rounded border border-primary bg-primary/10 px-2 py-1 font-medium text-primary"
                : "rounded border border-border px-2 py-1 text-muted-foreground"
            }
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="space-y-3 rounded border border-border bg-card p-4">
          <div>
            <Label htmlFor="demo-silo">Silo</Label>
            <Select value={siloId} onValueChange={setSiloId}>
              <SelectTrigger id="demo-silo"><SelectValue /></SelectTrigger>
              <SelectContent>
                {state.silos.map((silo) => (
                  <SelectItem key={silo.id} value={silo.id}>{silo.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="demo-type">Tipo de inspeção</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="demo-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="demo-responsible">Responsável</Label>
            <Select value={responsible} onValueChange={setResponsible}>
              <SelectTrigger id="demo-responsible"><SelectValue /></SelectTrigger>
              <SelectContent>
                {state.settings.responsaveis.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="demo-date">Data</Label>
            <Input id="demo-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-2">
          <p className="text-sm text-muted-foreground">{answered} de {items.length} itens respondidos.</p>
          {items.map((requirement) => (
            <div key={requirement.id} className="rounded border border-border bg-card p-3">
              <p className="text-sm font-medium">{requirement.codigo} — {requirement.titulo}</p>
              <p className="text-xs text-muted-foreground">{requirement.categoria}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["atendido", "pendente", "nao_aplicavel"] as const).map((result) => (
                  <Button
                    key={result}
                    size="sm"
                    variant={answers[requirement.id]?.resultado === result ? "default" : "outline"}
                    onClick={() =>
                      setAnswers((current) => ({
                        ...current,
                        [requirement.id]: {
                          requirementId: requirement.id,
                          resultado: result,
                          observacao: current[requirement.id]?.observacao,
                        },
                      }))
                    }
                  >
                    {result === "atendido" ? "Atendido" : result === "pendente" ? "Pendente" : "N/A"}
                  </Button>
                ))}
              </div>
              {answers[requirement.id]?.resultado === "pendente" ? (
                <Textarea
                  className="mt-2"
                  rows={2}
                  placeholder="Descreva a pendência observada"
                  aria-label={`Observação para ${requirement.codigo}`}
                  value={answers[requirement.id]?.observacao ?? ""}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [requirement.id]: {
                        requirementId: requirement.id,
                        resultado: "pendente",
                        observacao: event.target.value,
                      },
                    }))
                  }
                />
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-3 rounded border border-border bg-card p-4">
          <Label htmlFor="demo-photos">Fotos da inspeção</Label>
          <Input
            id="demo-photos"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={async (event) => {
              const files = [...(event.target.files ?? [])];
              for (const file of files) {
                try {
                  const dataUrl = await fileToDataUrl(file);
                  setEvidence((current) => [...current, { name: file.name, dataUrl }]);
                } catch {
                  toast.error(`Não foi possível processar ${file.name}.`);
                }
              }
            }}
          />
          <div className="grid grid-cols-3 gap-2">
            {evidence.map((item) => (
              <img
                key={item.name}
                src={item.dataUrl}
                alt={item.name}
                className="h-24 w-full rounded object-cover"
              />
            ))}
          </div>
          <div>
            <Label htmlFor="demo-notes">Observações gerais</Label>
            <Textarea
              id="demo-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-2 rounded border border-border bg-card p-4 text-sm">
          <p><strong>Silo:</strong> {state.silos.find((silo) => silo.id === siloId)?.nome}</p>
          <p><strong>Itens respondidos:</strong> {answered} de {items.length}</p>
          <p><strong>Pendências que serão criadas:</strong> {pending.length}</p>
          <p><strong>Evidências:</strong> {evidence.length}</p>
          <p className="text-muted-foreground">
            Ao concluir, os critérios respondidos terão o status atualizado e as pendências serão registradas automaticamente.
          </p>
        </section>
      ) : null}

      <div className="mt-4 flex justify-between gap-2">
        <Button variant="ghost" disabled={step === 1} onClick={() => setStep((value) => Math.max(1, value - 1))}>
          Voltar
        </Button>
        {step < 4 ? (
          <Button onClick={() => setStep((value) => value + 1)}>Avançar</Button>
        ) : (
          <Button onClick={finish}>Concluir inspeção</Button>
        )}
      </div>

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}
