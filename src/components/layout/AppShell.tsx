import { Link, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  FolderCheck,
  Gauge,
  History,
  Images,
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
import { GuidedTour } from "@/components/layout/GuidedTour";
import { Button } from "@/components/ui/button";
import { hydrateStore, resetDemo, useAppState } from "@/lib/storage/store";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { can, type Role } from "@/server/rbac";

const DEMO_NAV = [
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

const PRODUCTION_NAV = [
  { to: "/app/overview", label: "Visão geral", Icon: Gauge },
  { to: "/app/silos", label: "Silos", Icon: Warehouse },
  { to: "/app/criteria", label: "Matriz de requisitos", Icon: ListChecks },
  { to: "/app/files", label: "Documentos", Icon: FileText },
  { to: "/app/inspections", label: "Inspeções", Icon: ClipboardCheck },
  { to: "/app/nonconformities", label: "Não conformidades", Icon: AlertTriangle },
  { to: "/app/actions", label: "Ações corretivas", Icon: Wrench },
  { to: "/app/dossier", label: "Dossiê", Icon: FolderCheck },
  { to: "/app/history", label: "Histórico", Icon: History },
] as const;

type NavItem = (typeof DEMO_NAV)[number] | (typeof PRODUCTION_NAV)[number];

export function AppShell({
  children,
  demoMode,
  user,
}: {
  children: ReactNode;
  demoMode: boolean;
  user: { name?: string | null; email?: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (demoMode) hydrateStore();
  }, [demoMode]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return demoMode ? (
    <DemoShell open={open} setOpen={setOpen}>
      {children}
    </DemoShell>
  ) : (
    <ProductionShell open={open} setOpen={setOpen} user={user}>
      {children}
    </ProductionShell>
  );
}

function DemoShell({
  children,
  open,
  setOpen,
}: {
  children: ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const unidade = useAppState((state) => state.settings.unidadeNome);
  const local = useAppState((state) => state.settings.unidadeLocal);

  return (
    <ShellFrame
      open={open}
      setOpen={setOpen}
      nav={DEMO_NAV}
      unitContent={
        <>
          <p className="text-xs uppercase tracking-wide text-sidebar-foreground/60">Unidade</p>
          <p className="text-sm font-medium">{unidade}</p>
          <p className="text-xs text-sidebar-foreground/70">{local}</p>
        </>
      }
      footer="Usuário: Gestor Demo"
      topbar={<DemoBanner onMenu={() => setOpen(true)} />}
      bottomNav={<BottomNav nav={DEMO_NAV} />}
    >
      {children}
      <GuidedTour />
    </ShellFrame>
  );
}

function ProductionShell({
  children,
  open,
  setOpen,
  user,
}: {
  children: ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
  user: { name?: string | null; email?: string | null } | null;
}) {
  const workspaceState = useWorkspace();
  const location = workspaceState.workspace
    ? [workspaceState.workspace.facilityCity, workspaceState.workspace.facilityState]
        .filter(Boolean)
        .join(" — ")
    : "";
  const productionNav = PRODUCTION_NAV.filter(
    (item) =>
      item.to !== "/app/history" ||
      !workspaceState.workspace ||
      can(workspaceState.workspace.role as Role, "audit.read"),
  );

  return (
    <ShellFrame
      open={open}
      setOpen={setOpen}
      nav={productionNav}
      unitContent={
        workspaceState.loading ? (
          <p className="text-xs text-sidebar-foreground/70">Carregando acessos…</p>
        ) : workspaceState.error ? (
          <p className="text-xs text-destructive">{workspaceState.error}</p>
        ) : (
          <div className="space-y-2">
            <label className="block text-[11px] uppercase tracking-wide text-sidebar-foreground/60">
              Empresa
              <select
                className="mt-1 w-full rounded border border-sidebar-border bg-sidebar-accent px-2 py-1.5 text-xs text-sidebar-accent-foreground"
                value={workspaceState.workspace?.organizationId ?? ""}
                onChange={(event) => workspaceState.setOrganizationId(event.target.value)}
              >
                {workspaceState.organizations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] uppercase tracking-wide text-sidebar-foreground/60">
              Unidade
              <select
                className="mt-1 w-full rounded border border-sidebar-border bg-sidebar-accent px-2 py-1.5 text-xs text-sidebar-accent-foreground"
                value={workspaceState.workspace?.facilityId ?? ""}
                onChange={(event) => workspaceState.setFacilityId(event.target.value)}
              >
                {workspaceState.facilities.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {location ? <p className="text-xs text-sidebar-foreground/70">{location}</p> : null}
          </div>
        )
      }
      footer={user?.name || user?.email ? `${user?.name ?? user?.email}` : "Usuário autenticado"}
      topbar={<ProductionTopbar onMenu={() => setOpen(true)} />}
      bottomNav={<BottomNav nav={productionNav} />}
    >
      {children}
    </ShellFrame>
  );
}

function ShellFrame({
  children,
  open,
  setOpen,
  nav,
  unitContent,
  footer,
  topbar,
  bottomNav,
}: {
  children: ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
  nav: ReadonlyArray<NavItem>;
  unitContent: ReactNode;
  footer: string;
  topbar: ReactNode;
  bottomNav: ReactNode;
}) {
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
          <div className="border-b border-sidebar-border px-4 py-3">{unitContent}</div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
            {nav.map(({ to, label, Icon }) => (
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
            {footer}
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
          {topbar}
          <main id="conteudo" className="flex-1 px-4 pb-24 pt-5 lg:px-8 lg:pb-10">
            {children}
          </main>
          {bottomNav}
        </div>
      </div>
    </div>
  );
}

function ProductionTopbar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card/95 px-4 py-2 backdrop-blur lg:px-8">
      <button
        type="button"
        className="lg:hidden"
        onClick={onMenu}
        aria-label="Abrir menu de navegação"
      >
        <Menu className="size-5" />
      </button>
      <p className="text-xs font-medium text-muted-foreground">AMBIENTE DE PRODUÇÃO</p>
      <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-2 rounded-full bg-success" aria-hidden="true" />
        Sessão autenticada
      </span>
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

function BottomNav({ nav }: { nav: ReadonlyArray<NavItem> }) {
  const [more, setMore] = useState(false);
  const quick = nav.slice(0, 3);
  return (
    <>
      {more ? (
        <div className="fixed inset-x-0 bottom-14 z-40 border-t border-border bg-card p-2 shadow-lg lg:hidden">
          <div className="grid grid-cols-2 gap-1">
            {nav.map(({ to, label, Icon }) => (
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
        {quick.map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="flex flex-col items-center gap-0.5 py-2 text-xs">
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMore((value) => !value)}
          className="flex flex-col items-center gap-0.5 py-2 text-xs"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
          Mais
        </button>
      </nav>
    </>
  );
}
