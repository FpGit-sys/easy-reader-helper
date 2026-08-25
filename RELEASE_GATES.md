# SiloNR — Gates para Piloto e Venda

Este arquivo é o checklist objetivo usado para decidir quando o SiloNR deixa de ser uma base de produção e pode ser tratado como produto comercial. Um item só fica marcado quando existe evidência executável, workflow verde ou validação manual registrada.

## Gate A — Qualidade da aplicação

- [x] geração de rotas;
- [x] TypeScript sem erro;
- [x] lint sem erro bloqueante;
- [x] testes unitários;
- [x] geração/validação das migrations;
- [x] build web/SSR de produção;
- [x] isolamento cross-tenant em PostgreSQL real;
- [x] HTTP security E2E com autenticação, CSRF/origin, upload e tentativa cross-tenant.

Evidência: workflow `SiloNR CI`.

## Gate B — Backend e dados comerciais

- [x] PostgreSQL/Drizzle;
- [x] autenticação de produção;
- [x] organizações, unidades, usuários e memberships;
- [x] RBAC server-side;
- [x] silos persistidos;
- [x] requisitos versionados e fontes rastreáveis;
- [x] documentos privados e versionados;
- [x] inspeções com snapshot imutável;
- [x] evidências privadas;
- [x] não conformidades e ações corretivas;
- [x] audit trail append-only no fluxo da aplicação;
- [x] dossiê PDF de produção.

## Gate C — Windows/Desktop

- [x] Tauri compila no Windows;
- [x] instalador NSIS `.exe` gerado;
- [x] instalador MSI `.msi` gerado;
- [x] MSI instala silenciosamente em Windows limpo de CI;
- [x] aplicativo instalado por MSI inicia e permanece ativo no smoke test;
- [x] MSI desinstala no smoke test;
- [x] NSIS instala silenciosamente em Windows limpo de CI;
- [x] aplicativo instalado por NSIS inicia e permanece ativo no smoke test;
- [x] NSIS desinstala no smoke test;
- [x] artefatos são publicados apenas quando o smoke de instalação passa;
- [x] token de dispositivo armazenado com Windows DPAPI, com migração de token legado e sem leitura/gravação direta reutilizável em plaintext no SQLite;
- [x] troca/reinstalação de instalador preserva diretório de dados, banco SQLite e sentinel que representa rascunhos/evidências offline pendentes;
- [ ] assinatura Authenticode do instalador/binário para distribuição comercial (ou decisão formal de piloto controlado sem assinatura).

Evidência atual: workflows `SiloNR Windows Desktop` e `SiloNR DPAPI Security`, além de `scripts/windows-installer-smoke.ps1`. O gate DPAPI executa roundtrip real com `CryptProtectData`/`CryptUnprotectData` em runner Windows e compila a biblioteca Tauri.

## Gate D — Offline e sincronização

- [x] pacote offline por organização/unidade/dispositivo;
- [x] SQLite local;
- [x] checklist com versões de requisitos;
- [x] respostas offline;
- [x] evidência fotográfica offline com MIME, tamanho e SHA-256;
- [x] fila persistente/outbox;
- [x] idempotência do protocolo no servidor;
- [x] conflito explícito de revisão em vez de last-write-wins;
- [x] conclusão somente depois de rascunho/evidência aceitos no servidor;
- [x] E2E do protocolo offline contra servidor real de CI com PostgreSQL + MinIO: pareamento, bootstrap, snapshot, replay idempotente, conflito de revisão, upload de foto, replay da evidência, conclusão e criação de não conformidade;
- [x] E2E do processo Tauri/SQLite real → servidor cobrindo o ciclo completo e a retomada após indisponibilidade de rede.

Evidência: workflows `SiloNR Offline Protocol E2E` e `SiloNR Desktop Process E2E`, além dos testes do servidor e do cliente desktop. O processo real Tauri/SQLite passou em três execuções consecutivas cobrindo pareamento, indisponibilidade, persistência, restart, evidência, reconexão, conclusão e conflito.

## Gate E — Continuidade operacional

- [x] runbook `OPERATIONS.md`;
- [x] health checks live/ready;
- [x] logs estruturados com redaction de campos sensíveis;
- [x] script de backup PostgreSQL;
- [x] checksum do backup;
- [x] validação estrutural do archive;
- [x] restore protegido por confirmação explícita;
- [x] drill automatizado: schema real → backup → banco isolado → restore → verificação de sentinel e tabelas;
- [x] procedimento de backup de object storage;
- [ ] teste em staging com o provedor real escolhido para PostgreSQL + storage S3-compatible + HTTPS;
- [ ] monitoramento/alerta real configurado para health checks e erros 5xx.

Evidência atual: workflow `SiloNR Backup Restore Drill` e diretório `ops/`.

## Gate F — Piloto real

- [ ] domínio HTTPS de staging/piloto;
- [ ] PostgreSQL de piloto com backup externo habilitado;
- [ ] bucket privado de piloto com credenciais próprias;
- [ ] organização/unidade real provisionada;
- [ ] usuários reais e perfis revisados;
- [ ] silos reais cadastrados;
- [ ] checklist real validado com responsável competente;
- [ ] fontes externas reais, quando utilizadas, com referência oficial e validação rastreável;
- [ ] fluxo completo executado com usuário de piloto: login → inspeção → evidência → pendência → ação → conclusão → dossiê;
- [ ] restore de backup do piloto testado em ambiente isolado;
- [ ] aceite operacional do primeiro cliente/piloto registrado.

## Gate G — Venda comercial recorrente

- [ ] onboarding repetível documentado;
- [ ] política de suporte/SLA definida no contrato comercial;
- [ ] política de privacidade e tratamento de dados compatível com a implantação;
- [ ] termos/contrato deixam explícito que o SiloNR apoia prontidão, documentação e rastreabilidade e não certifica conformidade legal automaticamente;
- [ ] processo de atualização/rollback validado;
- [ ] processo de revogação de dispositivo/sessão validado;
- [ ] instalação em nova máquina executável sem intervenção de desenvolvimento;
- [ ] checklist de release sem itens críticos pendentes.

## Regra de conclusão

Não marcar o produto como “completo para venda” apenas porque a interface funciona ou porque existe um instalador. Para a conclusão comercial, os gates críticos de segurança, recuperação, instalação, atualização, dados reais e operação precisam estar fechados ou ter uma exceção comercial formal e consciente.
