import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DISCLAIMER } from "@/lib/formatting";
import { DEMO_MODE_ENABLED } from "@/lib/runtime-mode";

export const Route = createFileRoute("/demo")({
  beforeLoad: () => {
    if (!DEMO_MODE_ENABLED) throw redirect({ to: "/login" });
  },
  head: () => ({
    meta: [
      { title: "Ambiente demonstrativo — SiloNR" },
      {
        name: "description",
        content:
          "Unidade Armazenadora Santa Rita: empresa, silos, documentos e critérios fictícios para demonstração do SiloNR.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Ambiente demonstrativo — SiloNR" },
      {
        property: "og:description",
        content: "Explore uma unidade armazenadora fictícia com riscos, pendências e dossiê em PDF.",
      },
    ],
  }),
  component: DemoEntryPage,
});

function DemoEntryPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            SiloNR
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Voltar à página inicial</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-14">
        <p className="inline-block rounded border border-border bg-card px-2 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Ambiente demonstrativo — dados e critérios fictícios
        </p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          Unidade Armazenadora Santa Rita
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Rio Verde — GO</p>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
          Empresa, documentos, silos e requisitos deste ambiente são fictícios. Nenhum item
          representa exigência legal real e nada é enviado para servidores: os dados ficam apenas
          neste navegador.
        </p>

        <dl className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            { k: "5 silos", v: "Silo 01 a Silo 05, com índices internos distintos" },
            { k: "52 critérios internos", v: "37 atendidos, 11 pendentes, 4 críticos" },
            { k: "71% de prontidão", v: "Índice interno calculado sobre itens aplicáveis" },
          ].map((i) => (
            <div key={i.k} className="rounded border border-border bg-card p-4">
              <dt className="text-sm font-semibold">{i.k}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{i.v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/app/dashboard">Entrar como Gestor</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/app/field">Entrar no modo Inspeção</Link>
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Sem login: o acesso é livre e local, apenas nesta compilação demonstrativa.
        </p>

        <section id="diagnostico" className="mt-12 rounded border border-border bg-card p-6">
          <h2 className="text-base font-semibold">Solicitar diagnóstico</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Nesta versão demonstrativa não há envio de formulários nem integrações externas. Para
            avaliar sua unidade real, execute o diagnóstico demonstrativo dentro do painel e use o
            dossiê gerado como base de conversa com seu responsável técnico.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/app/dashboard">Executar diagnóstico demonstrativo</Link>
          </Button>
        </section>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-4xl px-5 py-8">
          <p className="text-xs leading-relaxed text-muted-foreground">{DISCLAIMER}</p>
        </div>
      </footer>
    </div>
  );
}
