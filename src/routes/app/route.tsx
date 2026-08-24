import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { DEMO_MODE_ENABLED } from "@/lib/runtime-mode";
import { getSession } from "@/server/auth.functions";

export const Route = createFileRoute("/app")({
  beforeLoad: async () => {
    if (DEMO_MODE_ENABLED) {
      return { demoMode: true, session: null };
    }

    const session = await getSession().catch(() => null);
    if (!session) throw redirect({ to: "/login" });

    return { demoMode: false, session };
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
