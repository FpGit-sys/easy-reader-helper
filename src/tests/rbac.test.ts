import { describe, expect, it } from "vitest";
import { can } from "@/server/rbac";

describe("RBAC de produção", () => {
  it("impede leitor de alterar documentos e requisitos", () => {
    expect(can("leitor", "documents.read")).toBe(true);
    expect(can("leitor", "documents.write")).toBe(false);
    expect(can("leitor", "requirements.write")).toBe(false);
  });

  it("permite inspetor executar inspeções, mas não publicar requisitos", () => {
    expect(can("inspetor", "inspections.execute")).toBe(true);
    expect(can("inspetor", "evidence.write")).toBe(true);
    expect(can("inspetor", "requirements.publish")).toBe(false);
    expect(can("inspetor", "users.manage")).toBe(false);
  });

  it("permite responsável técnico publicar requisitos", () => {
    expect(can("responsavel_tecnico", "requirements.publish")).toBe(true);
    expect(can("responsavel_tecnico", "organization.manage")).toBe(false);
  });

  it("permite administrador da empresa gerenciar usuários, sem administração global", () => {
    expect(can("admin_empresa", "users.manage")).toBe(true);
    expect(can("admin_empresa", "organization.manage")).toBe(false);
  });

  it("mantém gestão de usuários fora dos perfis operacionais", () => {
    expect(can("gestor_unidade", "users.manage")).toBe(false);
    expect(can("responsavel_tecnico", "users.manage")).toBe(false);
    expect(can("inspetor", "users.manage")).toBe(false);
    expect(can("leitor", "users.manage")).toBe(false);
  });

  it("super admin possui permissões globais", () => {
    expect(can("super_admin", "organization.manage")).toBe(true);
    expect(can("super_admin", "users.manage")).toBe(true);
    expect(can("super_admin", "requirements.publish")).toBe(true);
  });
});
