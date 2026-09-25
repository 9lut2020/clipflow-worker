import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export * from "./schema";

function buildDb(databaseUrl: string) {
  neonConfig.webSocketConstructor = WebSocket;
  return drizzle(new Pool({ connectionString: databaseUrl }), { schema });
}

// Worker isolates may serve multiple requests. Reusing the client avoids
// allocating a new Neon pool for every request while keeping URLs isolated.
const databaseClients = new Map<string, ReturnType<typeof buildDb>>();

export function createDb(databaseUrl: string) {
  const existing = databaseClients.get(databaseUrl);
  if (existing) return existing;

  const db = buildDb(databaseUrl);
  databaseClients.set(databaseUrl, db);
  return db;
}
