# SiloNR

Software B2B para organização de documentos, inspeções, evidências, não conformidades, ações corretivas e preparação para auditorias em unidades armazenadoras e silos.

> O SiloNR é ferramenta de apoio à gestão e à prontidão interna. Não afirma conformidade legal automática, não emite laudo, parecer ou certificação e não substitui responsável técnico, profissional de segurança, consultoria jurídica, auditoria ou fiscalização oficial.

## Estado do projeto

Este repositório contém dois modos deliberadamente separados:

- **Demonstração** (`VITE_ENABLE_DEMO=true`): dados fictícios e persistência local, usada somente para apresentação e validação de UX.
- **Produção** (`VITE_ENABLE_DEMO=false`, padrão): autenticação, PostgreSQL, isolamento multiempresa/multiunidade, RBAC no servidor, storage privado e trilha de auditoria.

A branch `production/silonr-v1` é a linha de engenharia do produto comercial e ainda deve ser tratada como pré-piloto enquanto a PR correspondente estiver em draft.

## Stack de produção

Instalação local: [Windows nativo, sem Docker/WSL (pré-piloto)](./WINDOWS_NATIVE_DEPLOYMENT.md) ou [stack Docker existente](./LOCAL_DEPLOYMENT.md). Ambas preservam PostgreSQL, licenciamento e cliente Desktop; o Windows nativo usa arquivos privados no disco em vez de MinIO.

- React 19 + TypeScript
- TanStack Start / TanStack Router / TanStack Query
- Tailwind CSS + componentes Radix/shadcn
- PostgreSQL
- Drizzle ORM / Drizzle Kit
- Better Auth
- storage S3-compatible (AWS S3, Cloudflare R2, MinIO ou equivalente privado)
- jsPDF para dossiês
- Vitest para testes unitários e de integração
- Tauri 2 para o cliente Windows
- GitHub Actions para quality gate e build dos instaladores

## Domínios já persistidos no servidor

- organizações e unidades;
- memberships, papéis e escopos;
- silos;
- requisitos, versões, fontes e vínculos por silo;
- estado operacional dos requisitos;
- documentos e versões;
- inspeções e snapshots imutáveis do checklist;
- evidências;
- não conformidades;
- ações corretivas;
- eventos de auditoria;
- licenças e dispositivos.

## Segurança

O servidor valida autorização por usuário + organização + unidade + papel antes das operações protegidas. Arquivos ficam privados e são baixados por autorização temporária. Uploads possuem limite de tamanho, allowlist de formatos, verificação de assinatura real dos bytes e SHA-256.

O CI possui um banco PostgreSQL descartável com duas organizações e testa regressões de isolamento entre tenants. Há também smoke HTTP autenticado para confirmar sessão, acesso protegido, bloqueio cross-tenant e rejeição de arquivo executável disfarçado de PDF.

Mais detalhes em [SECURITY.md](./SECURITY.md).

## Ambientes

Copie `.env.example` para um arquivo de ambiente local seguro e substitua todos os valores de desenvolvimento. Nunca versione secrets reais.

Variáveis essenciais de produção incluem:

```text
NODE_ENV=production
APP_URL=https://seu-dominio
DATABASE_URL=postgresql://...
BETTER_AUTH_URL=https://seu-dominio
BETTER_AUTH_SECRET=<segredo forte e exclusivo>
ALLOW_PUBLIC_SIGNUP=false
VITE_ENABLE_DEMO=false
```

Para arquivos privados, configure as variáveis `S3_*` documentadas em `.env.example`.

## Banco de dados

Aplicação:

```sh
bun run db:generate
bun run db:migrate
```

Better Auth usa a mesma instância PostgreSQL, mas mantém suas próprias tabelas. A migração é executada pela versão instalada da biblioteca, sem depender de um CLI `latest` externo:

```sh
bun run auth:migrate
```

Para desenvolvimento local também existe `bun run db:push`; ele não substitui migrations revisadas em uma implantação comercial.

## Primeiro tenant

O cadastro público fica fechado por padrão. Depois de criar o primeiro usuário administrativo no Better Auth, o tenant pode ser provisionado com:

```sh
bun run tenant:provision -- \
  --email admin@cliente.com.br \
  --organization "Cliente Agro" \
  --facility "Unidade Rio Verde" \
  --city "Rio Verde" \
  --state "GO"
```

Esse comando cria organização, unidade, membership administrativa, licença inicial e evento de auditoria. Não armazena a senha do administrador.

## Desenvolvimento e quality gate

```sh
bun install
bun run dev
bun run routes:generate
bun run typecheck
bun run lint
bun run test
bun run build
```

Testes de integração com banco real exigem `DATABASE_URL` apontando para um banco de teste:

```sh
bun run test:integration
```

No GitHub Actions, o quality gate executa automaticamente geração de rotas, TypeScript, lint, testes, validação de migrations e build. Outro job sobe PostgreSQL descartável para validar isolamento multiempresa e os smokes HTTP de segurança.

## Windows / Tauri

A base desktop usa Tauri 2. O workflow Windows já é capaz de produzir instaladores nos formatos:

- NSIS `.exe`
- WiX `.msi`

Build local, em ambiente Windows preparado:

```sh
bun run desktop:build
```

Builds internos podem ser não assinados. Para distribuição comercial ampla, o instalador deverá receber assinatura de código confiável e política de atualização segura.

## Demonstração

O modo demonstrativo continua disponível exclusivamente para apresentação. Ele usa dados fictícios — por exemplo a Unidade Armazenadora Santa Rita — e não deve ser confundido com uma instalação de cliente.

Ative-o explicitamente apenas em ambiente de demonstração:

```text
VITE_ENABLE_DEMO=true
```

Em produção, mantenha `VITE_ENABLE_DEMO=false`.

## Índice de prontidão

O índice simples segue a fórmula `itens atendidos / itens aplicáveis × 100`. Itens não aplicáveis saem do denominador. O indicador representa prontidão interna segundo os critérios cadastrados e não certificação legal.

## Fontes normativas

Nenhuma regra deve ser apresentada como fonte externa verificada sem metadados rastreáveis e validação apropriada. Ver [LEGAL_SOURCES.md](./LEGAL_SOURCES.md).

## Documentos adicionais

- [SECURITY.md](./SECURITY.md) — modelo de segurança e hardening
- [RULES.md](./RULES.md) — regras determinísticas
- [LEGAL_SOURCES.md](./LEGAL_SOURCES.md) — política de fontes
- [ROADMAP.md](./ROADMAP.md) — evolução do produto
- [DEMO_DATA.md](./DEMO_DATA.md) — cenário exclusivamente demonstrativo
