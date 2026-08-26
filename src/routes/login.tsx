import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { getSession } from "@/server/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const session = await getSession().catch(() => null);
    if (session) throw redirect({ to: "/app/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Entrar — SiloNR" },
      {
        name: "description",
        content: "Acesso seguro ao SiloNR.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const result = await authClient.signIn.email({ email, password, rememberMe });
      if (result.error) {
        setError("E-mail ou senha inválidos, ou acesso ainda não liberado.");
        return;
      }
      await navigate({ to: "/app/dashboard", replace: true });
    } catch {
      setError("Não foi possível acessar o servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-muted/30 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden border-r border-border bg-card p-12 lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="text-xl font-semibold tracking-tight">
          SiloNR
        </Link>
        <div className="max-w-lg">
          <p className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-primary">
            <ShieldCheck className="size-4" /> Acesso operacional protegido
          </p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Documentos, inspeções e ações com rastreabilidade por unidade.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Entre com a conta fornecida durante a implantação. O acesso é limitado à empresa,
            unidade e permissões atribuídas ao seu usuário.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          O SiloNR é ferramenta de apoio à gestão. Não substitui responsável técnico, auditoria ou
          fiscalização oficial.
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LockKeyhole className="size-5" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold tracking-tight">Entrar no SiloNR</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use as credenciais vinculadas à sua organização.
          </p>

          <form onSubmit={submit} className="mt-7 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="nome@empresa.com.br"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={12}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                className="size-4 rounded border-border"
              />
              Manter sessão neste dispositivo
            </label>

            {error ? (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Entrando…" : "Entrar"}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            A criação de usuários é controlada pelo administrador da empresa durante a implantação.
          </p>
        </div>
      </section>
    </main>
  );
}
