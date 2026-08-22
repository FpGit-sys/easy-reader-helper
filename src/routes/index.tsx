import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  FileWarning,
  FolderOpen,
  ImageOff,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DISCLAIMER } from "@/lib/formatting";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SiloNR — Prontidão para auditoria em unidades armazenadoras" },
      {
        name: "description",
        content:
          "Centralize inspeções, documentos, evidências, pendências e ações corretivas de silos em uma visão única e rastreável.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "SiloNR — Seu silo está pronto para uma auditoria hoje?" },
      {
        property: "og:description",
        content:
          "Organize inspeções, documentos, evidências e ações corretivas antes que uma pendência vire problema.",
      },
    ],
  }),
  component: LandingPage,
});

const problemas = [
  { icon: FolderOpen, titulo: "Documentos espalhados", texto: "Pastas, e-mails e planilhas paralelas sem um índice único." },
  { icon: ImageOff, titulo: "Evidências sem organização", texto: "Fotos no celular do técnico, sem vínculo com o item verificado." },
  { icon: UserX, titulo: "Pendências sem responsável", texto: "Todo mundo viu o problema, ninguém ficou com o nome nele." },
  { icon: AlertTriangle, titulo: "Ações corretivas esquecidas", texto: "Planos criados na reunião e nunca mais acompanhados." },
  { icon: ClipboardList, titulo: "Inspeções sem histórico", texto: "Impossível provar o que foi verificado e quando." },
  { icon: CalendarClock, titulo: "Prazos controlados em planilhas", texto: "Vencimentos descobertos tarde demais." },
];

const fluxo = ["CHECKLIST", "EVIDÊNCIA", "PENDÊNCIA", "AÇÃO", "RESPONSÁVEL", "PRAZO", "DOSSIÊ"];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <span className="text-lg font-semibold tracking-tight">SiloNR</span>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/demo">Ver demonstração</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/app/dashboard">Entrar no ambiente</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="border-b border-border bg-card">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Gestão de prontidão para auditoria
            </p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Seu silo está pronto para uma auditoria hoje?
            </h1>
            <p className="mt-4 max-w-2xl text-base text-muted-foreground">
              Centralize inspeções, documentos, evidências, pendências e ações corretivas em uma
              visão única e rastreável.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/demo">Ver demonstração</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/demo" hash="diagnostico">
                  Solicitar diagnóstico
                </Link>
              </Button>
            </div>
            <p className="mt-6 max-w-2xl text-sm text-muted-foreground">
              O SiloNR reúne em um só lugar o que normalmente fica espalhado entre planilhas,
              pastas, fotos e mensagens.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="text-xl font-semibold tracking-tight">
            O problema não é só ter documentos. É conseguir provar.
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Saiba o que falta, quem precisa resolver e quais evidências você realmente possui.
          </p>
          <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {problemas.map((p) => (
              <li key={p.titulo} className="rounded border border-border bg-card p-4">
                <p.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold">{p.titulo}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.texto}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-y border-border bg-card">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <h2 className="text-xl font-semibold tracking-tight">Do caos ao dossiê</h2>
            <ol className="mt-6 flex flex-wrap items-center gap-2">
              {fluxo.map((etapa, i) => (
                <li key={etapa} className="flex items-center gap-2">
                  <span className="rounded border border-border bg-background px-3 py-2 text-xs font-semibold tracking-wide">
                    {etapa}
                  </span>
                  {i < fluxo.length - 1 ? (
                    <span aria-hidden="true" className="text-muted-foreground">
                      →
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="text-xl font-semibold tracking-tight">
            O SiloNR não substitui seu responsável técnico.
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            O sistema organiza, registra e rastreia. Ele mostra quais critérios internos foram
            cadastrados, quais evidências existem, quais prazos venceram e quem respondeu por cada
            item. A avaliação técnica, o parecer de engenharia e a interpretação normativa continuam
            sendo responsabilidade dos profissionais habilitados da sua organização.
          </p>
          <div className="mt-8 rounded border border-border bg-card p-6">
            <p className="text-sm font-semibold">
              Veja uma unidade fictícia com riscos e pendências em menos de 2 minutos.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/demo">Ver ambiente demonstrativo</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/app/dossier">
                  <FileWarning className="mr-2 h-4 w-4" aria-hidden="true" />
                  Ver dossiê de auditoria
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-5 py-8">
          <p className="text-xs leading-relaxed text-muted-foreground">{DISCLAIMER}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            SiloNR — ambiente demonstrativo com dados e critérios fictícios.
          </p>
        </div>
      </footer>
    </div>
  );
}
