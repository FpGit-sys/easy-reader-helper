# SiloNR local — implantação do primeiro piloto

Este guia descreve a opção Docker. Para a instalação nativa no Windows, sem WSL nem virtualização, consulte [WINDOWS_NATIVE_DEPLOYMENT.md](./WINDOWS_NATIVE_DEPLOYMENT.md). O instalador nativo é pré-piloto e possui um gate Windows próprio; não migre dados reais sem validar um restore.

Esta opção roda toda a plataforma em um computador-servidor da empresa e atende os demais computadores pela rede local. Não exige domínio, VPS ou Internet para o uso diário. O mesmo computador pode abrir o SiloNR Desktop e também hospedar os serviços.

## Modelo e limites

- PostgreSQL, aplicação e storage ficam em uma rede Docker interna.
- Somente HTTPS nas portas 443 (aplicação) e 9443 (arquivos) é publicado no IP privado fixo.
- Caddy emite uma autoridade certificadora exclusiva da instalação. Distribua apenas o certificado público aos PCs autorizados; nunca copie a chave privada do volume Docker.
- Não encaminhe 443/9443 no roteador e não exponha o servidor diretamente à Internet.
- Sem VPN, computadores fora da empresa não acessam o servidor. Trabalho de campo continua pelo modo offline e sincroniza ao voltar à LAN.
- Se o computador-servidor estiver desligado, os demais PCs não sincronizam nem acessam a parte online.

## Requisitos

Use um equipamento dedicado quando houver vários usuários: 4 núcleos, 8 GB de RAM, SSD com espaço para as evidências, Windows 11 Pro com WSL2/Docker Desktop ou Linux atual. Configure IP reservado no roteador, energia protegida e um disco externo ou NAS para backup.

## Instalação

1. Copie `deploy/local/.env.example` para `deploy/local/.env`.
2. Mantenha `SILONR_LOCAL_SERVER=silonr.local`, defina `SILONR_LOCAL_BIND_IP` com o IPv4 privado fixo e gere credenciais diferentes, com pelo menos 24 caracteres aleatórios.
3. Aponte `LOCAL_BACKUP_DIR` para disco externo/NAS e restrinja o arquivo `.env` ao administrador.
4. Execute:

```bash
sudo bash ./ops/local-deploy.sh
sudo bash ./ops/local-bootstrap.sh
```

5. Em cada Windows autorizado, copie `deploy/local/silonr-local-ca.crt` e execute PowerShell como Administrador:

```powershell
.\scripts\install-local-ca.ps1 -CertificatePath .\deploy\local\silonr-local-ca.crt -ServerAddress 192.168.1.50
```

6. No Desktop, informe `https://silonr.local`, teste a conexão e faça o pareamento. No Firewall do servidor, permita TCP 443 e 9443 somente no perfil Privado e somente para a sub-rede local.

## Backup e restauração

Agende o monitor a cada cinco minutos e o backup ao final de cada dia. O monitor grava um estado simples no diretório de backup e retorna erro se aplicação, storage, containers ou espaço em disco não estiverem saudáveis:

```bash
bash ./ops/local-monitor.sh
```

Mantenha uma cópia de backup desconectada do computador-servidor:

```bash
sudo bash ./ops/local-backup.sh
```

O pacote contém dump PostgreSQL em formato custom, snapshot dos objetos, checksums e manifesto. Teste a restauração primeiro em outra instalação. A restauração substitui banco e bucket do destino e exige confirmação explícita:

```bash
sudo LOCAL_RESTORE_CONFIRM=RESTORE_SILONR_LOCAL \
  ./ops/local-restore.sh /caminho/do/backup
```

## Suporte e diagnóstico

Gere um pacote redigido, sem o `.env`, para análise de suporte:

```bash
sudo bash ./ops/local-diagnostics.sh
```

Revise o arquivo antes de enviá-lo. O pacote inclui estado dos containers, versões, disco e logs recentes com campos sensíveis e e-mails redigidos.

## Atualização e migração futura

Antes de qualquer atualização, faça backup e guarde o instalador/commit anterior. Atualize primeiro uma cópia de teste, execute migrations e valide login, inspeção, evidência, sincronização e dossiê. Nunca apague o diretório de dados do Desktop durante a troca do instalador.

A migração para VPS ou serviço gerenciado reutiliza o mesmo pacote: restaure o `database.dump` em PostgreSQL, copie `objects/` para o bucket privado, configure os novos endpoints HTTPS e só então altere o endereço nos Desktops. IDs, auditoria, rascunhos e evidências permanecem preservados; a migração deve ser ensaiada e validada antes do corte.

## Licença mensal

Depois que a instalação local estiver saudável, configure a ativação mensal seguindo [`LICENSING.md`](LICENSING.md). O Supabase/Asaas recebe apenas metadados de licença e pagamento; dados operacionais continuam nesta stack local.
