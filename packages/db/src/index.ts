import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export * from "./schema";

// Cloudflare Workers enforce strict per-request I/O isolation: a WebSocket
// (Pool) created for request A cannot be reused by request B.  The HTTP
// transport (neon()) avoids this entirely — every query is a stateless fetch,
// so the module-level cache is safe to keep for deduplication without risking
// cross-request I/O conflicts.
const databaseClients = new Map<string, ReturnType<typeof drizzle>>();

export function createDb(databaseUrl: string) {
  const existing = databaseClients.get(databaseUrl);
  if (existing) return existing;

  const sql = neon(databaseUrl);
  const db = drizzle(sql, { schema });
  databaseClients.set(databaseUrl, db);
  return db;
}
