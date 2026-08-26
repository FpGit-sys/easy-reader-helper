import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FilePlus2, Loader2, Pencil, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace";
import {
  getProductionDocumentDownload,
  listProductionDocuments,
  updateProductionDocumentMetadata,
} from "@/server/operations/documents.functions";
import { listProductionSilos } from "@/server/operations/silos.functions";
import { can, type Role } from "@/server/rbac";

type DocumentRow = Awaited<ReturnType<typeof listProductionDocuments>>[number];

const NO_SILO = "__unit__";
const FILTERS = ["todos", "vencido", "vence_em_breve", "valido", "sem_validade"] as const;

interface FormState {
  name: string;
  category: string;
  siloId: string;
  issuedAt: string;
  expiresAt: string;
}

export function ProductionDocumentsPage() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("todos");
  const [dialog, setDialog] = useState<{ mode: "new" | "edit"; document: DocumentRow | null } | null>(null);

  const documentsQuery = useQuery({
    queryKey: ["production", "documents", workspace?.organizationId, workspace?.facilityId],
    queryFn: () =>
      listProductionDocuments({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
        },
      }),
    enabled: Boolean(workspace),
  });

  const silosQuery = useQuery({
    queryKey: ["production", "silos", workspace?.organizationId, workspace?.facilityId],
    queryFn: () =>
      listProductionSilos({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
        },
      }),
    enabled: Boolean(workspace),
  });

  const canWrite = workspace ? can(workspace.role as Role, "documents.write") : false;
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (documentsQuery.data ?? [])
      .filter((item) => (filter === "todos" ? true : item.status === filter))
      .filter((item) =>
        needle
          ? `${item.name} ${item.category} ${item.originalFilename ?? ""}`.toLowerCase().includes(needle)
          : true,
      );
  }, [documentsQuery.data, filter, search]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["production", "documents"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "dashboard"] }),
    ]);
  };

  const downloadMutation = useMutation({
    mutationFn: (documentId: string) =>
      getProductionDocumentDownload({
        data: {
          organizationId: workspace!.organizationId,
          facilityId: workspace!.facilityId,
          documentId,
        },
      }),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
    onError: () => toast.error("Não foi possível liberar o download deste arquivo."),
  });

  if (workspaceState.loading) return <Loading text="Carregando sua unidade…" />;
  if (workspaceState.error) {
    return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  }
  if (!workspace) {
    return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e uma unidade para continuar." />;
  }

  return (
    <div>
      <PageHeader
        title="Documentos"
        subtitle={`${workspace.facilityName} · arquivos privados e versionados`}
        actions={
          canWrite ? (
            <Button onClick={() => setDialog({ mode: "new", document: null })}>
              <FilePlus2 className="size-4" aria-hidden="true" />
              Adicionar documento
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar documento"
            className="pl-8"
          />
        </div>
        {FILTERS.map((item) => (
          <Button
            key={item}
            size="sm"
            variant={filter === item ? "default" : "outline"}
            onClick={() => setFilter(item)}
          >
            {filterLabel(item)}
          </Button>
        ))}
      </div>

      {documentsQuery.isLoading ? (
        <Loading text="Carregando documentos…" />
      ) : documentsQuery.error ? (
        <EmptyState
          title="Não foi possível carregar os documentos"
          description="Verifique a conexão e as permissões da sua conta."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhum documento encontrado"
          description={
            documentsQuery.data?.length
              ? "Ajuste os filtros ou a busca."
              : "Cadastre o primeiro documento da unidade para começar o controle de validade e versões."
          }
          action={
            canWrite ? (
              <Button onClick={() => setDialog({ mode: "new", document: null })}>
                Adicionar documento
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-card">
          <table className="w-full table-dense">
            <thead className="bg-muted/70 text-left">
              <tr>
                <Th>Documento</Th>
                <Th>Categoria</Th>
                <Th>Silo</Th>
                <Th>Validade</Th>
                <Th>Status</Th>
                <Th>Versão</Th>
                <Th>Integridade</Th>
                <Th>Arquivo</Th>
                <Th>Ações</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const silo = silosQuery.data?.find((item) => item.id === row.siloId);
                return (
                  <tr key={row.id} className="border-t border-border hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Atualizado {formatDateTime(row.updatedAt)}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-sm">{row.category}</td>
                    <td className="px-3 py-2 text-sm">{silo?.name ?? "Unidade"}</td>
                    <td className="px-3 py-2 text-sm">{formatDate(row.expiresAt)}</td>
                    <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                    <td className="px-3 py-2 text-sm">{row.version ? `v${row.version}` : "—"}</td>
                    <td className="px-3 py-2">
                      {row.sha256 ? (
                        <span
                          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
                          title={row.sha256}
                        >
                          <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
                          {row.sha256.slice(0, 12)}…
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem arquivo ativo</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.originalFilename ? (
                        <>
                          <span className="block max-w-48 truncate" title={row.originalFilename}>
                            {row.originalFilename}
                          </span>
                          <span>{row.sizeBytes ? formatBytes(row.sizeBytes) : ""}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {row.versionId ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Baixar ${row.name}`}
                            disabled={downloadMutation.isPending}
                            onClick={() => downloadMutation.mutate(row.id)}
                          >
                            <Download className="size-4" aria-hidden="true" />
                          </Button>
                        ) : null}
                        {canWrite ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Editar ${row.name}`}
                            onClick={() => setDialog({ mode: "edit", document: row })}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 rounded border border-info/30 bg-info/10 p-3 text-xs leading-relaxed text-muted-foreground">
        Arquivos são armazenados de forma privada. Cada nova versão recebe SHA-256 e histórico de upload. A validade exibida é um controle interno e deve ser configurada conforme o documento e os critérios definidos pelos responsáveis da unidade.
      </p>

      {dialog ? (
        <DocumentDialog
          key={`${dialog.mode}-${dialog.document?.id ?? "new"}`}
          open
          mode={dialog.mode}
          document={dialog.document}
          silos={silosQuery.data ?? []}
          workspace={workspace}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}

function DocumentDialog({
  open,
  mode,
  document,
  silos,
  workspace,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "new" | "edit";
  document: DocumentRow | null;
  silos: Awaited<ReturnType<typeof listProductionSilos>>;
  workspace: NonNullable<ReturnType<typeof useWorkspace>["workspace"]>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(() => ({
    name: document?.name ?? "",
    category: document?.category ?? "Documentação",
    siloId: document?.siloId ?? NO_SILO,
    issuedAt: dateInputValue(document?.issuedAt ?? null),
    expiresAt: dateInputValue(document?.expiresAt ?? null),
  }));
  const [replaceFile, setReplaceFile] = useState(mode === "new");

  const mutation = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0] ?? null;
      if (replaceFile || mode === "new") {
        if (!file) throw new Error("FILE_REQUIRED");
        const payload = new FormData();
        payload.set("organizationId", workspace.organizationId);
        payload.set("facilityId", workspace.facilityId);
        if (document?.id) payload.set("documentId", document.id);
        if (form.siloId !== NO_SILO) payload.set("siloId", form.siloId);
        payload.set("name", form.name.trim());
        payload.set("category", form.category.trim());
        const issuedAt = dateToIso(form.issuedAt);
        const expiresAt = dateToIso(form.expiresAt);
        if (issuedAt) payload.set("issuedAt", issuedAt);
        if (expiresAt) payload.set("expiresAt", expiresAt);
        payload.set("file", file);

        const response = await fetch("/api/documents/upload", {
          method: "POST",
          body: payload,
          credentials: "same-origin",
        });
        if (!response.ok) {
          const error = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(error?.error ?? "UPLOAD_FAILED");
        }
        return;
      }

      if (!document) throw new Error("DOCUMENT_REQUIRED");
      await updateProductionDocumentMetadata({
        data: {
          organizationId: workspace.organizationId,
          facilityId: workspace.facilityId,
          documentId: document.id,
          name: form.name.trim(),
          category: form.category.trim(),
          siloId: form.siloId === NO_SILO ? null : form.siloId,
          issuedAt: dateToIso(form.issuedAt),
          expiresAt: dateToIso(form.expiresAt),
        },
      });
    },
    onSuccess: async () => {
      await onSaved();
      toast.success(mode === "new" ? "Documento cadastrado com segurança." : "Documento atualizado.");
      onClose();
    },
    onError: (error) => {
      const code = error instanceof Error ? error.message : "";
      const message =
        code === "FILE_REQUIRED"
          ? "Selecione um arquivo PDF ou imagem."
          : code === "FILE_SIZE_NOT_ALLOWED"
            ? "O arquivo ultrapassa o limite permitido."
            : code === "FILE_TYPE_NOT_ALLOWED"
              ? "Formato de arquivo não permitido."
              : code === "OBJECT_STORAGE_NOT_CONFIGURED"
                ? "O armazenamento privado ainda não está configurado no servidor."
                : "Não foi possível salvar o documento.";
      toast.error(message);
    },
  });

  const valid = form.name.trim().length > 0 && form.category.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "new" ? "Adicionar documento" : "Editar documento"}</DialogTitle>
          <DialogDescription>
            {mode === "new"
              ? "O arquivo será validado, armazenado de forma privada e registrado com hash SHA-256."
              : "Alterações de metadados e novas versões ficam registradas na trilha de auditoria."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" className="sm:col-span-2">
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Categoria">
            <Input
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              placeholder="Ex.: Manutenção"
            />
          </Field>
          <Field label="Silo">
            <Select value={form.siloId} onValueChange={(value) => setForm({ ...form, siloId: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SILO}>Unidade (sem silo específico)</SelectItem>
                {silos.map((silo) => (
                  <SelectItem key={silo.id} value={silo.id}>{silo.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Emissão">
            <Input type="date" value={form.issuedAt} onChange={(event) => setForm({ ...form, issuedAt: event.target.value })} />
          </Field>
          <Field label="Validade">
            <Input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} />
          </Field>

          {mode === "edit" && document?.originalFilename ? (
            <div className="sm:col-span-2 rounded border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">Arquivo ativo: {document.originalFilename}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Versão {document.version ?? "—"} · {document.sizeBytes ? formatBytes(document.sizeBytes) : ""}
              </p>
              <Button
                type="button"
                size="sm"
                variant={replaceFile ? "default" : "outline"}
                className="mt-3"
                onClick={() => setReplaceFile((value) => !value)}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                {replaceFile ? "Manter versão atual" : "Enviar nova versão"}
              </Button>
            </div>
          ) : null}

          {replaceFile || mode === "new" ? (
            <Field label={mode === "new" ? "Arquivo" : "Nova versão do arquivo"} className="sm:col-span-2">
              <Input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" />
              <span className="block text-xs text-muted-foreground">
                PDF, JPEG, PNG ou WEBP. Limite de 25 MB para documentos.
              </span>
            </Field>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide">{children}</th>;
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex min-h-56 items-center justify-center rounded border border-border bg-card text-sm text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
      {text}
    </div>
  );
}

function filterLabel(filter: (typeof FILTERS)[number]) {
  if (filter === "todos") return "Todos";
  if (filter === "vencido") return "Vencidos";
  if (filter === "vence_em_breve") return "Vencendo";
  if (filter === "valido") return "Válidos";
  return "Sem validade";
}

function dateToIso(value: string) {
  return value ? `${value}T12:00:00.000Z` : null;
}

function dateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
