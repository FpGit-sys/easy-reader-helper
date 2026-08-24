import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  UserCog,
  Users,
  Warehouse,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { useWorkspace } from "@/lib/workspace";
import {
  archiveProductionFacility,
  createProductionFacility,
  createProductionMember,
  getProductionAdministration,
  updateProductionFacility,
  updateProductionMember,
  updateProductionOrganization,
} from "@/server/operations/admin.functions";
import { can, type Role } from "@/server/rbac";

type AdminData = Awaited<ReturnType<typeof getProductionAdministration>>;
type Facility = AdminData["facilities"][number];
type Member = AdminData["members"][number];
type MemberRole = "admin_empresa" | "gestor_unidade" | "responsavel_tecnico" | "inspetor" | "leitor";

const ROLE_LABELS: Record<MemberRole, string> = {
  admin_empresa: "Administrador da empresa",
  gestor_unidade: "Gestor da unidade",
  responsavel_tecnico: "Responsável técnico",
  inspetor: "Inspetor",
  leitor: "Leitor",
};

export function ProductionAdministrationPage() {
  const workspaceState = useWorkspace();
  const workspace = workspaceState.workspace;
  const queryClient = useQueryClient();
  const [facilityDialog, setFacilityDialog] = useState<Facility | "new" | null>(null);
  const [memberDialog, setMemberDialog] = useState<Member | "new" | null>(null);

  const canManage = workspace ? can(workspace.role as Role, "users.manage") : false;
  const query = useQuery({
    queryKey: ["production", "administration", workspace?.organizationId],
    queryFn: () => getProductionAdministration({ data: { organizationId: workspace!.organizationId } }),
    enabled: Boolean(workspace && canManage),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["production", "administration"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "my-scopes"] }),
      queryClient.invalidateQueries({ queryKey: ["production", "facilities"] }),
    ]);
  };

  if (workspaceState.loading) return <Loading text="Carregando administração…" />;
  if (workspaceState.error) return <EmptyState title="Acesso indisponível" description={workspaceState.error} />;
  if (!workspace) return <EmptyState title="Selecione uma unidade" description="Escolha uma empresa e unidade para continuar." />;
  if (!canManage) {
    return (
      <EmptyState
        title="Administração restrita"
        description="Somente administradores da empresa podem alterar unidades, usuários, perfis e dados cadastrais."
      />
    );
  }
  if (query.isLoading) return <Loading text="Carregando dados da empresa…" />;
  if (query.error || !query.data) {
    return <EmptyState title="Não foi possível carregar a administração" description="Verifique sua conexão e permissões." />;
  }

  const data = query.data;
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Administração"
        subtitle={`${data.organization.name} · implantação, usuários, unidades e segurança da conta`}
      />

      <LicenseSummary data={data} />

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.3fr]">
        <OrganizationCard data={data} onChanged={refresh} />
        <SecurityCard />
      </div>

      <section className="mt-5 rounded border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <div className="flex items-center gap-2"><Warehouse className="size-4" /><h2 className="font-semibold">Unidades</h2></div>
            <p className="mt-1 text-sm text-muted-foreground">Cadastre as unidades operacionais contratadas para esta empresa.</p>
          </div>
          <Button onClick={() => setFacilityDialog("new")} disabled={!canAddFacility(data)}>
            <Plus className="size-4" />Nova unidade
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-dense">
            <thead className="bg-muted/60 text-left"><tr><Th>Unidade</Th><Th>Localidade</Th><Th>Status</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
            <tbody>
              {data.facilities.map((facility) => (
                <tr key={facility.id} className="border-t border-border">
                  <Td><p className="font-medium">{facility.name}</p><p className="text-xs text-muted-foreground font-mono">{facility.id.slice(0, 8)}…</p></Td>
                  <Td>{[facility.city, facility.state].filter(Boolean).join(" — ") || "—"}</Td>
                  <Td><Badge variant={facility.active ? "secondary" : "outline"}>{facility.active ? "Ativa" : "Desativada"}</Badge></Td>
                  <Td><Button size="sm" variant="outline" onClick={() => setFacilityDialog(facility)}><Pencil className="size-3.5" />Editar</Button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 rounded border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <div className="flex items-center gap-2"><Users className="size-4" /><h2 className="font-semibold">Usuários e acessos</h2></div>
            <p className="mt-1 text-sm text-muted-foreground">Atribua o menor nível de acesso necessário e limite o usuário à unidade correta.</p>
          </div>
          <Button onClick={() => setMemberDialog("new")} disabled={!canAddUser(data)}>
            <Plus className="size-4" />Novo usuário
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-dense">
            <thead className="bg-muted/60 text-left"><tr><Th>Usuário</Th><Th>Perfil</Th><Th>Escopo</Th><Th>Status</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
            <tbody>
              {data.members.map((member) => (
                <tr key={member.id} className="border-t border-border">
                  <Td><p className="font-medium">{member.name}{member.isCurrentUser ? " (você)" : ""}</p><p className="text-xs text-muted-foreground">{member.email}</p></Td>
                  <Td>{roleLabel(member.role)}</Td>
                  <Td>{member.facilityName ?? "Todas as unidades"}</Td>
                  <Td><Badge variant={member.active ? "secondary" : "outline"}>{member.active ? "Ativo" : "Desativado"}</Badge></Td>
                  <Td><Button size="sm" variant="outline" onClick={() => setMemberDialog(member)}><UserCog className="size-3.5" />Gerenciar</Button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-5 rounded border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        A desativação de um acesso não apaga inspeções, evidências, documentos ou eventos históricos atribuídos ao usuário. As permissões são verificadas no servidor a cada operação; ocultar um botão na interface não é usado como mecanismo de segurança.
      </div>

      {facilityDialog ? (
        <FacilityDialog
          value={facilityDialog}
          organizationId={workspace.organizationId}
          onClose={() => setFacilityDialog(null)}
          onChanged={async () => { setFacilityDialog(null); await refresh(); }}
        />
      ) : null}
      {memberDialog ? (
        <MemberDialog
          value={memberDialog}
          organizationId={workspace.organizationId}
          facilities={data.facilities.filter((facility) => facility.active)}
          onClose={() => setMemberDialog(null)}
          onChanged={async () => { setMemberDialog(null); await refresh(); }}
        />
      ) : null}
    </div>
  );
}

function LicenseSummary({ data }: { data: AdminData }) {
  const license = data.license;
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric icon={<ShieldCheck className="size-4" />} label="Licença" value={license ? `${license.plan} · ${licenseStatus(license.status)}` : "Não configurada"} />
      <Metric icon={<Building2 className="size-4" />} label="Unidades" value={license ? `${data.usage.activeFacilities} / ${license.maxFacilities}` : String(data.usage.activeFacilities)} />
      <Metric icon={<Users className="size-4" />} label="Usuários ativos" value={license ? `${data.usage.activeUsers} / ${license.maxUsers}` : String(data.usage.activeUsers)} />
      <Metric icon={<KeyRound className="size-4" />} label="Validade" value={license?.validUntil ? formatDate(license.validUntil) : "Sem data definida"} />
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded border border-border bg-card p-4"><div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">{icon}{label}</div><p className="mt-2 text-lg font-semibold">{value}</p></div>;
}

function OrganizationCard({ data, onChanged }: { data: AdminData; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(data.organization.name);
  const [legalName, setLegalName] = useState(data.organization.legalName ?? "");
  const [document, setDocument] = useState(data.organization.document ?? "");
  const mutation = useMutation({
    mutationFn: () => updateProductionOrganization({ data: { organizationId: data.organization.id, name, legalName: legalName.trim() || null, document: document.trim() || null } }),
    onSuccess: async () => { toast.success("Dados da empresa atualizados."); await onChanged(); },
    onError: () => toast.error("Não foi possível atualizar os dados da empresa."),
  });
  return (
    <section className="rounded border border-border bg-card p-4">
      <div className="flex items-center gap-2"><Building2 className="size-4" /><h2 className="font-semibold">Empresa</h2></div>
      <p className="mt-1 text-sm text-muted-foreground">Dados cadastrais internos do cliente. O campo documento não substitui validação cadastral externa.</p>
      <div className="mt-4 space-y-3">
        <Field label="Nome de exibição"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /></Field>
        <Field label="Razão social"><Input value={legalName} onChange={(event) => setLegalName(event.target.value)} maxLength={240} placeholder="Opcional" /></Field>
        <Field label="CNPJ/CPF cadastral"><Input value={document} onChange={(event) => setDocument(event.target.value)} maxLength={32} placeholder="Opcional" /></Field>
        <Button disabled={mutation.isPending || name.trim().length < 2} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Salvar empresa</Button>
      </div>
    </section>
  );
}

function SecurityCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = currentPassword.length > 0 && newPassword.length >= 12 && newPassword === confirmPassword;

  const changePassword = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) throw new Error(result.error.message);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Senha alterada. Outras sessões foram revogadas.");
    } catch {
      toast.error("Não foi possível alterar a senha. Confira a senha atual.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded border border-border bg-card p-4">
      <div className="flex items-center gap-2"><KeyRound className="size-4" /><h2 className="font-semibold">Segurança da sua conta</h2></div>
      <p className="mt-1 text-sm text-muted-foreground">Troque a senha temporária após a implantação. Ao salvar, as outras sessões desta conta são revogadas.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Senha atual"><Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
        <div />
        <Field label="Nova senha"><Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
        <Field label="Confirmar nova senha"><Input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Mínimo de 12 caracteres. A senha não é armazenada pelo SiloNR em texto legível.</p>
      <Button className="mt-3" variant="outline" disabled={!valid || saving} onClick={() => void changePassword()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}Alterar senha</Button>
    </section>
  );
}

function FacilityDialog({ value, organizationId, onClose, onChanged }: { value: Facility | "new"; organizationId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const isNew = value === "new";
  const [name, setName] = useState(isNew ? "" : value.name);
  const [city, setCity] = useState(isNew ? "" : value.city ?? "");
  const [state, setState] = useState(isNew ? "" : value.state ?? "");
  const mutation = useMutation({
    mutationFn: async () => {
      if (isNew) {
        await createProductionFacility({ data: { organizationId, facility: { name, city: city.trim() || null, state: state.trim() || null } } });
      } else {
        await updateProductionFacility({ data: { organizationId, facilityId: value.id, facility: { name, city: city.trim() || null, state: state.trim() || null } } });
      }
    },
    onSuccess: async () => { toast.success(isNew ? "Unidade criada." : "Unidade atualizada."); await onChanged(); },
    onError: (error) => toast.error(adminError(error)),
  });
  const archive = useMutation({
    mutationFn: async () => {
      if (!isNew) await archiveProductionFacility({ data: { organizationId, facilityId: value.id } });
    },
    onSuccess: async () => { toast.success("Unidade desativada."); await onChanged(); },
    onError: (error) => toast.error(adminError(error)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{isNew ? "Nova unidade" : "Editar unidade"}</DialogTitle><DialogDescription>Unidades separam dados operacionais e escopos de acesso dentro da mesma empresa.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <Field label="Nome da unidade"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Cidade"><Input value={city} onChange={(event) => setCity(event.target.value)} maxLength={120} /></Field><Field label="UF / Estado"><Input value={state} onChange={(event) => setState(event.target.value)} maxLength={80} /></Field></div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div>{!isNew && value.active ? <Button variant="destructive" disabled={archive.isPending} onClick={() => { if (window.confirm("Desativar esta unidade? Usuários diretamente vinculados devem ser removidos ou desativados antes.")) archive.mutate(); }}>Desativar</Button> : null}</div>
          <div className="flex gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={mutation.isPending || name.trim().length < 2} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{isNew ? "Criar unidade" : "Salvar"}</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberDialog({ value, organizationId, facilities, onClose, onChanged }: { value: Member | "new"; organizationId: string; facilities: Facility[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const isNew = value === "new";
  const [name, setName] = useState(isNew ? "" : value.name);
  const [email, setEmail] = useState(isNew ? "" : value.email);
  const [temporaryPassword, setTemporaryPassword] = useState(isNew ? generateTemporaryPassword() : "");
  const [role, setRole] = useState<MemberRole>(isNew ? "inspetor" : normalizeRole(value.role));
  const initialFacility = isNew ? facilities[0]?.id ?? "todas" : value.facilityId ?? "todas";
  const [facilityId, setFacilityId] = useState(initialFacility);
  const [active, setActive] = useState(isNew ? true : value.active);

  const scopedFacility = role === "admin_empresa" ? "todas" : facilityId;
  const roleRequiresFacility = role === "gestor_unidade" || role === "inspetor";
  const validScope = !roleRequiresFacility || scopedFacility !== "todas";
  const mutation = useMutation({
    mutationFn: async () => {
      if (isNew) {
        await createProductionMember({ data: { organizationId, name, email, temporaryPassword, role, facilityId: scopedFacility === "todas" ? null : scopedFacility } });
      } else {
        await updateProductionMember({ data: { organizationId, membershipId: value.id, role, facilityId: scopedFacility === "todas" ? null : scopedFacility, active } });
      }
    },
    onSuccess: async () => { toast.success(isNew ? "Usuário criado e acesso concedido." : "Acesso atualizado."); await onChanged(); },
    onError: (error) => toast.error(adminError(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{isNew ? "Novo usuário" : "Gerenciar acesso"}</DialogTitle><DialogDescription>{isNew ? "Cria uma conta com senha temporária e concede acesso ao escopo escolhido." : "Alterações de perfil e escopo passam a valer nas próximas operações do usuário."}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome"><Input disabled={!isNew} value={name} onChange={(event) => setName(event.target.value)} maxLength={160} /></Field>
            <Field label="E-mail"><Input disabled={!isNew} type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} /></Field>
          </div>
          {isNew ? (
            <Field label="Senha temporária">
              <div className="flex gap-2"><Input type="text" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} minLength={12} maxLength={128} /><Button type="button" variant="outline" onClick={() => setTemporaryPassword(generateTemporaryPassword())}>Gerar</Button></div>
              <p className="mt-1 text-xs text-muted-foreground">Entregue esta senha ao usuário por um canal apropriado e peça que ele a troque em Administração → Segurança. O SiloNR não registra esta senha na trilha de auditoria.</p>
            </Field>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Perfil">
              <Select value={role} onValueChange={(next) => { const normalized = next as MemberRole; setRole(normalized); if (normalized === "admin_empresa") setFacilityId("todas"); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ROLE_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select>
            </Field>
            <Field label="Escopo">
              <Select disabled={role === "admin_empresa"} value={scopedFacility} onValueChange={setFacilityId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{role !== "gestor_unidade" && role !== "inspetor" ? <SelectItem value="todas">Todas as unidades</SelectItem> : null}{facilities.map((facility) => <SelectItem key={facility.id} value={facility.id}>{facility.name}</SelectItem>)}</SelectContent></Select>
            </Field>
          </div>
          {!isNew ? (
            <Field label="Status do acesso">
              <Select value={active ? "ativo" : "inativo"} onValueChange={(next) => setActive(next === "ativo")} disabled={value.isCurrentUser}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ativo">Ativo</SelectItem><SelectItem value="inativo">Desativado</SelectItem></SelectContent></Select>
              {value.isCurrentUser ? <p className="mt-1 text-xs text-muted-foreground">Sua própria conta administrativa não pode ser desativada por esta tela.</p> : null}
            </Field>
          ) : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={mutation.isPending || !validScope || (isNew && (name.trim().length < 2 || !email.includes("@") || temporaryPassword.length < 12))} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{isNew ? "Criar usuário" : "Salvar acesso"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-sm font-medium">{label}</span>{children}</label>;
}

function canAddFacility(data: AdminData) { return !data.license || data.usage.activeFacilities < data.license.maxFacilities; }
function canAddUser(data: AdminData) { return !data.license || data.usage.activeUsers < data.license.maxUsers; }
function normalizeRole(role: string): MemberRole { return role in ROLE_LABELS ? role as MemberRole : "leitor"; }
function roleLabel(role: string) { return role in ROLE_LABELS ? ROLE_LABELS[role as MemberRole] : role; }
function licenseStatus(status: string) { const labels: Record<string, string> = { trial: "Teste", active: "Ativa", suspended: "Suspensa", expired: "Expirada", cancelled: "Cancelada" }; return labels[status] ?? status; }
function formatDate(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value)); }
function Th({ children }: { children: React.ReactNode }) { return <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-3 py-2 text-sm">{children}</td>; }
function Loading({ text }: { text: string }) { return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{text}</div>; }

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function adminError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("LICENSE_USER_LIMIT_REACHED")) return "O limite de usuários da licença foi atingido.";
  if (message.includes("LICENSE_FACILITY_LIMIT_REACHED")) return "O limite de unidades da licença foi atingido.";
  if (message.includes("USER_ACCOUNT_ALREADY_ASSIGNED")) return "Já existe uma conta SiloNR vinculada a outro ambiente com este e-mail. Use outro e-mail ou trate a vinculação com o suporte.";
  if (message.includes("ROLE_REQUIRES_FACILITY")) return "Este perfil precisa ser vinculado a uma unidade específica.";
  if (message.includes("ADMIN_ROLE_MUST_BE_ORGANIZATION_WIDE")) return "Administrador da empresa deve ter escopo de todas as unidades.";
  if (message.includes("SELF_ADMIN_MEMBERSHIP_PROTECTED")) return "Sua própria conta administrativa não pode ser rebaixada ou desativada por esta operação.";
  if (message.includes("LAST_ORGANIZATION_ADMIN_REQUIRED")) return "A empresa precisa manter ao menos um administrador ativo.";
  if (message.includes("FACILITY_HAS_ACTIVE_MEMBERS")) return "Desative ou mova os usuários vinculados diretamente a esta unidade antes de desativá-la.";
  if (message.includes("LAST_FACILITY_REQUIRED")) return "A empresa precisa manter ao menos uma unidade ativa.";
  if (message.includes("INVALID_FACILITY_SCOPE")) return "A unidade escolhida não pertence a esta empresa ou está desativada.";
  return "Não foi possível concluir a operação administrativa.";
}
