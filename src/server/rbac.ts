export type Role =
  | "super_admin"
  | "admin_empresa"
  | "gestor_unidade"
  | "responsavel_tecnico"
  | "inspetor"
  | "leitor";

export type Permission =
  | "organization.manage"
  | "facility.manage"
  | "users.manage"
  | "silos.read"
  | "silos.write"
  | "requirements.read"
  | "requirements.write"
  | "requirements.publish"
  | "documents.read"
  | "documents.write"
  | "inspections.read"
  | "inspections.execute"
  | "nonconformities.read"
  | "nonconformities.write"
  | "actions.read"
  | "actions.write"
  | "evidence.read"
  | "evidence.write"
  | "dossier.generate"
  | "audit.read";

const ALL_PERMISSIONS: Permission[] = [
  "organization.manage",
  "facility.manage",
  "users.manage",
  "silos.read",
  "silos.write",
  "requirements.read",
  "requirements.write",
  "requirements.publish",
  "documents.read",
  "documents.write",
  "inspections.read",
  "inspections.execute",
  "nonconformities.read",
  "nonconformities.write",
  "actions.read",
  "actions.write",
  "evidence.read",
  "evidence.write",
  "dossier.generate",
  "audit.read",
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  super_admin: new Set(ALL_PERMISSIONS),
  admin_empresa: new Set(ALL_PERMISSIONS.filter((p) => p !== "organization.manage")),
  gestor_unidade: new Set([
    "facility.manage",
    "silos.read",
    "silos.write",
    "requirements.read",
    "requirements.write",
    "documents.read",
    "documents.write",
    "inspections.read",
    "inspections.execute",
    "nonconformities.read",
    "nonconformities.write",
    "actions.read",
    "actions.write",
    "evidence.read",
    "evidence.write",
    "dossier.generate",
    "audit.read",
  ]),
  responsavel_tecnico: new Set([
    "silos.read",
    "requirements.read",
    "requirements.write",
    "requirements.publish",
    "documents.read",
    "documents.write",
    "inspections.read",
    "inspections.execute",
    "nonconformities.read",
    "nonconformities.write",
    "actions.read",
    "actions.write",
    "evidence.read",
    "evidence.write",
    "dossier.generate",
    "audit.read",
  ]),
  inspetor: new Set([
    "silos.read",
    "requirements.read",
    "documents.read",
    "inspections.read",
    "inspections.execute",
    "nonconformities.read",
    "nonconformities.write",
    "actions.read",
    "evidence.read",
    "evidence.write",
    "dossier.generate",
  ]),
  leitor: new Set([
    "silos.read",
    "requirements.read",
    "documents.read",
    "inspections.read",
    "nonconformities.read",
    "actions.read",
    "evidence.read",
    "dossier.generate",
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new Error(`FORBIDDEN:${permission}`);
  }
}
