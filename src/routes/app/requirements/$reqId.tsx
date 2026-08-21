import { Link, createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Disclaimer, EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { requirementPriority } from "@/lib/calculations/derive";
import { DISCLAIMER, fmtDate, fmtDateTime } from "@/lib/formatting";
import { useAppState } from "@/lib/storage/store";
import {
  addComment,
  addEvidence,
  createAction,
  createNonconformity,
  fileToDataUrl,
  updateRequirement,
} from "@/lib/storage/mutations";

export const Route = createFileRoute("/app/requirements/$reqId")({
  component: RequirementDetailPage,
  head: () => ({
    meta: [
      { title: "Detalhe do requisito — SiloNR" },
      {
        name: "description",
        content: "Critério interno demonstrativo com evidências, responsável, prazo e histórico.",
      },
      { property: "og:title", content: "Detalhe do requisito — SiloNR" },
      { property: "og:description", content: "Evidências, ações e histórico do critério interno." },
    ],
  }),
});

function RequirementDetailPage() {
  const { reqId } = Route.useParams();
  const state = useAppState((s) => s);
  const req = state.requirements.find((r) => r.id === reqId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [comentario, setComentario] = useState("");

  if (!req) {
    return (
      <EmptyState
        title="Requisito não encontrado"
        description="O critério solicitado não existe neste ambiente demonstrativo."
      />
    );
  }

  const prioridade = requirementPriority(state, req.id);
  const evidencias = state.evidence.filter((e) => req.evidencias.includes(e.id));

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      addEvidence({
        nome: file.name,
        tipo: file.type.startsWith("image/") ? "foto" : "documento",
        dataUrl,
        requirementId: req.id,
        siloId: req.siloIds[0] ?? null,
        descricao: `Evidência anexada ao ${req.codigo}.`,
      });
      toast.success("Evidência adicionada ao critério.");
    } catch {
      toast.error("Não foi possível processar este arquivo.");
    }
  };

  return (
    <div>
      <PageHeader
        title={`${req.codigo} — ${req.titulo}`}
        subtitle={req.categoria}
        actions={
          <>
            <StatusBadge status={req.status} />
            <StatusBadge status={req.criticidade} label={`Criticidade ${req.criticidade}`} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="rounded border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Descrição</h2>
            <p className="mt-2 text-sm text-muted-foreground">{req.descricao}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Field label="Responsável" value={req.responsavel} />
              <Field label="Prazo interno" value={fmtDate(req.prazo)} />
              <Field
                label="Silos relacionados"
                value={req.siloIds
                  .map((id) => state.silos.find((s) => s.id === id)?.nome ?? id)
                  .join(", ")}
              />
              <Field
                label="Evidência obrigatória"
                value={req.evidenciaObrigatoria ? "Sim" : "Não"}
              />
            </dl>
          </section>

          <section className="rounded border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Evidências</h2>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                Adicionar evidência
              </Button>
            </div>
            {evidencias.length === 0 ? (
              <p className="mt-3 rounded border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Nenhuma evidência cadastrada. Adicione uma foto, documento ou registro relacionado a
                este item.
              </p>
            ) : (
              <ul className="mt-3 grid gap-3 sm:grid-cols-3">
                {evidencias.map((e) => (
                  <li key={e.id} className="rounded border border-border p-2">
                    {e.dataUrl && e.tipo === "foto" ? (
                      <img src={e.dataUrl} alt={e.nome} className="mb-2 h-28 w-full rounded object-cover" />
                    ) : null}
                    <p className="truncate text-sm">{e.nome}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(e.data)}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              O sistema registra o arquivo enviado; não atesta autenticidade ou validade jurídica da
              imagem.
            </p>
          </section>

          <section className="rounded border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Comentários</h2>
            <ul className="mt-2 space-y-2">
              {req.comentarios.map((c) => (
                <li key={c.id} className="rounded bg-muted/60 p-2 text-sm">
                  <p>{c.texto}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.autor} · {fmtDateTime(c.data)}
                  </p>
                </li>
              ))}
              {req.comentarios.length === 0 ? (
                <li className="text-sm text-muted-foreground">Nenhum comentário registrado.</li>
              ) : null}
            </ul>
            <div className="mt-3 flex gap-2">
              <Textarea
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder="Escrever comentário interno"
                aria-label="Novo comentário"
                rows={2}
              />
              <Button
                onClick={() => {
                  if (!comentario.trim()) return;
                  addComment(req.id, comentario.trim());
                  setComentario("");
                  toast.success("Comentário registrado.");
                }}
              >
                Enviar
              </Button>
            </div>
          </section>

          <section className="rounded border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Histórico</h2>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {req.historico.map((h) => (
                <li key={h.id}>
                  {fmtDate(h.data)} — {h.texto}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Fonte</h2>
            <p className="mt-2 text-sm">{req.fonteNome}</p>
            <p className="text-xs text-muted-foreground">{req.fonteReferencia}</p>
            {!req.fonteVerificada ? (
              <p className="mt-2 rounded border border-warning/40 bg-warning/15 p-2 text-xs">
                Fonte não validada. Critério interno demonstrativo — não constitui requisito legal.
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Validado por {req.verificadoPor} em {fmtDate(req.verificadoEm)}.
              </p>
            )}
          </section>

          {prioridade ? (
            <section className="rounded border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Prioridade sugerida</h2>
              <p className="mt-1 text-xl font-semibold uppercase">{prioridade.prioridade}</p>
              <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">
                {prioridade.motivos.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Regra determinística, sem uso de IA. Pontuação: {prioridade.pontos}.
              </p>
            </section>
          ) : null}

          <section className="space-y-2 rounded border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Ações</h2>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => {
                createNonconformity({
                  titulo: `Pendência sobre ${req.codigo} — ${req.titulo}`,
                  siloId: req.siloIds[0] ?? null,
                  criticidade: req.criticidade,
                  responsavel: req.responsavel,
                  origem: "Matriz de requisitos",
                  requirementId: req.id,
                });
                toast.success("Pendência criada.");
              }}
            >
              Criar pendência
            </Button>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => {
                createAction({
                  titulo: `Tratar ${req.codigo}`,
                  siloId: req.siloIds[0] ?? null,
                  responsavel: req.responsavel,
                  prazo: req.prazo,
                  prioridade: req.criticidade,
                });
                toast.success("Ação corretiva criada.");
              }}
            >
              Criar ação corretiva
            </Button>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="responsavel">
                Alterar responsável
              </label>
              <Select
                value={req.responsavel}
                onValueChange={(v) => {
                  updateRequirement(req.id, { responsavel: v }, `Responsável alterado para ${v}.`);
                  toast.success("Responsável atualizado.");
                }}
              >
                <SelectTrigger id="responsavel" className="mt-1">
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
              <label className="text-xs text-muted-foreground" htmlFor="prazo">
                Prazo interno
              </label>
              <Input
                id="prazo"
                type="date"
                className="mt-1"
                value={req.prazo ?? ""}
                onChange={(e) =>
                  updateRequirement(
                    req.id,
                    { prazo: e.target.value || null },
                    "Prazo interno alterado.",
                  )
                }
              />
            </div>
            <Button
              className="w-full"
              disabled={req.status === "atendido"}
              onClick={() => {
                if (req.evidenciaObrigatoria && req.evidencias.length === 0) {
                  toast.warning("Evidência obrigatória ausente. Anexe uma evidência antes.");
                  return;
                }
                updateRequirement(req.id, { status: "atendido" }, "Item marcado como atendido.");
                toast.success("Item marcado como atendido.");
              }}
            >
              Marcar como atendido
            </Button>
            <Button
              className="w-full"
              variant="ghost"
              onClick={() => {
                updateRequirement(
                  req.id,
                  { aplicavel: !req.aplicavel, status: req.aplicavel ? "nao_aplicavel" : "pendente" },
                  req.aplicavel ? "Item marcado como não aplicável." : "Item reativado.",
                );
              }}
            >
              {req.aplicavel ? "Marcar como não aplicável" : "Tornar aplicável"}
            </Button>
            <Button asChild className="w-full" variant="ghost">
              <Link to="/app/requirements">Voltar à matriz</Link>
            </Button>
          </section>
        </aside>
      </div>

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
