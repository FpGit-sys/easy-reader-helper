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

A matriz efetiva está em `src/server/rbac.ts` e deve possuir testes automatizados.

## Uploads

O servidor deve validar tamanho e MIME antes de aceitar qualquer arquivo. A extensão informada pelo usuário não é confiável. O V1 aceita somente PDF, JPEG, PNG e WebP nos fluxos definidos. Executáveis, scripts e formatos não previstos devem ser rejeitados.

Após o upload:

- calcular SHA-256;
- armazenar metadados no PostgreSQL;
- armazenar bytes em bucket privado;
- vincular o arquivo à organização/unidade;
- registrar uploader e timestamp;
- entregar download por URL temporária assinada.

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

## Desktop

O instalador Windows deve ser assinado antes da distribuição comercial ampla. Builds de teste podem ser não assinados, mas não devem ser apresentados como versão final ao cliente.

Dados offline sensíveis devem ficar no diretório de dados da aplicação, nunca em pasta pública. A versão desktop deve adotar criptografia/proteção de credenciais usando recursos do sistema operacional e banco local com política de backup e sincronização definida.

## Vulnerabilidades

Não registrar vulnerabilidades de segurança em issues públicas contendo dados de clientes, tokens, credenciais ou passos que exponham uma instalação real. Revogar imediatamente qualquer segredo que seja acidentalmente versionado.
