# Segurança do SiloNR

O SiloNR processa documentos operacionais, evidências fotográficas, inspeções, pendências e dados de unidades armazenadoras. Esses dados devem ser tratados como privados por padrão.

## Princípios

1. **Isolamento multiempresa** — toda leitura e escrita deve validar `organization_id` e, quando aplicável, `facility_id` no servidor.
2. **Menor privilégio** — permissões são concedidas por função e verificadas no servidor. Esconder um botão na interface nunca é autorização suficiente.
3. **Arquivos privados** — documentos e evidências não devem ter URL pública permanente. O acesso deve ser temporário e autorizado.
4. **Rastreabilidade** — eventos críticos são gravados em `audit_events`. A aplicação não oferece update/delete desses eventos.
5. **Integridade** — versões de documentos e evidências armazenam SHA-256 para detectar substituições de conteúdo.
6. **Segredos fora do código** — senhas, tokens, certificados e chaves devem existir apenas no ambiente/secret manager.
7. **Validação dupla** — entradas relevantes são validadas no cliente por UX e novamente no servidor por segurança.
8. **Sem alegação jurídica automática** — o sistema gerencia prontidão, evidências e critérios; não emite parecer de conformidade legal.

## Perfis iniciais

- `super_admin`: administração da plataforma.
- `admin_empresa`: administração da organização e usuários.
- `gestor_unidade`: operação da unidade.
- `responsavel_tecnico`: revisão técnica e publicação de critérios validados.
- `inspetor`: execução de inspeções e registro de evidências/pendências.
- `leitor`: consulta e geração de dossiê sem alteração operacional.

A matriz efetiva está em `src/server/rbac.ts` e possui testes automatizados.

## Isolamento de tenant

`src/server/access.ts` resolve o acesso usando simultaneamente usuário, organização, unidade, estado ativo da membership e perfil. Operações de produção devem chamar `requirePermission` antes de acessar dados do tenant.

O CI possui um banco PostgreSQL temporário que cria duas organizações independentes e testa, entre outros cenários:

- administrador da Empresa A não acessa a Empresa B mesmo manipulando `organizationId` e `facilityId`;
- usuário limitado à Unidade A1 não acessa A2;
- membership inativa não concede acesso;
- uma permissão válida em um tenant não pode atravessar para outro;
- RBAC é aplicado depois da resolução do tenant.

Esses testes não substituem revisão manual nem pentest, mas tornam regressões de isolamento um bloqueio automático de CI.

## Uploads

O servidor valida tamanho e MIME antes de aceitar qualquer arquivo. A extensão e o `Content-Type` informados pelo navegador são considerados dados não confiáveis. O V1 aceita somente PDF, JPEG, PNG e WebP nos fluxos definidos. Executáveis, scripts e formatos não previstos devem ser rejeitados.

Além do MIME declarado, os bytes são verificados por assinatura de formato antes do armazenamento:

- PDF: presença controlada do cabeçalho `%PDF-` no início do arquivo;
- JPEG: assinatura `FF D8 FF`;
- PNG: assinatura PNG completa de 8 bytes;
- WebP: contêiner `RIFF` com marcador `WEBP`.

Se a assinatura real não corresponder ao MIME declarado, o upload é rejeitado com `FILE_CONTENT_MISMATCH`. Isso bloqueia casos comuns como um executável PE/MZ enviado com nome `.pdf` e `Content-Type: application/pdf`.

Uploads também verificam `Content-Length` antes de materializar `formData()` quando o transporte fornece esse cabeçalho. O proxy/reverse proxy de produção deve possuir limite de corpo equivalente ou mais restritivo, porque requisições HTTP chunked podem não fornecer `Content-Length`.

A verificação de assinatura de arquivo **não é antivírus**. Antes de ambientes corporativos que exijam varredura antimalware, o pipeline de upload deve ganhar quarentena e scanner apropriado antes de liberar o objeto para download.

Após o upload:

- calcular SHA-256;
- armazenar metadados no PostgreSQL;
- armazenar bytes em bucket privado;
- vincular o arquivo à organização/unidade;
- registrar uploader e timestamp;
- entregar download por URL temporária assinada.

## Cabeçalhos HTTP

As respostas do servidor recebem proteções básicas como `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` restritiva e `Cross-Origin-Opener-Policy: same-origin`. Em `NODE_ENV=production`, o servidor também adiciona HSTS.

CSP ainda não é aplicada de forma rígida. TanStack Start pode usar scripts de hidratação inline; uma CSP de produção deve ser implementada com nonce/hash corretamente em vez de liberar `unsafe-inline` ou quebrar hidratação. A ausência temporária dessa política fica explícita para evitar falsa sensação de segurança.

## Trilha de auditoria

Eventos como login administrativo, alteração de critério, publicação de versão, upload/substituição de documento, início/conclusão de inspeção, criação/resolução de pendência e conclusão de ação corretiva devem gerar um evento.

Em produção endurecida, o usuário de banco utilizado pela aplicação deve possuir apenas `INSERT` e `SELECT` em `audit_events`, sem `UPDATE` ou `DELETE`.

## Sessões

- cookies seguros em produção;
- HTTPS obrigatório;
- senha mínima de 12 caracteres no primeiro V1;
- sessões revogáveis;
- recuperação de senha por canal verificado antes do lançamento;
- 2FA disponível antes de clientes que exigirem nível corporativo elevado.

O CI executa também um smoke HTTP do servidor real para confirmar cabeçalhos de segurança e que um upload sem autenticação é rejeitado.

## Desktop

O instalador Windows deve ser assinado antes da distribuição comercial ampla. Builds de teste podem ser não assinados, mas não devem ser apresentados como versão final ao cliente.

O bearer token de dispositivo usado pelo modo offline é protegido no Windows com DPAPI (`CryptProtectData`/`CryptUnprotectData`) antes de ser persistido. O banco SQLite guarda somente a representação protegida, e o pipeline Windows possui teste real de round-trip DPAPI e migração da forma legada que armazenava o token diretamente.

Checklist, respostas e evidências offline ficam no diretório de dados privado da aplicação no perfil do usuário do sistema operacional. O SQLite e os arquivos de evidência **não devem ser descritos como banco criptografado**: a proteção do token não equivale a criptografia integral dos dados locais. Em instalações que exijam proteção de dados em repouso, a implantação deve exigir controles do endpoint, como conta Windows individual, ACLs adequadas e criptografia de volume/dispositivo administrada pela organização.

O workflow de processo Desktop usa Tauri real + WebView + SQLite em Linux para validar perda de conexão, persistência, reinício, reconexão, upload de evidência e conflito. Como DPAPI é específico de Windows, esse build de CI habilita uma feature deliberadamente chamada `ci-insecure-store`, disponível somente em build debug não-Windows. A própria compilação contém `compile_error!` se essa feature for tentada em release. Esse shim não representa proteção de segredo e nunca deve ser distribuído; a segurança da credencial Windows continua sendo validada pelo gate DPAPI separado.

## Vulnerabilidades

Não registrar vulnerabilidades de segurança em issues públicas contendo dados de clientes, tokens, credenciais ou passos que exponham uma instalação real. Revogar imediatamente qualquer segredo que seja acidentalmente versionado.