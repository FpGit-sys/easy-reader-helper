# SiloNR — servidor Windows nativo

Status: pré-piloto. Use somente o artefato de uma execução **verde** de `SiloNR Windows Native Server`. O gate instala o pacote em Windows, testa HTTPS, login, arquivos privados, backup/restore, atualização e desinstalação. Ainda é necessário um piloto acompanhado em máquina real e assinatura Authenticode antes da distribuição comercial ampla.

## O que muda e o que permanece

O instalador reúne o aplicativo Desktop, PostgreSQL 16, Node, Caddy e serviços Windows. Cria o atalho **SiloNR** na Área de Trabalho e abre o sistema em uma janela própria, sem navegador externo. Não exige Docker, WSL, Hyper-V, virtualização de BIOS, Bun, Git ou ferramentas de desenvolvimento no cliente. A stack Docker continua disponível, sem alterações de dados automáticas.

Permanecem PostgreSQL, IDs, isolamento entre empresas/unidades, auditoria, cliente Desktop/offline, licenças assinadas e integração Supabase/Asaas. Só o servidor consulta a central de licenças. Inspeções, usuários, documentos e fotos continuam locais. Não altere as chaves de assinatura da central nem regenere o lote de licenças para usar esta versão.

Os arquivos privados passam a ficar no disco, com os mesmos caminhos de objetos e SHA-256, acessíveis por URLs HTTPS assinadas e temporárias. A aplicação continua verificando o escopo do usuário antes de emitir essas URLs. Links não exigem cookies, portanto não os compartilhe. Banco e API escutam apenas em loopback; só HTTPS/443 é liberado na rede privada local.

## 1. Preparação do dono do software

1. Use Windows 11 x64 atualizado, conta administradora, SSD, pelo menos 8 GB de RAM e energia protegida. O pacote é x64; Windows ARM não é um alvo validado.
2. Reserve o IPv4 do servidor no roteador e deixe a conexão Windows no perfil Privado. Não abra portas no roteador. Não é necessário comprar domínio.
3. Escolha uma pasta de backup fora das pastas do SiloNR. Prefira disco externo **NTFS criptografado** com letra fixa. O agendamento SYSTEM não usa unidades de rede mapeadas; NAS exige configuração específica de conta e não é automatizado neste pacote.
4. Separe `LICENSE_SERVICE_URL`, `LICENSE_CLIENT_API_KEY` e `LICENSE_SIGNING_PUBLIC_KEY` já configurados para sua central. A URL termina em `/functions/v1`.
5. Não coloque no instalador ou PC do cliente `ASAAS_API_KEY`, token do webhook, `service_role` ou `LICENSE_SIGNING_PRIVATE_KEY`. Nunca grave credenciais reais no Git.

O instalador gera automaticamente senha do PostgreSQL, segredo de sessão, segredo de URLs de arquivos e `LICENSE_INSTALLATION_ENCRYPTION_KEY` exclusiva. Reparo/atualização reutilizam esses valores.

O runtime Microsoft Visual C++ necessário ao PostgreSQL é incluído e instalado se ausente/desatualizado. Ele pode pedir uma reinicialização normal do Windows; isso não envolve BIOS ou virtualização. O pacote também instala o Microsoft WebView2 para todos os usuários se estiver ausente. Essa etapa usa o bootstrapper assinado pela Microsoft e precisa de Internet; não instala nem abre um navegador externo. O runtime WebView2 compartilhado não é removido ao desinstalar o SiloNR.

## 2. Instalar o servidor

1. Em GitHub → Actions → **SiloNR Windows Native Server**, abra uma execução concluída com sucesso e baixe o artefato `SiloNR-Servidor-Windows-Nativo`. Extraia o ZIP de transporte do GitHub.
2. Execute `SiloNR-Servidor-Setup-0.2.2.exe` normalmente e autorize a elevação quando o Windows solicitar. Assim a abertura ao concluir pode voltar à conta original, mesmo quando outra conta administradora autoriza o UAC. Enquanto não houver assinatura de código, o Windows poderá alertar sobre editor desconhecido: confira a origem antes de executar; não desative a proteção do sistema.
3. O assistente pede IP reservado, pasta de backup, os três valores de licenciamento, nome/e-mail/senha inicial do administrador, empresa e unidade. A senha deve ter 12–128 caracteres.
4. Aguarde a configuração. Não desligue o PC. O instalador configura serviços, banco, migrações, primeiro administrador, certificado local, hosts, firewall e backup diário às 21h (horário do PC). Se o PC estiver desligado, a tarefa tenta executar quando disponível.
5. Na conclusão, mantenha **Abrir SiloNR** marcado ou use o atalho **SiloNR** da Área de Trabalho. A tela de login abre dentro do aplicativo, já apontando para o servidor local. Faça login e use a tela de licença mensal na administração para ativar a **chave legível correspondente à licença paga**. Não use o hash nem o UUID como chave de ativação.
6. Valide uma inspeção e um upload, ative o Desktop e execute um backup/restauração de teste antes de colocar dados reais.

O PC servidor já fica pronto como estação de trabalho, sem um segundo instalador. O menu Iniciar também inclui **Abrir SiloNR**, **SiloNR - modo offline** e **Administrar servidor**. O atalho principal abre o sistema local; o atalho de modo offline abre a interface empacotada de pareamento e inspeções. A ativação de licença não substitui o pareamento para baixar dados offline. O aplicativo preserva o banco offline e a configuração por usuário Windows; abrir o sistema local não sobrescreve um pareamento existente. Os demais computadores dependem do servidor ligado para sincronizar. O acesso por `https://silonr.local` no navegador permanece opcional.

Se o servidor ainda estiver iniciando, o Desktop mantém a interface local e mostra um aviso. Use **Abrir online** para tentar novamente ou trabalhe offline se já houver um pacote autorizado. Fechar a janela não para o servidor. O atalho nunca contém chaves ou senhas.

A versão 0.2.1 abre o formulário de primeira instalação à frente e vinculado ao instalador. A barra cheia significa que os arquivos foram copiados, não que o servidor está pronto: a tela muda para **Configurando o servidor SiloNR** até o processo terminar. Uma janela PowerShell também pode ficar visível durante essa etapa; não a feche. Em reparos com configuração já gravada, o formulário não é repetido. Execuções silenciosas sem configuração prévia falham explicitamente em vez de aguardar uma janela oculta.

## 3. Conectar outros PCs

No menu Iniciar → SiloNR → **Administrar servidor**, abra a pasta de conexão. Copie **somente** `C:\ProgramData\SiloNR\conectar-outros-pcs` para o PC autorizado, mantendo todos os arquivos juntos.

Execute `Conectar-SiloNR.cmd`, autorize como administrador e conclua o instalador Desktop. O script instala o certificado público, configura `silonr.local` e testa HTTPS. No Desktop, informe `https://silonr.local`, teste e conclua o pareamento existente. Esse pareamento não é automatizado pelo conector.

Abra o conector na conta Windows que usará o Desktop. Somente o ajuste de certificado/hosts solicita elevação; a instalação Desktop fica na conta original, mesmo quando outra conta administradora autoriza o UAC.

O certificado público é seguro para distribuir aos PCs autorizados; a pasta `caddy`, os backups e os arquivos de configuração **não são** pacotes de conexão. Se houver um mapeamento `silonr.local` conflitante, o script para e pede correção; não sobrescreve outra instalação silenciosamente.

## 4. Localização e segurança

| Conteúdo                                  | Local                                   |
| ----------------------------------------- | --------------------------------------- |
| Binários e ferramentas                    | `C:\Program Files\SiloNR Server`        |
| Configurações e segredos locais           | `C:\ProgramData\SiloNR\config`          |
| Banco PostgreSQL                          | `C:\ProgramData\SiloNR\data\postgres`   |
| Documentos e evidências privados          | `C:\ProgramData\SiloNR\data\evidencias` |
| Autoridade TLS, incluindo chaves privadas | `C:\ProgramData\SiloNR\caddy`           |
| Logs operacionais                         | `C:\ProgramData\SiloNR\logs`            |

Aplicação e Caddy usam `LocalService`; PostgreSQL usa `NetworkService`. Os diretórios sensíveis recebem ACLs restritas. Administradores do computador continuam tendo acesso aos dados: proteja conta, disco e backups. Não envie logs brutos sem revisão; o diagnóstico do gerenciador contém apenas versão, serviços, espaço em disco e estado da tarefa de backup.

## 5. Backup e restauração

Use o gerenciador no menu Iniciar para **Backup agora**, **Restaurar backup** e **Diagnóstico**. O backup pausa brevemente aplicação/HTTPS para manter dump e objetos consistentes; banco continua ligado. Avise usuários e prefira fora do expediente.

Cada backup é uma **pasta** `SiloNR-...`, com `database.dump`, `objects`, `tls`, `recovery.json` e `manifest.json` com SHA-256. Não selecione o ZIP do instalador na restauração. O backup inclui chaves necessárias para recuperar licenças cifradas, sessões e certificados, portanto use disco criptografado, acesso restrito e uma cópia desconectada. Checksums detectam corrupção, não comprovam a origem: restaure apenas backups confiáveis.

A restauração exige confirmação, verifica os arquivos, cria um backup de segurança antes de substituir o banco e preserva diretórios antigos como `*.before-restore-*`. Depois verifica os hashes das evidências contra o banco. Se falhar, mantém a aplicação parada para evitar uso de estado parcial. Há cópias para recuperação assistida; não é prometido rollback automático.

Não há exclusão automática de backups ou diretórios antigos nesta primeira versão. Acompanhe espaço disponível e defina retenção com cópias validadas. Não apague cópias de segurança antes de testar a recuperação.

A tarefa `SiloNR Monitor` confere serviços, prontidão e espaço a cada cinco minutos, registrando `C:\ProgramData\SiloNR\monitor.json`. Retorna erro se um serviço estiver indisponível ou algum disco usado tiver menos de 5 GB livres. Não envia alertas externos. Backup/restore/monitor são serializados para evitar operações simultâneas.

Em novo servidor, após restaurar um backup nativo, execute o instalador novamente para atualizar confiança no certificado e o pacote de conexão. O IP continua sendo o escolhido para o novo servidor.

## 6. Migrar dados da stack Docker existente

Não é preciso migrar se você só configurou licenças no Supabase e ainda não possui dados operacionais locais. Instale e ative a mesma licença normalmente, respeitando os limites de instalações.

Se já possui dados no Docker:

1. Gere um backup com `ops/local-backup.sh` e preserve também o `deploy/local/.env` original em local protegido. O backup antigo não contém a chave de criptografia da instalação.
2. Extraia o pacote em uma pasta protegida, preservando `manifest.txt`, `SHA256SUMS`, `database.dump` e `objects`.
3. Instale o servidor nativo em um destino de teste e pare a operação antiga durante a migração final.
4. No PowerShell elevado, execute (substitua somente os dois caminhos):

```powershell
& 'C:\Program Files\SiloNR Server\tools\Maintenance.ps1' -Action Restore -BackupPath 'D:\Migracao\backup-extraido' -LegacyEnvironment 'D:\Migracao\env-original' -Confirmation RESTORE_SILONR_WINDOWS
```

O importador reaproveita dump, objetos e chaves da instalação original. Não reaproveita o certificado Docker; distribua o certificado novo do servidor Windows. Compare registros, anexos, login, licença e sincronização. Só desative definitivamente a origem depois de validar esses itens. Não remova volumes Docker automaticamente. A importação legada exige um ensaio com backup real antes da migração de produção.

A ida futura para VPS continua possível com PostgreSQL e os mesmos objetos. Não há nesta versão um assistente de exportação para S3: essa transferência precisa reconstruir metadados MIME e validar hashes, além de configurar o novo destino.

## 7. Atualizar, reparar e desinstalar

Execute o novo instalador sobre o existente. Antes de substituir binários ele faz backup e para os serviços. Usa as mesmas chaves e não repete o primeiro cadastro. Troca de versão principal PostgreSQL não é automática. Não altere manualmente a pasta de banco nem regenere segredos para reparar falhas.

Ao atualizar de 0.2.1 para 0.2.2, não desinstale nem apague pastas: o aplicativo e os atalhos são acrescentados à instalação existente. Feche o Desktop antes de atualizar; o instalador pode solicitar o fechamento se o executável estiver em uso. Ele não força o encerramento. Uma instalação Desktop NSIS/MSI feita separadamente continua independente e não é removida automaticamente.

Se houve queda de energia na primeira instalação, execute novamente o mesmo instalador. A configuração pendente fica protegida para permitir retomada e é removida após sucesso. Um bootstrap incompleto que não possa ser retomado com segurança para e pede recuperação, sem apagar dados.

Desinstalar remove serviços, regra de firewall, tarefa e binários. **Não apaga** banco, anexos, configuração, certificados nem backups. A entrada hosts e a confiança no certificado local também não são removidas automaticamente. Retire-as manualmente apenas quando nenhum cliente depender mais dessa instalação.

## Build e critérios de entrega

O workflow empacota Node 22, PostgreSQL 16.15, Caddy 2.10.2 e WinSW 2.12.0. Downloads de PostgreSQL/Caddy/WinSW têm SHA-256 fixado. O Desktop é compilado do mesmo checkout. Não execute `Build.ps1` em máquinas de clientes; ele é ferramenta de engenharia.

O gate Windows abre o instalador interativo, verifica se o formulário e seus dez campos estão visíveis acima da janela principal, verifica o aviso de validação e cancela sem reportar sucesso falso. Publica uma captura do formulário vazio no artefato `SiloNR-Wizard-Visibility`. Também testa instalação silenciosa em banco vazio, recusa de configuração ausente, contas dos serviços, TLS, login, cadastro público fechado, download com assinatura válida/inválida, backup, restauração após corrupção de arquivo, estabilidade das chaves em atualização e preservação de dados na desinstalação. O conjunto unitário testa armazenamento, hash, links, traversal e expiração. Diferentes resoluções/escalas de tela, Windows 10 real, duas máquinas LAN, queda real de energia, ativação Asaas/Supabase real e recuperação de backup legado devem ser verificados no piloto. O novo gate não substitui os gates existentes de isolamento/offline/licenciamento.

O gate também abre o Desktop pelos atalhos reais e confirma a janela nativa. Depois reabre o mesmo executável e argumentos com instrumentação exclusiva do CI; Playwright conectado ao WebView2 verifica login dentro do aplicativo, aviso com servidor indisponível e acesso à interface offline. Capturas ficam em `SiloNR-Desktop-Unificado`. A depuração não é ativada no produto ou nos atalhos instalados. Backup/reparo/desinstalação verificam a preservação do banco offline por usuário. O bootstrapper WebView2 é validado por Authenticode; testar sua instalação em Windows 10 sem esse runtime continua sendo parte do piloto.
