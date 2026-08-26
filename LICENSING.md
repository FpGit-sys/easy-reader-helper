# Licenciamento mensal do SiloNR

O SiloNR continua local: PostgreSQL, arquivos, usuários, inspeções e evidências permanecem no computador-servidor do cliente. Somente o servidor local consulta as Edge Functions do Supabase para ativar ou renovar uma concessão. O Desktop e os navegadores da rede local nunca recebem credenciais do Supabase ou do Asaas.

## Fluxo

1. Gere as licenças e importe apenas `key_hash` e os campos comerciais em `software_licenses`.
2. No checkout Asaas, use `silonr-license:<UUID_DA_LICENCA>` em `externalReference` (ou grave o ID da assinatura em `external_subscription_id`).
3. O webhook valida o cabeçalho secreto, busca a cobrança diretamente no Asaas e aplica o evento uma única vez.
4. O administrador digita a chave em **Configurações e administração → Licença mensal**.
5. O servidor local guarda somente o hash da chave, um segredo cifrado e uma concessão assinada.
6. A concessão é atualizada sob demanda. Sem pagamento, o ambiente entra em somente leitura após a carência; consulta, exportação e backup continuam disponíveis.

## 1. Criar o projeto Supabase

Execute a migration `supabase/migrations/20260826000000_licensing.sql` no projeto escolhido e publique:

```bash
supabase functions deploy license-activate --no-verify-jwt
supabase functions deploy license-refresh --no-verify-jwt
supabase functions deploy asaas-webhook --no-verify-jwt
```

As três funções têm `verify_jwt=false` e autenticam explicitamente a chamada: o webhook exige o token exclusivo do Asaas; ativação e atualização exigem `LICENSE_CLIENT_API_KEY`. Isso funciona tanto em projetos Supabase com chaves novas quanto com chaves legadas.

## 2. Gerar as chaves criptográficas

```bash
bun run license:keys
```

O comando imprime quatro valores. Copie-os imediatamente para os locais abaixo e não salve a saída no Git.

| Valor | Onde colocar | Segredo? |
|---|---|---|
| `LICENSE_SIGNING_PRIVATE_KEY` | Supabase → Edge Functions → Secrets | Sim; nunca vai ao cliente |
| `LICENSE_SIGNING_PUBLIC_KEY` | Supabase Secrets **e** `deploy/local/.env` | Não; precisa ser idêntica nos dois lados |
| `LICENSE_CLIENT_API_KEY` | Supabase Secrets **e** `deploy/local/.env` | Sim; autentica somente o servidor local |
| `LICENSE_INSTALLATION_ENCRYPTION_KEY` | `deploy/local/.env` de cada instalação | Sim; use uma diferente por cliente |

## 3. Gerar as licenças

```bash
bun run license:generate -- --count 50 --output license-keys-primeiro-lote.csv
```

O comando cria dois CSVs: o arquivo informado contém as chaves legíveis e deve ir para um cofre; o arquivo terminado em `-supabase.csv` não contém as chaves e é o único que deve ser importado em `software_licenses`. Ambos são ignorados pelo Git.

Uma licença começa como `available`. Após confirmar a compra, o webhook a torna `active` e adiciona um mês. Eventos repetidos não adicionam meses em duplicidade, inclusive quando o Asaas envia `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` para a mesma cobrança.

## 4. Chaves de teste: onde trocar pelas reais

### Supabase Edge Functions

Cadastre os valores de sandbox durante os testes:

```bash
supabase secrets set \
  ASAAS_API_URL=https://api-sandbox.asaas.com/v3 \
  ASAAS_API_KEY='COLE_AQUI_A_CHAVE_DA_CONTA_SANDBOX_ASAAS' \
  ASAAS_WEBHOOK_TOKEN='CRIE_UM_TOKEN_EXCLUSIVO_DE_32_A_255_CARACTERES' \
  LICENSE_CLIENT_API_KEY='GERE_UMA_CHAVE_ALEATORIA_COM_PELO_MENOS_32_CARACTERES' \
  LICENSE_SIGNING_PRIVATE_KEY='COLE_AQUI_A_CHAVE_PRIVADA_GERADA' \
  LICENSE_SIGNING_PUBLIC_KEY='COLE_AQUI_A_CHAVE_PUBLICA_GERADA' \
  LICENSE_ISSUER=silonr-license-service \
  LICENSE_TOKEN_TTL_DAYS=7
```

Na venda real, altere **somente estes valores do Asaas** no mesmo painel/secrets:

| Configuração | Teste | Produção |
|---|---|---|
| `ASAAS_API_URL` | `https://api-sandbox.asaas.com/v3` | `https://api.asaas.com/v3` |
| `ASAAS_API_KEY` | chave API da conta Sandbox | chave API da conta Asaas real |
| `ASAAS_WEBHOOK_TOKEN` | token configurado no webhook Sandbox | novo token exclusivo do webhook de produção |

Não troque o par Ed25519 ao passar para produção se já houver clientes ativados. Uma troca invalida concessões em cache e exige uma estratégia de rotação.

No painel Asaas, configure o webhook como:

- URL: `https://SEU_PROJECT_REF.supabase.co/functions/v1/asaas-webhook`
- Cabeçalho/token: o mesmo `ASAAS_WEBHOOK_TOKEN` salvo nos secrets
- Eventos mínimos: `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED` e `PAYMENT_CHARGEBACK_DISPUTE`

### Servidor local de cada cliente

Copie `deploy/local/.env.example` para `deploy/local/.env` e substitua:

```dotenv
LICENSE_SERVICE_URL=https://SEU_PROJECT_REF.supabase.co/functions/v1
LICENSE_CLIENT_API_KEY=COLE_AQUI_A_MESMA_CHAVE_CLIENTE_SALVA_NOS_SECRETS
LICENSE_SIGNING_PUBLIC_KEY=COLE_AQUI_A_MESMA_CHAVE_PUBLICA_ED25519
LICENSE_INSTALLATION_ENCRYPTION_KEY=COLE_AQUI_UMA_CHAVE_BASE64_DE_32_BYTES_EXCLUSIVA_DO_CLIENTE
```

`LICENSE_CLIENT_API_KEY` é uma chave aleatória própria do SiloNR, não é chave `anon`, `publishable`, `secret` nem `service_role` do Supabase. As chaves administrativas do Supabase, a chave privada Ed25519 e a API key do Asaas nunca entram no computador do cliente.

## 5. Ligar uma licença ao checkout

Antes de abrir o checkout, escolha uma linha `available` e use o UUID `id` dela:

```text
externalReference = silonr-license:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Após o webhook de pagamento, confirme no Supabase que a licença está `active`, tem `valid_until` e `last_payment_id`. Só então entregue a chave legível ao cliente. Não envie a chave em logs, URLs ou descrição pública do pagamento.

## 6. Teste obrigatório antes do primeiro cliente

1. Pague uma cobrança Sandbox e confirme que apenas um mês foi adicionado.
2. Reenvie o mesmo webhook e confirme que `valid_until` não mudou novamente.
3. Ative a chave no SiloNR e clique em **Verificar renovação**.
4. Simule indisponibilidade da internet: o uso segue até `entitlement_expires_at`.
5. Simule expiração/carência: criar ou alterar dados deve falhar com `LICENSE_EXPIRED`; leitura, exportação e backup devem continuar.
6. Confirme que nenhum valor real aparece no Git, logs ou diagnóstico de suporte.

## Recuperação e rotação

- Perda de `LICENSE_INSTALLATION_ENCRYPTION_KEY`: revogue a instalação central e ative novamente; o segredo cifrado antigo não é recuperável.
- Vazamento de `LICENSE_CLIENT_API_KEY`: gere outra, atualize os secrets das funções e depois o `deploy/local/.env` dos clientes.
- Vazamento de `ASAAS_API_KEY` ou `ASAAS_WEBHOOK_TOKEN`: rotacione no Asaas e nos secrets imediatamente.
- Vazamento da chave privada Ed25519: gere novo par, publique a privada, distribua a nova pública e reative cada instalação.
