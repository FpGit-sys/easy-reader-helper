import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Disclaimer, EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { DISCLAIMER, fmtDate } from "@/lib/formatting";
import { addEvidence, fileToDataUrl } from "@/lib/storage/mutations";
import { useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/evidence")({
  component: EvidencePage,
  head: () => ({
    meta: [
      { title: "Evidências — SiloNR" },
      {
        name: "description",
        content: "Galeria de fotos e registros vinculados a silos, requisitos e inspeções.",
      },
      { property: "og:title", content: "Evidências — SiloNR" },
      { property: "og:description", content: "Registros comprobatórios do ambiente demonstrativo." },
    ],
  }),
});

function EvidencePage() {
  const state = useAppState((s) => s);
  const [silo, setSilo] = useState("todos");
  const [tipo, setTipo] = useState("todos");
  const [descricao, setDescricao] = useState("");
  const [siloUpload, setSiloUpload] = useState("nenhum");

  const lista = useMemo(
    () =>
      state.evidence.filter((e) => {
        if (silo !== "todos" && e.siloId !== silo) return false;
        if (tipo !== "todos" && e.tipo !== tipo) return false;
        return true;
      }),
    [state.evidence, silo, tipo],
  );

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        const dataUrl = await fileToDataUrl(file);
        addEvidence({
          nome: file.name,
          tipo: file.type.startsWith("image/") ? "foto" : "documento",
          dataUrl,
          descricao,
          siloId: siloUpload === "nenhum" ? null : siloUpload,
        });
      } catch {
        toast.error(`Não foi possível processar ${file.name}.`);
      }
    }
    setDescricao("");
    toast.success("Evidência(s) registrada(s) localmente.");
  }

  return (
    <div>
      <PageHeader
        title="Evidências"
        subtitle="Fotos e registros armazenados apenas neste navegador."
      />

      <div className="mb-5 grid gap-2 rounded border border-border bg-card p-3 sm:grid-cols-3">
        <Input
          placeholder="Descrição da evidência"
          aria-label="Descrição da evidência"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
        <Select value={siloUpload} onValueChange={setSiloUpload}>
          <SelectTrigger aria-label="Silo vinculado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nenhum">Sem vínculo com silo</SelectItem>
            {state.silos.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="file"
          multiple
          accept="image/*,application/pdf"
          aria-label="Arquivos de evidência"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={silo} onValueChange={setSilo}>
          <SelectTrigger className="w-48" aria-label="Filtrar por silo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os silos</SelectItem>
            {state.silos.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="w-44" aria-label="Filtrar por tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="foto">Foto</SelectItem>
            <SelectItem value="documento">Documento</SelectItem>
            <SelectItem value="registro">Registro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {lista.length === 0 ? (
        <EmptyState
          title="Nenhuma evidência"
          description="Envie fotos ou documentos para compor o dossiê de prontidão."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {lista.map((e) => (
            <li key={e.id} className="overflow-hidden rounded border border-border bg-card">
              {e.dataUrl && e.tipo === "foto" ? (
                <img
                  src={e.dataUrl}
                  alt={e.descricao || e.nome}
                  loading="lazy"
                  className="h-36 w-full object-cover"
                />
              ) : (
                <div className="flex h-36 items-center justify-center bg-muted text-xs text-muted-foreground">
                  Sem pré-visualização
                </div>
              )}
              <div className="space-y-1 p-3">
                <p className="truncate text-sm font-medium">{e.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtDate(e.data)} · {e.responsavel}
                </p>
                <p className="text-xs text-muted-foreground">
                  {state.silos.find((s) => s.id === e.siloId)?.nome ?? "Sem silo vinculado"}
                </p>
                {e.descricao ? <p className="text-xs">{e.descricao}</p> : null}
                {e.dataUrl ? (
                  <Button asChild size="sm" variant="outline" className="mt-1 h-7 text-xs">
                    <a href={e.dataUrl} download={e.nome}>
                      Baixar
                    </a>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}
