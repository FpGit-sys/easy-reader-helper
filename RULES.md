# RULES.md — Motor de regras do SiloNR

Todas as regras são funções puras em `src/lib/rules/index.ts`, fora dos componentes de UI.
Nenhuma regra usa IA generativa; todos os resultados são determinísticos e reproduzíveis.

## calculateReadinessIndex(requirements)

Índice de prontidão interna.

- Denominador: critérios aplicáveis (`aplicavel === true` e status diferente de `nao_aplicavel`).
- Numerador: critérios com status `atendido`.
- `percentExato = atendidos / aplicáveis * 100`; a UI exibe `Math.round(percentExato)`.
- Demonstração: 37 / 52 = 71,1538% → exibido como 71%.
- Não há ponderação por criticidade. Qualquer ponderação futura deve ser configurável e explicada.

## runDocumentExpirationRule(doc, janelaDias = 30, ref?)

- Sem validade informada → `sem_validade`
- Validade < hoje → `vencido`
- Validade entre hoje e hoje + janela → `vence_em_breve`
- Caso contrário → `valido`

A janela é configurável em Configurações (padrão 30 dias).

## runMissingEvidenceRule(requirements)

Retorna findings para critérios aplicáveis com `evidenciaObrigatoria = true` e nenhuma evidência
anexada. Severidade `critico` quando a criticidade cadastrada é alta; caso contrário `moderado`.

## runOverdueActionRule(action, ref?)

- Ação com status diferente de `concluida` e prazo anterior a hoje → atrasada.
- `diasAtraso` = dias corridos entre o prazo e hoje.
- Prioridade alta → finding crítico; demais → finding moderado.

## runInspectionDueRule(silo, ref?)

Compara os dias desde a última inspeção interna com a periodicidade cadastrada pela organização.

- `atrasoDias = diasDesdeUltima - periodicidadeInspecaoDias` (mínimo 0).
- Mensagem usada na UI: "Inspeção interna fora da periodicidade cadastrada."
- A periodicidade é sempre um parâmetro interno do usuário, nunca um prazo legal presumido.

## runCriticalRequirementRule(requirements)

Lista critérios aplicáveis com status `critico` como itens que requerem revisão imediata.

## suggestPriority(input)

Prioridade determinística por pontuação:

- Criticidade alta: +3 | média: +1
- Prazo vencido: +2
- Evidência obrigatória ausente: +2
- Documento relacionado vencido: +2

A UI sempre exibe os motivos que compuseram a pontuação. Exemplo: ALTA porque há criticidade alta
+ prazo vencido + evidência obrigatória ausente.

## Linguagem

Nenhuma regra afirma conformidade legal. Os resultados são descritos como "prontidão",
"pendência identificada", "evidência ausente", "item requer revisão" e "referência normativa a
validar".
