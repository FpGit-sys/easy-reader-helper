import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getServerEnv } from "@/server/env";
import * as baseSchema from "./schema";
import * as extensionSchema from "./schema.extensions";

const schema = { ...baseSchema, ...extensionSchema };

let pool: Pool | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

function resolveSsl() {
  const env = getServerEnv();
  const mode = env.DATABASE_SSL_MODE ?? (env.NODE_ENV === "production" ? "verify-full" : "disable");
  return mode === "verify-full" ? { rejectUnauthorized: true } : undefined;
}

export function getPool() {
  if (!pool) {
    const env = getServerEnv();
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.NODE_ENV === "production" ? 20 : 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: resolveSsl(),
    });
  }
  return pool;
}

export function getDb() {
  if (!database) {
    database = drizzle(getPool(), { schema });
  }
  return database;
}
