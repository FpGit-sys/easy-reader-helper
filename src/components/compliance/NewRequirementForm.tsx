import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addRequirement } from "@/lib/storage/mutations";
import type { Criticidade, SourceType } from "@/types";

export const CATEGORIAS = [
  "Documentação",
  "Registros",
  "Inspeções",
  "Treinamentos",
  "Emergência",
  "Equipamentos",
  "Manutenção",
  "Acesso",
  "Sinalização",
  "Evidências",
  "Procedimentos internos",
  "Ações corretivas",
];

const baseSchema = z.object({
  titulo: z.string().min(5, "Informe um título com pelo menos 5 caracteres."),
  descricao: z.string().min(10, "Descreva o critério com pelo menos 10 caracteres."),
  categoria: z.string().min(1, "Selecione uma categoria."),
  criticidade: z.enum(["baixa", "media", "alta"]),
  aplicavel: z.boolean(),
  evidenciaObrigatoria: z.boolean(),
  responsavel: z.string().min(2, "Informe o responsável."),
  periodicidadeDias: z.number().int().positive().optional(),
  fonteTipo: z.enum(["interno", "externa_nao_verificada", "externa_verificada"]),
  fonteNome: z.string().optional(),
  fonteOrgao: z.string().optional(),
  fonteVersao: z.string().optional(),
  fonteReferencia: z.string().optional(),
  fonteURL: z.string().optional(),
  fonteConsultadaEm: z.string().optional(),
  verificadoPor: z.string().optional(),
  verificadoEm: z.string().optional(),
});

/** 32. Uma fonte só pode ser marcada como verificada com todos os campos preenchidos. */
export const requirementSchema = baseSchema.superRefine((v, ctx) => {
  if (v.fonteTipo !== "externa_verificada") return;
  const obrigatorios: [keyof typeof v, string][] = [
    ["fonteNome", "Nome da fonte"],
    ["fonteOrgao", "Órgão emissor"],
    ["fonteVersao", "Versão"],
    ["fonteReferencia", "Item"],
    ["fonteURL", "URL oficial"],
    ["fonteConsultadaEm", "Data da consulta"],
    ["verificadoPor", "Validado por"],
    ["verificadoEm", "Data da validação"],
  ];
  for (const [campo, label] of obrigatorios) {
    if (!String(v[campo] ?? "").trim()) {
      ctx.addIssue({
        code: "custom",
        path: [campo as string],
        message: `${label} é obrigatório para fonte verificada.`,
      });
    }
  }
  if (v.fonteURL && !/^https?:\/\//i.test(v.fonteURL)) {
    ctx.addIssue({ code: "custom", path: ["fonteURL"], message: "Informe uma URL oficial válida." });
  }
});

const empty = {
  titulo: "",
  descricao: "",
  categoria: CATEGORIAS[0] as string,
  criticidade: "media" as Criticidade,
  aplicavel: true,
  evidenciaObrigatoria: false,
  responsavel: "",
  periodicidade: "",
  fonteTipo: "interno" as SourceType,
  fonteNome: "",
  fonteOrgao: "",
  fonteVersao: "",
  fonteReferencia: "",
  fonteURL: "",
  fonteConsultadaEm: "",
  verificadoPor: "",
  verificadoEm: "",
};

export function NewRequirementForm({ responsaveis }: { responsaveis: string[] }) {
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof typeof empty>(key: K, value: (typeof empty)[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = requirementSchema.safeParse({
      ...f,
      periodicidadeDias: f.periodicidade ? Number(f.periodicidade) : undefined,
    });
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const issue of parsed.error.issues) map[String(issue.path[0])] = issue.message;
      setErrors(map);
      toast.error("Verifique os campos destacados.");
      return;
    }
    setErrors({});
    const v = parsed.data;
    addRequirement({
      titulo: v.titulo,
      descricao: v.descricao,
      categoria: v.categoria,
      aplicavel: v.aplicavel,
      criticidade: v.criticidade,
      status: v.aplicavel ? "pendente" : "nao_aplicavel",
      responsavel: v.responsavel,
      prazo: null,
      siloIds: [],
      evidenciaObrigatoria: v.evidenciaObrigatoria,
      fonteTipo: v.fonteTipo,
      fonteNome:
        v.fonteNome?.trim() ||
        (v.fonteTipo === "interno" ? "Critério interno da organização" : "Fonte não informada"),
      fonteOrgao: v.fonteOrgao || undefined,
      fonteVersao: v.fonteVersao || undefined,
      fonteReferencia: v.fonteReferencia || undefined,
      fonteURL: v.fonteURL || undefined,
      fonteConsultadaEm: v.fonteConsultadaEm || undefined,
      fonteVerificada: v.fonteTipo === "externa_verificada",
      verificadoPor: v.verificadoPor || undefined,
      verificadoEm: v.verificadoEm || undefined,
    });
    toast.success("Critério interno cadastrado.");
    setF(empty);
  }

  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="text-xs text-destructive">
        {errors[k]}
      </p>
    ) : null;

  const inputClass = "h-9 w-full rounded border border-input bg-background px-3 text-sm";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="req-titulo">Título</Label>
          <Input id="req-titulo" value={f.titulo} onChange={(e) => set("titulo", e.target.value)} />
          {err("titulo")}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="req-desc">Descrição</Label>
          <Textarea
            id="req-desc"
            rows={3}
            value={f.descricao}
            onChange={(e) => set("descricao", e.target.value)}
          />
          {err("descricao")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="req-cat">Categoria</Label>
          <select
            id="req-cat"
            className={inputClass}
            value={f.categoria}
            onChange={(e) => set("categoria", e.target.value)}
          >
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="req-crit">Criticidade</Label>
          <select
            id="req-crit"
            className={inputClass}
            value={f.criticidade}
            onChange={(e) => set("criticidade", e.target.value as Criticidade)}
          >
            <option value="baixa">Baixa</option>
            <option value="media">Média</option>
            <option value="alta">Alta</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="req-resp">Responsável</Label>
          <Input
            id="req-resp"
            list="req-resp-list"
            value={f.responsavel}
            onChange={(e) => set("responsavel", e.target.value)}
          />
          <datalist id="req-resp-list">
            {responsaveis.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          {err("responsavel")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="req-per">Periodicidade interna (dias, opcional)</Label>
          <Input
            id="req-per"
            type="number"
            min={1}
            value={f.periodicidade}
            onChange={(e) => set("periodicidade", e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.aplicavel}
            onChange={(e) => set("aplicavel", e.target.checked)}
          />
          Aplicável a esta unidade
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.evidenciaObrigatoria}
            onChange={(e) => set("evidenciaObrigatoria", e.target.checked)}
          />
          Evidência obrigatória
        </label>
      </div>

      <fieldset className="space-y-3 rounded border border-border p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Fonte
        </legend>
        <div className="space-y-1.5">
          <Label htmlFor="req-fonte">Tipo da fonte</Label>
          <select
            id="req-fonte"
            className={inputClass}
            value={f.fonteTipo}
            onChange={(e) => set("fonteTipo", e.target.value as SourceType)}
          >
            <option value="interno">Critério interno</option>
            <option value="externa_nao_verificada">Norma externa ainda não verificada</option>
            <option value="externa_verificada">Norma externa verificada</option>
          </select>
        </div>

        {f.fonteTipo === "externa_verificada" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["fonteNome", "Nome da fonte", "text"],
                ["fonteOrgao", "Órgão emissor", "text"],
                ["fonteVersao", "Versão", "text"],
                ["fonteReferencia", "Item", "text"],
                ["fonteURL", "URL oficial", "url"],
                ["fonteConsultadaEm", "Data da consulta", "date"],
                ["verificadoPor", "Validado por", "text"],
                ["verificadoEm", "Data da validação", "date"],
              ] as const
            ).map(([key, label, type]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`req-${key}`}>{label}</Label>
                <Input
                  id={`req-${key}`}
                  type={type}
                  value={f[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
                {err(key)}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Critérios internos e normas ainda não verificadas são exibidos com a marcação “Fonte não
            validada”. Nenhum critério pode ser registrado como norma verificada sem nome, órgão,
            versão, item, URL oficial, data de consulta e responsável pela validação.
          </p>
        )}
      </fieldset>

      <Button type="submit">Cadastrar critério</Button>
    </form>
  );
}
