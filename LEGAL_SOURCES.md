# LEGAL_SOURCES.md — Política de fontes normativas

## Princípio

O SiloNR **não inventa** obrigações legais. Nenhum item do sistema pode ser apresentado como
exigência de uma Norma Regulamentadora, lei, portaria ou norma técnica sem fonte verificada e
registrada.

No V0 (ambiente demonstrativo) são utilizados **exclusivamente critérios internos demonstrativos**:

- `fonteTipo`: `CRITÉRIO INTERNO DEMONSTRATIVO`
- `fonteNome`: `Critério fictício para demonstração`
- `fonteVerificada`: `false`

A interface exibe "Fonte não validada" e "Critério interno demonstrativo — não constitui requisito
legal" em todos esses itens.

## Requisito para adicionar uma regra normativa real

Antes de qualquer critério ser marcado como **norma externa verificada**, é obrigatório registrar:

1. Nome da norma
2. Órgão emissor
3. Versão
4. Item / seção específica
5. URL oficial
6. Data da consulta
7. Responsável pela validação
8. Data da validação

A validação é aplicada por schema Zod no cadastro de critérios
(`src/components/compliance/NewRequirementForm.tsx`). O formulário rejeita o envio quando o tipo é
"Norma externa verificada" e qualquer campo acima está vazio, ou quando a URL não é uma URL oficial
válida (`http`/`https`).

## Estados possíveis da fonte

| Tipo | Significado | Exibição |
| --- | --- | --- |
| `interno` | Critério definido pela própria organização | "Critério interno" |
| `externa_nao_verificada` | Referência normativa citada mas não conferida | "Fonte não validada" |
| `externa_verificada` | Fonte oficial conferida por pessoa identificada | Nome, órgão, item, URL e validador |

## Limite de responsabilidade

O SiloNR é ferramenta de apoio à gestão. Ele não emite parecer legal, não certifica conformidade e
não substitui responsável técnico, profissional de segurança, consultoria jurídica, auditoria ou
fiscalização oficial.
