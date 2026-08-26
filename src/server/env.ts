import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DEPLOYMENT_MODE: z.enum(["cloud", "local"]).default("cloud"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória."),
  DATABASE_SSL_MODE: z.enum(["disable", "verify-full"]).optional(),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET deve ter no mínimo 32 caracteres."),
  ALLOW_PUBLIC_SIGNUP: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  S3_ENDPOINT: z.string().url().optional().or(z.literal("")),
  S3_PUBLIC_ENDPOINT: z.string().url().optional().or(z.literal("")),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().min(1).default("silonr-private"),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  LICENSE_SERVICE_URL: z.string().url().optional().or(z.literal("")),
  LICENSE_SERVICE_KEY: z.string().optional().default(""),
  LICENSE_SIGNING_PUBLIC_KEY: z.string().optional().default(""),
  LICENSE_INSTALLATION_ENCRYPTION_KEY: z.string().optional().default(""),
  LICENSE_REFRESH_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  SENTRY_DSN: z.string().url().optional().or(z.literal("")),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Configuração de produção inválida:\n${issues.join("\n")}`);
  }

  cached = parsed.data;
  return cached;
}
