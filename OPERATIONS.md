# SiloNR — Operação de Produção

Este documento é o runbook mínimo para uma instalação comercial do SiloNR. Ele complementa `SECURITY.md` e não substitui a política de segurança/continuidade do cliente.

## 1. Princípios de implantação

Uma instalação real deve usar:

- `NODE_ENV=production`;
- `VITE_ENABLE_DEMO=false`;
- `ALLOW_PUBLIC_SIGNUP=false`;
- HTTPS válido na borda/reverse proxy;
- PostgreSQL com acesso privado, TLS e usuário exclusivo da aplicação;
- bucket S3-compatible privado, sem leitura pública;
- secrets fora do repositório;
- backup em conta/local diferente da produção;
- monitoramento de `/api/health/live` e `/api/health/ready`;
- relógio/NTP correto em aplicação, banco e estações Windows.

Nunca exponha `DATABASE_URL`, `BETTER_AUTH_SECRET`, chaves S3, token de dispositivo ou cookies em logs, tickets ou screenshots.

## 2. Health checks

- `GET /api/health/live`: confirma que o processo HTTP responde.
- `GET /api/health/ready`: confirma banco acessível e configuração mínima do storage privado.

O readiness não faz upload sintético no bucket para evitar criar objetos a cada probe. A disponibilidade real do storage também deve ser monitorada pelo provedor e pelos erros estruturados do SiloNR.

Recomendação inicial:

- liveness a cada 30–60 s;
- readiness a cada 30–60 s;
- alerta após 3 falhas consecutivas;
- alerta também para taxa de HTTP 5xx, latência anormal e falhas de upload/sync.

## 3. Backup PostgreSQL

Use:

```bash
DATABASE_URL='postgresql://...' \
BACKUP_DIR=/var/backups/silonr/postgres \
BACKUP_RETENTION_DAYS=30 \
./ops/backup-postgres.sh
```

O script:

1. usa formato custom do `pg_dump`;
2. valida o arquivo com `pg_restore --list`;
3. gera SHA-256;
4. cria metadados básicos;
5. aplica retenção somente no staging local.

O arquivo local **não é a estratégia completa de backup**. Copie-o para armazenamento separado, criptografado e com credencial diferente da produção.

### Frequência inicial recomendada

Para piloto/primeiras instalações:

- backup completo PostgreSQL diário;
- retenção operacional de 30 dias;
- pelo menos uma cópia externa/isolada;
- teste de restore mensal e antes de mudanças grandes de infraestrutura.

Clientes com RPO/RTO mais rígidos devem usar backup contínuo/PITR do provedor PostgreSQL.

## 4. Backup de evidências/documentos

O bucket privado contém documentos e evidências que não estão dentro do `pg_dump`.

Use um segundo bucket/conta:

```bash
SILONR_PRIMARY_S3_URI='s3://silonr-private' \
SILONR_BACKUP_S3_URI='s3://silonr-backup-prod' \
./ops/backup-object-storage.sh
```

Quando suportado pelo provedor, habilite também:

- versionamento do bucket;
- retenção/imutabilidade (Object Lock) compatível com a política do cliente;
- criptografia em repouso;
- lifecycle somente depois de política de retenção aprovada;
- alertas de exclusões em massa.

A credencial do backup não deve ser a mesma credencial de escrita da aplicação.

## 5. Restore PostgreSQL

Nunca restaure diretamente sobre produção sem uma janela aprovada. Primeiro restaure em banco isolado:

```bash
RESTORE_DATABASE_URL='postgresql://.../silonr_restore_test' \
RESTORE_CONFIRM=RESTORE_SILONR \
./ops/restore-postgres.sh /var/backups/silonr/postgres/silonr-....dump
```

Depois:

1. execute migrations da aplicação;
2. execute migrations Better Auth se necessário;
3. suba a aplicação apontando somente para o banco de restore;
4. valide login, tenant, dashboard, documentos, inspeções, evidências, ações e dossiê;
5. valide hashes/links de arquivos;
6. somente então aprove promoção/failover.

Backup não verificado por restore é considerado backup não comprovado.

## 6. Retenção de dados

O SiloNR não deve apagar automaticamente evidência/audit trail apenas porque passou um número genérico de dias. A retenção depende de contrato, finalidade, obrigações aplicáveis e política do cliente.

Padrão inicial de produto:

- audit trail: preservar durante o contrato e até política aprovada definir o contrário;
- inspeções concluídas: preservar;
- versões de requisitos usadas em inspeção: preservar;
- versões de documentos referenciadas historicamente: preservar;
- evidências vinculadas a inspeção/ação concluída: preservar;
- sessões/tokens revogados: podem seguir retenção técnica curta quando não necessários para auditoria;
- pairing codes expirados e recibos técnicos de sync podem receber retenção técnica menor, desde que isso não prejudique idempotência nem investigação de incidente.

Qualquer rotina automática de purge deve ser criada somente depois de a política do cliente estar formalmente definida.

## 7. Desktop e dados offline

O Desktop guarda somente o conjunto operacional necessário para a unidade ativada e os rascunhos/evidências ainda necessários para trabalho offline.

Regras operacionais:

- dispositivo revogado não pode sincronizar;
- troca de organização/unidade limpa o workspace operacional anterior antes do novo vínculo;
- conflito de revisão nunca é resolvido por “último a gravar vence”;
- arquivo de evidência é re-hasheado antes do upload;
- conclusão offline só é efetivada no servidor depois que rascunho e evidências estiverem confirmados;
- computador perdido deve ter o dispositivo revogado imediatamente no SiloNR online.

O armazenamento local do Windows deve permanecer dentro do perfil do usuário e o cliente deve usar proteção de disco/BitLocker quando a política da organização exigir proteção adicional em repouso.

## 8. Incidentes

Em suspeita de vazamento/roubo de computador/credencial:

1. revogar dispositivo e/ou sessões;
2. trocar credenciais comprometidas;
3. preservar logs e audit trail;
4. identificar organização/unidade/usuários afetados;
5. bloquear chave S3 ou usuário de banco somente se houver indício de comprometimento daquela credencial;
6. restaurar serviço de forma controlada;
7. registrar causa, impacto, ações e prevenção.

Não apague logs para “limpar” o incidente.

## 9. Atualização

Antes de uma atualização comercial:

1. backup PostgreSQL verificado;
2. migrations revisadas;
3. CI verde;
4. security E2E verde;
5. build Windows verde;
6. checksums dos instaladores;
7. teste em Windows limpo;
8. teste de atualização mantendo dados locais pendentes;
9. plano de rollback da aplicação;
10. comunicação da janela ao cliente quando necessária.

Migrations destrutivas não devem ser misturadas com release sem plano explícito de migração/rollback.

## 10. Critério para liberar piloto

O SiloNR só deve ser instalado em unidade piloto quando:

- autenticação e isolamento multiempresa estiverem verdes;
- fluxo inspeção → evidência → não conformidade → ação → dossiê estiver funcional;
- `.exe`/`.msi` do mesmo commit tiverem build verde;
- backup/restore tiverem procedimento definido;
- domínio HTTPS e storage privado estiverem configurados;
- cliente tiver usuários, unidade e checklist reais validados;
- fontes externas reais, quando usadas, tiverem validação rastreável;
- responsável do piloto entender que o indicador é prontidão interna e não certificação automática.


## 11. Staging/piloto em VPS única

O pacote operacional do primeiro staging está documentado em `STAGING_PILOT.md`. Depois de preencher `deploy/pilot/.env`:

```bash
sudo bash ops/pilot-deploy.sh
sudo bash ops/install-pilot-systemd.sh
sudo systemctl start silonr-backup.service
sudo systemctl start silonr-restore-drill.service
```

Os timers executam monitoramento a cada minuto, backup diário e restore isolado semanal. O monitor alerta após três falhas consecutivas e envia recuperação; o backup copia banco e objetos para um bucket externo com credencial separada.

Operação diária:

```bash
systemctl list-timers 'silonr-*'
journalctl -u silonr-monitor.service --since today
journalctl -u silonr-backup.service --since '7 days ago'
ls -l /var/backups/silonr/evidence
```

Falha de backup ou restore é incidente operacional. Não silencie o timer: corrija a causa, execute novamente e preserve a evidência do resultado.
