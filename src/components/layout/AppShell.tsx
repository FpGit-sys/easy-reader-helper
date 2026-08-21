import { Link, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  FolderCheck,
  Gauge,
  History,
  Images,
  LayoutGrid,
  ListChecks,
  Menu,
  MoreHorizontal,
  RotateCcw,
  Settings,
  Smartphone,
  Warehouse,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { hydrateStore, resetDemo, useAppState } from "@/lib/storage/store";
import { cn } from "@/lib/utils";
import { GuidedTour } from "@/components/layout/GuidedTour";

const NAV = [
  { to: "/app/dashboard", label: "Visão geral", Icon: Gauge },
  { to: "/app/silos", label: "Silos", Icon: Warehouse },
  { to: "/app/requirements", label: "Matriz de requisitos", Icon: ListChecks },
  { to: "/app/documents", label: "Documentos", Icon: FileText },
  { to: "/app/inspections", label: "Inspeções", Icon: ClipboardCheck },
  { to: "/app/nonconformities", label: "Não conformidades", Icon: AlertTriangle },
  { to: "/app/actions", label: "Ações corretivas", Icon: Wrench },
  { to: "/app/evidence", label: "Evidências", Icon: Images },
  { to: "/app/dossier", label: "Dossiê", Icon: FolderCheck },
  { to: "/app/history", label: "Histórico", Icon: History },
  { to: "/app/field", label: "Modo campo", Icon: Smartphone },
  { to: "/app/settings", label: "Configurações", Icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const unidade = useAppState((s) => s.settings.unidadeNome);
  const local = useAppState((s) => s.settings.unidadeLocal);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    hydrateStore();
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Ir para o conteúdo
      </a>

      <div className="flex">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full",
          )}
          aria-label="Navegação principal"
        >
          <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-4">
            <Link to="/" className="flex flex-col">
              <span className="text-base font-semibold tracking-tight">SiloNR</span>
              <span className="text-xs text-sidebar-foreground/70">Prontidão para auditoria</span>
            </Link>
            <button
              type="button"
              className="lg:hidden"
              onClick={() => setOpen(false)}
              aria-label="Fechar menu"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="border-b border-sidebar-border px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-sidebar-foreground/60">Unidade</p>
            <p className="text-sm font-medium">{unidade}</p>
            <p className="text-xs text-sidebar-foreground/70">{local}</p>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
            {NAV.map(({ to, label, Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-2.5 rounded px-3 py-2 text-sm text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className:
                    "flex items-center gap-2.5 rounded px-3 py-2 text-sm bg-sidebar-accent text-sidebar-accent-foreground font-medium",
                }}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="border-t border-sidebar-border px-4 py-3 text-xs text-sidebar-foreground/70">
            Usuário: Gestor Demo
          </div>
        </aside>

        {open ? (
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        ) : null}

        <div className="flex min-h-screen w-full flex-col lg:pl-64">
          <DemoBanner onMenu={() => setOpen(true)} />
          <main id="conteudo" className="flex-1 px-4 pb-24 pt-5 lg:px-8 lg:pb-10">
            {children}
          </main>
          <BottomNav />
        </div>
      </div>
      <GuidedTour />
    </div>
  );
}

function DemoBanner({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2 lg:px-8">
      <button
        type="button"
        className="lg:hidden"
        onClick={onMenu}
        aria-label="Abrir menu de navegação"
      >
        <Menu className="size-5" />
      </button>
      <p className="text-xs font-semibold tracking-wide text-warning-foreground">
        AMBIENTE DEMONSTRATIVO — DADOS E CRITÉRIOS FICTÍCIOS
      </p>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-7 gap-1.5 text-xs"
        onClick={() => {
          resetDemo();
          toast.success("Ambiente demonstrativo restaurado.");
        }}
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Restaurar demonstração
      </Button>
    </div>
  );
}

function BottomNav() {
  const [more, setMore] = useState(false);
  return (
    <>
      {more ? (
        <div className="fixed inset-x-0 bottom-14 z-40 border-t border-border bg-card p-2 shadow-lg lg:hidden">
          <div className="grid grid-cols-2 gap-1">
            {NAV.map(({ to, label, Icon }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setMore(false)}
                className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-accent"
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-card lg:hidden"
        aria-label="Navegação rápida"
      >
        <Link to="/app/dashboard" className="flex flex-col items-center gap-0.5 py-2 text-xs">
          <LayoutGrid className="size-4" aria-hidden="true" />
          Início
        </Link>
        <Link to="/app/field" className="flex flex-col items-center gap-0.5 py-2 text-xs">
          <ClipboardCheck className="size-4" aria-hidden="true" />
          Inspecionar
        </Link>
        <Link to="/app/nonconformities" className="flex flex-col items-center gap-0.5 py-2 text-xs">
          <AlertTriangle className="size-4" aria-hidden="true" />
          Pendências
        </Link>
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          className="flex flex-col items-center gap-0.5 py-2 text-xs"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
          Mais
        </button>
      </nav>
    </>
  );
}
