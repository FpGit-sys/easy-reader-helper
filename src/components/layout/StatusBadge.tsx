import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Clock,
  OctagonAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/15 text-warning-foreground border-warning/40",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-info/10 text-info border-info/30",
};

const MAP: Record<string, { tone: Tone; label: string; Icon: typeof CheckCircle2 }> = {
  atendido: { tone: "success", label: "Atendido", Icon: CheckCircle2 },
  pendente: { tone: "warning", label: "Pendente", Icon: Clock },
  critico: { tone: "danger", label: "Crítico", Icon: OctagonAlert },
  nao_aplicavel: { tone: "neutral", label: "Não aplicável", Icon: CircleSlash },
  valido: { tone: "success", label: "Válido", Icon: CheckCircle2 },
  vence_em_breve: { tone: "warning", label: "Vence em breve", Icon: Clock },
  vencido: { tone: "danger", label: "Vencido", Icon: AlertTriangle },
  sem_validade: { tone: "neutral", label: "Sem validade", Icon: CircleDashed },
  bom: { tone: "success", label: "Bom", Icon: CheckCircle2 },
  atencao: { tone: "warning", label: "Atenção", Icon: AlertTriangle },
  aberta: { tone: "warning", label: "Aberta", Icon: Clock },
  em_tratamento: { tone: "info", label: "Em tratamento", Icon: CircleDashed },
  resolvida: { tone: "success", label: "Resolvida", Icon: CheckCircle2 },
  nao_iniciada: { tone: "neutral", label: "Não iniciada", Icon: CircleDashed },
  em_andamento: { tone: "info", label: "Em andamento", Icon: Clock },
  aguardando_evidencia: { tone: "warning", label: "Aguardando evidência", Icon: AlertTriangle },
  concluida: { tone: "success", label: "Concluída", Icon: CheckCircle2 },
  atrasada: { tone: "danger", label: "Atrasada", Icon: OctagonAlert },
  alta: { tone: "danger", label: "Alta", Icon: OctagonAlert },
  media: { tone: "warning", label: "Média", Icon: AlertTriangle },
  baixa: { tone: "neutral", label: "Baixa", Icon: CircleDashed },
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const cfg = MAP[status] ?? { tone: "neutral" as Tone, label: status, Icon: CircleDashed };
  const Icon = cfg.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[cfg.tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label ?? cfg.label}
    </span>
  );
}
