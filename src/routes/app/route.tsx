import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { DEMO_MODE_ENABLED } from "@/lib/runtime-mode";
import { WorkspaceProvider } from "@/lib/workspace";
import { getSession } from "@/server/auth.functions";

const PRODUCTION_READY_PATHS = new Set(["/app", "/app/dashboard", "/app/silos", "/app/silos/"]);

export const Route = createFileRoute("/app")({
  beforeLoad: async ({ location }) => {
    if (DEMO_MODE_ENABLED) {
      return { demoMode: true, session: null };
    }

    const session = await getSession().catch(() => null);
    if (!session) throw redirect({ to: "/login" });

    if (!PRODUCTION_READY_PATHS.has(location.pathname)) {
      throw redirect({ to: "/app/dashboard" });
    }

    return { demoMode: false, session };
  },
  component: AppLayout,
});

function AppLayout() {
  const { demoMode, session } = Route.useRouteContext();
  return (
    <WorkspaceProvider>
      <AppShell
        demoMode={demoMode}
        user={session?.user ? { name: session.user.name, email: session.user.email } : null}
      >
        <Outlet />
      </AppShell>
    </WorkspaceProvider>
  );
}
