import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Disclaimer, PageHeader } from "@/components/layout/PageHeader";
import { DISCLAIMER } from "@/lib/formatting";
import { getState, resetDemo, setState, useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Configurações — SiloNR" },
      {
        name: "description",
        content: "Dados da unidade, responsáveis, janela de vencimento e reinício da demonstração.",
      },
      { property: "og:title", content: "Configurações — SiloNR" },
      { property: "og:description", content: "Parâmetros internos do ambiente demonstrativo." },
    ],
  }),
});

function SettingsPage() {
  const settings = useAppState((s) => s.settings);
  const [form, setForm] = useState(settings);
  const [novoResp, setNovoResp] = useState("");

  function save() {
    setState((s) => ({ ...s, settings: { ...s.settings, ...form } }));
    toast.success("Configurações salvas.");
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "silonr-dados.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Configurações"
        subtitle="Parâmetros da unidade e manutenção do ambiente demonstrativo."
      />

      <section className="space-y-3 rounded border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Unidade</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="unidade">Nome da unidade</Label>
            <Input
              id="unidade"
              value={form.unidadeNome}
              onChange={(e) => setForm((f) => ({ ...f, unidadeNome: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="local">Localidade</Label>
            <Input
              id="local"
              value={form.unidadeLocal}
              onChange={(e) => setForm((f) => ({ ...f, unidadeLocal: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="janela">Janela de alerta de vencimento (dias)</Label>
            <Input
              id="janela"
              type="number"
              min={1}
              value={form.janelaVencimentoDias}
              onChange={(e) =>
                setForm((f) => ({ ...f, janelaVencimentoDias: Number(e.target.value) || 1 }))
              }
            />
          </div>
        </div>
        <Button onClick={save}>Salvar configurações</Button>
      </section>

      <section className="mt-5 space-y-3 rounded border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Responsáveis</h2>
        <ul className="flex flex-wrap gap-2">
          {form.responsaveis.map((r) => (
            <li
              key={r}
              className="flex items-center gap-2 rounded border border-border px-2 py-1 text-sm"
            >
              {r}
              <button
                type="button"
                className="text-xs text-destructive"
                onClick={() =>
                  setForm((f) => ({ ...f, responsaveis: f.responsaveis.filter((x) => x !== r) }))
                }
                aria-label={`Remover ${r}`}
              >
                remover
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            value={novoResp}
            onChange={(e) => setNovoResp(e.target.value)}
            placeholder="Nome do responsável"
            aria-label="Novo responsável"
          />
          <Button
            variant="outline"
            onClick={() => {
              const nome = novoResp.trim();
              if (!nome) return;
              setForm((f) => ({ ...f, responsaveis: [...f.responsaveis, nome] }));
              setNovoResp("");
            }}
          >
            Adicionar
          </Button>
        </div>
      </section>

      <section className="mt-5 space-y-3 rounded border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Dados</h2>
        <p className="text-sm text-muted-foreground">
          Todos os dados ficam apenas neste navegador. Nenhuma informação é enviada para servidores.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportJson}>
            Exportar dados (JSON)
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              resetDemo();
              toast.success("Ambiente demonstrativo restaurado.");
            }}
          >
            Restaurar demonstração
          </Button>
        </div>
      </section>

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}
