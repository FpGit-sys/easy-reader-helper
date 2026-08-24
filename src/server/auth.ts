import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getPool } from "@/server/db/client";
import { getServerEnv } from "@/server/env";

function createAuthInstance() {
  const env = getServerEnv();

  return betterAuth({
    database: getPool(),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !env.ALLOW_PUBLIC_SIGNUP,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
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
}

type AuthInstance = ReturnType<typeof createAuthInstance>;
let instance: AuthInstance | null = null;

/**
 * Authentication is intentionally lazy so static builds and demo tooling do not
 * need production secrets. The first production auth request validates env vars.
 */
export function getAuth(): AuthInstance {
  instance ??= createAuthInstance();
  return instance;
}
