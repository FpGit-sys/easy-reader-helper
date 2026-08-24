import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getPool } from "@/server/db/client";
import { getServerEnv } from "@/server/env";

let instance: ReturnType<typeof betterAuth> | undefined;

/**
 * Authentication is intentionally lazy so static builds and demo tooling do not
 * need production secrets. The first production auth request validates env vars.
 */
export function getAuth() {
  if (instance) return instance;

  const env = getServerEnv();
  instance = betterAuth({
    database: getPool(),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    advanced: {
      useSecureCookies: env.NODE_ENV === "production",
    },
    plugins: [tanstackStartCookies()],
  });

  return instance;
}
