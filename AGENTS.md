# SiloNR engineering guidelines

Este repositório contém o produto SiloNR. Mudanças na branch de produção devem preservar rastreabilidade, isolamento multiempresa e funcionamento offline sempre que aplicável.

## Regras obrigatórias

- Não adicionar alegações automáticas de conformidade legal.
- Regras normativas devem ter fonte, versão e responsável pela validação.
- Nenhum segredo, token, senha ou chave privada deve ser versionado.
- Toda operação sensível deve ser validada no servidor e autorizada por organização/unidade.
- Arquivos de clientes devem permanecer privados e ser acessados por URLs temporárias/assinadas.
- Eventos críticos devem gerar trilha de auditoria.
- Alterações no motor de regras exigem testes.
- Mudanças de schema exigem migration.
- Não usar dados fictícios como fonte de verdade em produção.
- Manter o ambiente demonstrativo explicitamente separado do ambiente de produção.
- Não remover testes para fazer o build passar; corrigir a causa.

## Processo

Trabalhar por pull requests pequenos e revisáveis. Antes de mergear, executar typecheck, lint, testes e build. Para desktop, validar também o build Tauri no Windows.
