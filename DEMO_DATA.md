# DEMO_DATA.md — Dados demonstrativos

**Todos os dados descritos aqui são fictícios.** Empresa, endereço, silos, documentos, pessoas,
inspeções, evidências e critérios foram criados apenas para demonstração do SiloNR. Nenhum item
representa uma organização real, um documento real ou uma exigência legal real.

## Unidade

- Unidade Armazenadora Santa Rita (fictícia)
- Rio Verde — GO (fictício)
- Usuário demonstrativo: **Gestor Demo**

## Silos

| Silo | Status | Índice interno |
| --- | --- | --- |
| Silo 01 | Bom | 91% |
| Silo 02 | Atenção | 83% |
| Silo 03 | Crítico | 48% |
| Silo 04 | Atenção | 76% |
| Silo 05 | Bom | 88% |

Silo 03 concentra o cenário de risco da demonstração: última inspeção interna há 124 dias contra
periodicidade interna cadastrada de 90 dias, evidência obrigatória ausente, documento relacionado
vencido e ação corretiva atrasada.

## Critérios internos

- 52 itens de verificação, exatamente
- 37 atendidos internamente
- 11 pendentes
- 4 críticos
- Índice: 37 / 52 = 71,1538% → exibido como **71%**

Categorias utilizadas: Documentação, Registros, Inspeções, Treinamentos, Emergência, Equipamentos,
Manutenção, Acesso, Sinalização, Evidências, Procedimentos internos, Ações corretivas.

Todos os itens usam `fonteTipo = CRITÉRIO INTERNO DEMONSTRATIVO` e
`fonteNome = Critério fictício para demonstração`. Nenhum número de Norma Regulamentadora foi
inventado ou associado a esses itens.

## Documentos

- 3 documentos vencidos
- 5 documentos vencendo em até 30 dias
- Demais válidos ou sem validade informada

## Pessoas fictícias

Responsáveis demonstrativos (nomes fictícios) usados em pendências, documentos e ações corretivas,
entre eles Carlos Mendes, associado à pendência NC crítica do Silo 03.

## Persistência e reset

Os dados são gerados por `src/data/demo/demoData.ts` e gravados no armazenamento local do
navegador. O botão **Restaurar demonstração** (banner de todas as páginas internas e em
Configurações) recria o conjunto original.
