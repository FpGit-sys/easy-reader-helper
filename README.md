# SiloNR

Software B2B de organização, inspeção, evidências, pendências, documentos e preparação para
auditorias em unidades armazenadoras e silos.

> **Ambiente demonstrativo — dados e critérios fictícios.**

## O que é

O SiloNR reúne em um só lugar o que normalmente fica espalhado entre planilhas, pastas, fotos e
mensagens. Ele responde perguntas como: o que está pendente, quais documentos venceram, quais
evidências faltam, quais ações corretivas estão atrasadas, qual silo concentra mais risco e como
montar rapidamente um dossiê rastreável.

## O que NÃO é

O SiloNR **não** afirma conformidade legal, não emite laudo, parecer ou certificação e **não
substitui** responsável técnico, profissional de segurança, consultoria jurídica, auditoria ou
fiscalização oficial. Ele trabalha com "prontidão", "status documental", "pendência identificada",
"evidência ausente" e "critério cadastrado pela organização".

## Como executar

```sh
npm i
npm run dev     # ambiente de desenvolvimento
npm run build   # build de produção
npm run test    # testes (Vitest)
```

## Arquitetura

```
src/
  components/   layout, tables, compliance, ui (shadcn)
  routes/       rotas (TanStack Router): /, /demo, /app/*
  lib/
    rules/          motor de regras determinístico
    calculations/   derivações para a UI
    reports/        geração do dossiê em PDF
    storage/        estado reativo + persistência local + mutations
    formatting/     datas, rótulos e disclaimers
  data/demo/    gerador do ambiente demonstrativo
  types/        tipos de domínio
  tests/        testes das regras e dos dados demo
```

Rotas principais: `/` (landing), `/demo` (entrada demonstrativa) e `/app/dashboard`, `/app/silos`,
`/app/requirements`, `/app/documents`, `/app/inspections`, `/app/nonconformities`, `/app/actions`,
`/app/evidence`, `/app/dossier`, `/app/history`, `/app/field`, `/app/settings`.

## Bibliotecas

React, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Router/Start, Recharts, Lucide React,
react-hook-form, Zod, date-fns, jsPDF, jspdf-autotable, sonner, Vitest.

## Dados demo

Unidade Armazenadora Santa Rita (fictícia), 5 silos, 52 critérios internos (37 atendidos, 11
pendentes, 4 críticos), documentos vencidos e vencendo, inspeções, pendências e ações. Detalhes em
[DEMO_DATA.md](./DEMO_DATA.md).

## Índice de prontidão

`itens atendidos / itens aplicáveis × 100`. Itens não aplicáveis saem do denominador e não há
ponderação por criticidade. Na demonstração: 37 / 52 = 71,15% → exibido como **71%**. O drawer
"Como este índice é calculado?" explica o cálculo dentro do app.

## Motor de regras

Funções puras, sem IA, documentadas em [RULES.md](./RULES.md): índice de prontidão, vencimento de
documentos, evidência obrigatória ausente, ação corretiva atrasada, inspeção fora da periodicidade
interna, requisito crítico e sugestão determinística de prioridade.

## Persistência

Tudo é gravado no armazenamento local do navegador. Arquivos e fotos permanecem locais e nada é
enviado a servidores, APIs externas ou backends.

## Como resetar

Botão **Restaurar demonstração**, disponível no banner de todas as páginas internas e em
Configurações.

## Fontes normativas

Nenhuma regra legal entra em produção sem fonte verificada. Ver
[LEGAL_SOURCES.md](./LEGAL_SOURCES.md).

## Disclaimer

O SiloNR é uma ferramenta de apoio à gestão de documentos, inspeções, evidências e ações internas.
O software não substitui responsável técnico, profissional de segurança, consultoria jurídica,
auditoria ou fiscalização oficial.

## Roadmap

Ver [ROADMAP.md](./ROADMAP.md).
