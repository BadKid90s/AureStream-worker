import type { Context, Next } from "hono"
import { verifyJWT } from "../utils/crypto.js"
import type { Env, AppVariables } from "../config/index.js"

export async function requireAuth(c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) {
  const header = c.req.header("Authorization")
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "missing_authorization" }, 401)
  }
  const secret = c.env.JWT_SECRET
  const payload = await verifyJWT(header.slice(7), secret)
  if (!payload) {
    return c.json({ error: "invalid_token" }, 401)
  }
  c.set("userId", payload.sub as string)
  c.set("userEmail", payload.email as string)
  await next()
}
