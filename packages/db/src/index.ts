import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export * from "./schema";

// Cloudflare Workers enforce strict per-request I/O isolation: a WebSocket
// (Pool) created for request A cannot be reused by request B.  The HTTP
// transport (neon()) avoids this entirely — every query is a stateless fetch,
// so the module-level cache is safe to keep for deduplication without risking
// cross-request I/O conflicts.
const databaseClients = new Map<string, ReturnType<typeof initDb>>();

function initDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

export function createDb(databaseUrl: string) {
  const existing = databaseClients.get(databaseUrl);
  if (existing) return existing;

  const db = initDb(databaseUrl);
  databaseClients.set(databaseUrl, db);
  return db;
}
