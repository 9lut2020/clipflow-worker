import { and, eq, inArray } from "drizzle-orm";
import { buildPushPayload, type PushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";
import { pushSubscriptions } from "@clipflow/db";

type PushEnv = {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

type PushMessage = {
  title: string;
  body: string;
  url?: string | null;
};

function getVapid(env: PushEnv): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}

export const WebPushService = {
  async sendToUsers({ db, userIds, message, env }: { db: any; userIds: string[]; message: PushMessage; env: PushEnv }) {
    const vapid = getVapid(env);
    if (!vapid || userIds.length === 0) return;

    const subscriptions = await db.query.pushSubscriptions.findMany({
      where: inArray(pushSubscriptions.userId, userIds),
    }).catch(() => []);
    const expiredEndpoints: string[] = [];

    await Promise.all(subscriptions.map(async (subscription: any) => {
      const payload = await buildPushPayload({
        data: JSON.stringify(message),
        options: { ttl: 86400 },
      }, {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      } as PushSubscription, vapid);

      try {
        const response = await fetch(subscription.endpoint, payload);
        if (response.status === 404 || response.status === 410) expiredEndpoints.push(subscription.endpoint);
        if (!response.ok && response.status !== 404 && response.status !== 410) {
          console.error("[WEB PUSH] Provider rejected notification", response.status);
        }
      } catch (error) {
        console.error("[WEB PUSH] Delivery failed", error);
      }
    }));

    if (expiredEndpoints.length > 0) {
      await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, expiredEndpoints)).catch(() => {});
    }
  },

  async sendToRoles({ db, roles, message, env }: { db: any; roles: string[]; message: PushMessage; env: PushEnv }) {
    const recipients = await db.query.users.findMany({
      where: (user: any, operators: any) => and(
        inArray(user.role, roles),
        eq(user.isActive, true),
      ),
      columns: { id: true },
    }).catch(() => []);
    await this.sendToUsers({ db, userIds: recipients.map((user: any) => user.id), message, env });
  },
};
