import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { getPool } from "./db/client";
import { getServerEnv } from "./env";

// Maintenance tools have no HTTP request/cookie context or Vite virtual modules.
// Keep the schema-affecting admin plugin identical to the web auth instance.
export function getCliAuth() {
  const env = getServerEnv();
  return betterAuth({
    database: getPool(),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      disableSignUp: !env.ALLOW_PUBLIC_SIGNUP,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] })],
  });
}
