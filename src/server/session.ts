import { getRequestHeaders } from "@tanstack/react-start/server";
import { getAuth } from "@/server/auth";

export async function requireSessionUser() {
  const session = await getAuth().api.getSession({ headers: getRequestHeaders() });
  if (!session?.user?.id) throw new Error("UNAUTHORIZED");
  return session;
}
