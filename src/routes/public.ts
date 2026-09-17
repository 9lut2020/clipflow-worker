import { Hono } from "hono";
import { createDb } from "@clipflow/db";

type PublicVars = { db: ReturnType<typeof createDb> };

export const publicRouter = new Hono<{
  Bindings: { VAPID_PUBLIC_KEY?: string };
  Variables: PublicVars;
}>();

/**
 * GET /api/public/push/vapid-key
 * Returns VAPID public key for Web Push subscriptions.
 * Public — no auth required (VAPID public key is not secret).
 */
publicRouter.get("/push/vapid-key", async (c: any) => {
  if (!c.env?.VAPID_PUBLIC_KEY) {
    return c.json(
      { status: "error", message: "Web Push is not configured", data: null },
      503,
    );
  }
  return c.json({
    status: "success",
    message: "VAPID public key retrieved",
    data: c.env.VAPID_PUBLIC_KEY,
  });
});
