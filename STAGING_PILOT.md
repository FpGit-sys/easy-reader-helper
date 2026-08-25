# SiloNR — Staging técnico em VPS única

Este guia prepara o primeiro staging/piloto com HTTPS, PostgreSQL, storage privado, backup externo, monitoramento, alertas e restore comprovado. Ele não fecha os gates de ambiente real sozinho: os checks só podem ser marcados depois da execução em uma VPS e do registro das evidências.

## Arquitetura e baseline

Use Ubuntu 24.04 LTS com IP estático e, como ponto de partida, 4 vCPU, 8 GB RAM e 160 GB SSD. Ajuste após medir CPU, memória, disco, latência e crescimento das evidências. Snapshot da VPS ajuda em rollback de infraestrutura, mas não substitui backup externo.

Somente Caddy publica portas 80/443. Aplicação, PostgreSQL e MinIO permanecem na rede Docker interna. SSH deve ser restrito por chave e, quando viável, por IP/VPN.

## 1. Domínio e DNS

1. Adquira um domínio sob uma conta da empresa, com MFA e contato de recuperação.
2. Ative DNSSEC.
3. Crie registros A para `app.<dominio>` e `files.<dominio>` apontando ao IP estático da VPS. Crie AAAA somente se IPv6 estiver configurado e filtrado corretamente.
4. Deixe ambos em modo DNS-only durante a emissão inicial dos certificados. O host de arquivos deve continuar DNS-only para não interferir com URLs S3 assinadas.
5. Defina esses hosts em `SILONR_DOMAIN` e `SILONR_FILES_DOMAIN`.

Caddy obtém e renova TLS automaticamente quando DNS, portas 80/443 e email ACME estão corretos.

## 2. VPS e firewall

1. Crie um usuário administrativo sem login por senha e habilite atualizações de segurança.
2. Instale Docker Engine e Compose pelo repositório oficial.
3. Libere somente TCP 80/443 para a Internet e SSH apenas das origens administrativas.
4. Verifique regras no caminho `DOCKER-USER`: portas publicadas pelo Docker podem contornar regras simples do UFW.
5. Configure NTP, limite de disco e alerta do provedor para CPU, memória e volume.

## 3. Configuração

```bash
git clone <repositorio> /opt/silonr
cd /opt/silonr
git checkout <commit-aprovado>
cp deploy/pilot/.env.example deploy/pilot/.env
chmod 600 deploy/pilot/.env
```

Gere valores exclusivos com `openssl rand -base64 48`. Não reutilize credenciais entre banco, autenticação, MinIO, aplicação e backup.

O backup externo é obrigatório e deve usar outro bucket/conta ou outro provedor, com credencial diferente do storage primário. Configure também um webhook HTTPS de alertas que seja acompanhado pela equipe.

## 4. Subida e validação

```bash
sudo ./ops/pilot-deploy.sh
sudo ./ops/install-pilot-systemd.sh
sudo systemctl start silonr-backup.service
sudo systemctl start silonr-restore-drill.service
```

Valide:

- HTTPS válido e sem aviso nos dois hosts;
- `/api/health/live` e `/api/health/ready` com HTTP 200;
- `/minio/health/live` com HTTP 200 no host de arquivos;
- cadastro público bloqueado;
- nenhum host port para PostgreSQL, MinIO ou aplicação;
- alerta disparado após três falhas e mensagem de recuperação;
- dump e snapshot de objetos presentes no bucket externo;
- arquivo `restore-drill-*.txt` com `status=PASS`.

## 5. Evidências para o gate

Registre data/hora, commit implantado, provedor/região, DNS, certificado, saída redigida do preflight, health checks, teste de alerta, inventário do backup externo e restore drill. Nunca anexe secrets, cookies, tokens, dados pessoais ou URLs assinadas.

Comandos úteis:

```bash
docker compose --env-file deploy/pilot/.env -f docker-compose.pilot.yml ps
journalctl -u silonr-monitor.service --since today
systemctl list-timers 'silonr-*'
ls -l /var/backups/silonr/evidence
```

## 6. Critério de conclusão

O staging técnico está completo somente após pelo menos 24 horas estáveis, alerta firing/recovered comprovado, um backup externo verificado, um restore isolado aprovado e revisão do acesso administrativo. Isso habilita o onboarding do primeiro piloto; não transforma o build em release comercial nem substitui assinatura e validação do fluxo com dados reais.
