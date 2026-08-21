import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Disclaimer, EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { TableWrap, Td, Th, Tr } from "@/components/tables/primitives";
import { CATEGORIAS } from "@/data/demo/demoData";
import { documentsWithStatus } from "@/lib/calculations/derive";
import { DISCLAIMER, fmtDate } from "@/lib/formatting";
import { newId, useAppState } from "@/lib/storage/store";
import { deleteDocument, fileToDataUrl, saveDocument } from "@/lib/storage/mutations";
import type { StoredDocument } from "@/types";

export const Route = createFileRoute("/app/documents")({
  component: DocumentsPage,
  head: () => ({
    meta: [
      { title: "Documentos — SiloNR" },
      {
        name: "description",
        content: "Controle demonstrativo de documentos com validade, dias restantes e status.",
      },
      { property: "og:title", content: "Documentos — SiloNR" },
      { property: "og:description", content: "Vencidos, vencendo e válidos em uma única tabela." },
    ],
  }),
});

const SEM_SILO = "__sem_silo__";

function DocumentsPage() {
  const state = useAppState((s) => s);
  const docs = documentsWithStatus(state);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [edit, setEdit] = useState<StoredDocument | null>(null);
  const [isNew, setIsNew] = useState(false);

  const linhas = docs
    .filter((d) => (filtro === "todos" ? true : d.status === filtro))
    .filter((d) => d.nome.toLowerCase().includes(busca.toLowerCase()));

  const novo = () => {
    setIsNew(true);
    setEdit({
      id: newId("doc"),
      nome: "",
      categoria: CATEGORIAS[0]!,
      siloId: null,
      responsavel: state.settings.responsaveis[0]!,
      emissao: new Date().toISOString().slice(0, 10),
      validade: null,
      observacao: "",
    });
  };

  return (
    <div>
      <PageHeader
        title="Documentos"
        subtitle={`Janela de aviso configurada: ${state.settings.janelaVencimentoDias} dias.`}
        actions={<Button onClick={novo}>Adicionar documento</Button>}
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar documento"
          aria-label="Buscar documento"
          className="w-56"
        />
        {["todos", "vencido", "vence_em_breve", "valido", "sem_validade"].map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filtro === f ? "default" : "outline"}
            onClick={() => setFiltro(f)}
          >
            {f === "todos"
              ? "Todos"
              : f === "vencido"
                ? "Vencidos"
                : f === "vence_em_breve"
                  ? "Vencendo"
                  : f === "valido"
                    ? "Válidos"
                    : "Sem validade"}
          </Button>
        ))}
      </div>

      {linhas.length === 0 ? (
        <EmptyState
          title="Nenhum documento encontrado"
          description="Cadastre um documento ou ajuste os filtros aplicados."
          action={<Button onClick={novo}>Adicionar documento</Button>}
        />
      ) : (
        <TableWrap>
          <thead className="bg-muted/70">
            <tr>
              <Th>Documento</Th>
              <Th>Categoria</Th>
              <Th>Silo</Th>
              <Th>Responsável</Th>
              <Th>Emissão</Th>
              <Th>Validade</Th>
              <Th>Dias restantes</Th>
              <Th>Status</Th>
              <Th>Arquivo</Th>
              <Th>Ações</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((d) => (
              <Tr key={d.id}>
                <Td className="font-medium">{d.nome}</Td>
                <Td>{d.categoria}</Td>
                <Td>{state.silos.find((s) => s.id === d.siloId)?.nome ?? "Unidade"}</Td>
                <Td>{d.responsavel}</Td>
                <Td>{fmtDate(d.emissao)}</Td>
                <Td>{fmtDate(d.validade)}</Td>
                <Td>{d.diasRestantes ?? "—"}</Td>
                <Td>
                  <StatusBadge status={d.status} />
                </Td>
                <Td>
                  {d.arquivoDataUrl ? (
                    <a
                      href={d.arquivoDataUrl}
                      download={d.arquivoNome}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {d.arquivoNome}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Sem anexo</span>
                  )}
                </Td>
                <Td>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsNew(false);
                        setEdit(state.documents.find((x) => x.id === d.id) ?? null);
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        deleteDocument(d.id);
                        toast.success("Documento excluído.");
                      }}
                    >
                      Excluir
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <Disclaimer text={DISCLAIMER} />

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "Adicionar documento" : "Editar documento"}</DialogTitle>
            <DialogDescription>
              Os arquivos permanecem apenas neste navegador (ambiente demonstrativo).
            </DialogDescription>
          </DialogHeader>
          {edit ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!edit.nome.trim()) {
                  toast.error("Informe o nome do documento.");
                  return;
                }
                saveDocument(edit, isNew);
                toast.success(isNew ? "Documento cadastrado." : "Documento atualizado.");
                setEdit(null);
              }}
            >
              <div>
                <Label htmlFor="nome">Nome</Label>
                <Input
                  id="nome"
                  value={edit.nome}
                  onChange={(e) => setEdit({ ...edit, nome: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="categoria">Categoria</Label>
                  <Select
                    value={edit.categoria}
                    onValueChange={(v) => setEdit({ ...edit, categoria: v })}
                  >
                    <SelectTrigger id="categoria">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIAS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="silo">Silo</Label>
                  <Select
                    value={edit.siloId ?? SEM_SILO}
                    onValueChange={(v) => setEdit({ ...edit, siloId: v === SEM_SILO ? null : v })}
                  >
                    <SelectTrigger id="silo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_SILO}>Unidade (sem silo)</SelectItem>
                      {state.silos.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="emissao">Emissão</Label>
                  <Input
                    id="emissao"
                    type="date"
                    value={edit.emissao}
                    onChange={(e) => setEdit({ ...edit, emissao: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="validade">Validade</Label>
                  <Input
                    id="validade"
                    type="date"
                    value={edit.validade ?? ""}
                    onChange={(e) => setEdit({ ...edit, validade: e.target.value || null })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="responsavel">Responsável</Label>
                  <Select
                    value={edit.responsavel}
                    onValueChange={(v) => setEdit({ ...edit, responsavel: v })}
                  >
                    <SelectTrigger id="responsavel">
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
              </div>
              <div>
                <Label htmlFor="arquivo">Anexar arquivo local</Label>
                <Input
                  id="arquivo"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const dataUrl = await fileToDataUrl(file);
                      setEdit({ ...edit, arquivoNome: file.name, arquivoDataUrl: dataUrl });
                      toast.success("Arquivo anexado localmente.");
                    } catch {
                      toast.error("Arquivo inválido. Nenhuma alteração foi feita.");
                    }
                  }}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setEdit(null)}>
                  Cancelar
                </Button>
                <Button type="submit">Salvar</Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
