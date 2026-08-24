import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { NewRequirementForm } from "@/components/compliance/NewRequirementForm";
import { Disclaimer, PageHeader } from "@/components/layout/PageHeader";
import { ProductionAdministrationPage } from "@/components/production/ProductionAdministrationPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DISCLAIMER } from "@/lib/formatting";
import { DEMO_MODE_ENABLED } from "@/lib/runtime-mode";
import { getState, resetDemo, setState, useAppState } from "@/lib/storage/store";

export const Route = createFileRoute("/app/settings")({
  component: SettingsRoute,
  head: () => ({
    meta: [
      { title: "Administração — SiloNR" },
      {
        name: "description",
        content: "Administração da empresa, unidades, usuários, perfis, licença e segurança da conta.",
      },
      { property: "og:title", content: "Administração — SiloNR" },
      { property: "og:description", content: "Configuração segura do ambiente SiloNR." },
    ],
  }),
});

function SettingsRoute() {
  return DEMO_MODE_ENABLED ? <DemoSettingsPage /> : <ProductionAdministrationPage />;
}

function DemoSettingsPage() {
  const settings = useAppState((state) => state.settings);
  const [form, setForm] = useState(settings);
  const [novoResp, setNovoResp] = useState("");

  function save() {
    setState((state) => ({ ...state, settings: { ...state.settings, ...form } }));
    toast.success("Configurações salvas.");
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "silonr-dados.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Configurações" subtitle="Parâmetros da unidade e manutenção do ambiente demonstrativo." />

      <section className="space-y-3 rounded border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Unidade</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="unidade">Nome da unidade</Label><Input id="unidade" value={form.unidadeNome} onChange={(event) => setForm((value) => ({ ...value, unidadeNome: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="local">Localidade</Label><Input id="local" value={form.unidadeLocal} onChange={(event) => setForm((value) => ({ ...value, unidadeLocal: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="janela">Janela de alerta de vencimento (dias)</Label><Input id="janela" type="number" min={1} value={form.janelaVencimentoDias} onChange={(event) => setForm((value) => ({ ...value, janelaVencimentoDias: Number(event.target.value) || 1 }))} /></div>
        </div>
        <Button onClick={save}>Salvar configurações</Button>
      </section>

      <section className="mt-5 space-y-3 rounded border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Responsáveis</h2>
        <ul className="flex flex-wrap gap-2">
          {form.responsaveis.map((responsavel) => (
            <li key={responsavel} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-sm">
              {responsavel}
              <button type="button" className="text-xs text-destructive" onClick={() => setForm((value) => ({ ...value, responsaveis: value.responsaveis.filter((item) => item !== responsavel) }))}>remover</button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input value={novoResp} onChange={(event) => setNovoResp(event.target.value)} placeholder="Nome do responsável" />
          <Button variant="outline" onClick={() => { const nome = novoResp.trim(); if (!nome) return; setForm((value) => ({ ...value, responsaveis: [...value.responsaveis, nome] })); setNovoResp(""); }}>Adicionar</Button>
        </div>
      </section>

      <section className="mt-5 space-y-3 rounded border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Novo critério interno</h2>
        <p className="text-sm text-muted-foreground">Critérios cadastrados entram na matriz e no cálculo do índice interno. Nenhum critério pode ser marcado como norma verificada sem a fonte completa.</p>
        <NewRequirementForm responsaveis={form.responsaveis} />
      </section>

      <section className="mt-5 space-y-3 rounded border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Dados</h2>
        <p className="text-sm text-muted-foreground">Todos os dados desta demonstração ficam apenas neste navegador.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportJson}>Exportar dados (JSON)</Button>
          <Button variant="destructive" onClick={() => { resetDemo(); toast.success("Ambiente demonstrativo restaurado."); }}>Restaurar demonstração</Button>
        </div>
      </section>

      <Disclaimer text={DISCLAIMER} />
    </div>
  );
}
