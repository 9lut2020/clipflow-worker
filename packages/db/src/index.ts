import { neon, neonConfig } from "@neondatabase/serverless";
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

/**
 * Local development/testing only: route neon-http queries to a local
 * Neon-compatible HTTP proxy (e.g. local-neon-http-proxy in Docker).
 */
export function useLocalNeonProxy(fetchEndpoint: string) {
  neonConfig.fetchEndpoint = fetchEndpoint;
}

export function createDb(databaseUrl: string) {
  const existing = databaseClients.get(databaseUrl);
  if (existing) return existing;

  const db = initDb(databaseUrl);
  databaseClients.set(databaseUrl, db);
  return db;
}

/**
 * Per-request database over Cloudflare Hyperdrive (pooled TCP via `pg`).
 * A TCP socket belongs to one request, so this is never cached. Workers close
 * the socket when the invocation ends; it is not closed explicitly because
 * notification work scheduled with waitUntil may still be using it.
 *
 * Disable Hyperdrive query caching for this config — cached reads would make
 * writes appear to revert for up to max_age seconds.
 */
export async function createHyperdriveDb(connectionString: string) {
  const [{ Client }, { drizzle: drizzlePg }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
  ]);
  const client = new Client({ connectionString });
  await client.connect();
  // Routes are typed against the neon-http database; the query-builder API
  // they use is identical between the two drivers.
  return drizzlePg(client, { schema }) as unknown as ReturnType<typeof createDb>;
}

/**
 * Runs several statements atomically in as few round trips as the driver
 * allows: neon-http sends them as one HTTP batch (executed in a transaction);
 * pg runs them inside a real transaction.
 *
 * `build` receives the executor to build statements with, so the pg path
 * builds them on the transaction connection.
 */
export async function runBatch<T extends unknown[] = any[]>(
  db: any,
  build: (q: any) => any[],
): Promise<T> {
  if (typeof db.batch === "function") {
    const statements = build(db);
    if (!statements.length) return [] as unknown as T;
    return db.batch(statements as [any, ...any[]]);
  }
  return db.transaction(async (tx: any) => {
    const results: unknown[] = [];
    for (const statement of build(tx)) results.push(await statement);
    return results;
  });
}
