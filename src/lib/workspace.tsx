import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO_MODE_ENABLED } from "@/lib/runtime-mode";
import { listMyScopes, listOrganizationFacilities } from "@/server/scopes.functions";

const STORAGE_KEY = "silonr:workspace:v1";

interface PersistedWorkspace {
  organizationId: string;
  facilityId: string;
}

export interface Workspace {
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  facilityCity: string | null;
  facilityState: string | null;
  role: string;
}

interface WorkspaceContextValue {
  loading: boolean;
  error: string | null;
  workspace: Workspace | null;
  organizations: Array<{ id: string; name: string }>;
  facilities: Array<{ id: string; name: string; city: string | null; state: string | null }>;
  setOrganizationId: (organizationId: string) => void;
  setFacilityId: (facilityId: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readPersisted(): PersistedWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspace>;
    if (typeof parsed.organizationId !== "string" || typeof parsed.facilityId !== "string") {
      return null;
    }
    return { organizationId: parsed.organizationId, facilityId: parsed.facilityId };
  } catch {
    return null;
  }
}

function persistWorkspace(value: PersistedWorkspace | null) {
  if (typeof window === "undefined") return;
  if (!value) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  if (DEMO_MODE_ENABLED) return <>{children}</>;
  return <ProductionWorkspaceProvider>{children}</ProductionWorkspaceProvider>;
}

function ProductionWorkspaceProvider({ children }: { children: ReactNode }) {
  const persisted = useMemo(() => readPersisted(), []);
  const [organizationId, setOrganizationIdState] = useState(persisted?.organizationId ?? "");
  const [facilityId, setFacilityIdState] = useState(persisted?.facilityId ?? "");

  const scopesQuery = useQuery({
    queryKey: ["production", "my-scopes"],
    queryFn: () => listMyScopes(),
    staleTime: 60_000,
  });

  const organizations = useMemo(() => {
    const map = new Map<string, string>();
    for (const scope of scopesQuery.data ?? []) {
      map.set(scope.organizationId, scope.organizationName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [scopesQuery.data]);

  useEffect(() => {
    if (organizations.length === 0) return;
    if (!organizations.some((item) => item.id === organizationId)) {
      setOrganizationIdState(organizations[0]!.id);
      setFacilityIdState("");
    }
  }, [organizationId, organizations]);

  const facilitiesQuery = useQuery({
    queryKey: ["production", "facilities", organizationId],
    queryFn: () => listOrganizationFacilities({ data: { organizationId } }),
    enabled: Boolean(organizationId),
    staleTime: 60_000,
  });

  const facilities = facilitiesQuery.data ?? [];

  useEffect(() => {
    if (facilities.length === 0) return;
    if (!facilities.some((item) => item.id === facilityId)) {
      setFacilityIdState(facilities[0]!.id);
    }
  }, [facilities, facilityId]);

  const workspace = useMemo<Workspace | null>(() => {
    const organization = organizations.find((item) => item.id === organizationId);
    const facility = facilities.find((item) => item.id === facilityId);
    if (!organization || !facility) return null;

    const scopes = scopesQuery.data ?? [];
    const directScope = scopes.find(
      (scope) => scope.organizationId === organizationId && scope.facilityId === facilityId,
    );
    const organizationScope = scopes.find(
      (scope) => scope.organizationId === organizationId && scope.facilityId === null,
    );
    const role = directScope?.role ?? organizationScope?.role;
    if (!role) return null;

    return {
      organizationId,
      organizationName: organization.name,
      facilityId,
      facilityName: facility.name,
      facilityCity: facility.city,
      facilityState: facility.state,
      role,
    };
  }, [facilities, facilityId, organizationId, organizations, scopesQuery.data]);

  useEffect(() => {
    if (!workspace) return;
    persistWorkspace({
      organizationId: workspace.organizationId,
      facilityId: workspace.facilityId,
    });
  }, [workspace]);

  const setOrganizationId = (next: string) => {
    setOrganizationIdState(next);
    setFacilityIdState("");
  };

  const setFacilityId = (next: string) => setFacilityIdState(next);

  const error =
    scopesQuery.error instanceof Error
      ? scopesQuery.error.message
      : facilitiesQuery.error instanceof Error
        ? facilitiesQuery.error.message
        : organizations.length === 0 && !scopesQuery.isLoading
          ? "Sua conta ainda não possui acesso a uma empresa ou unidade."
          : null;

  return (
    <WorkspaceContext.Provider
      value={{
        loading: scopesQuery.isLoading || facilitiesQuery.isLoading,
        error,
        workspace,
        organizations,
        facilities,
        setOrganizationId,
        setFacilityId,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) {
    if (DEMO_MODE_ENABLED) {
      return {
        loading: false,
        error: null,
        workspace: null,
        organizations: [],
        facilities: [],
        setOrganizationId: () => undefined,
        setFacilityId: () => undefined,
      } satisfies WorkspaceContextValue;
    }
    throw new Error("useWorkspace deve ser usado dentro de WorkspaceProvider.");
  }
  return value;
}
