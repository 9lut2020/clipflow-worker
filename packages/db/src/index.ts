import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export * from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

// A Worker isolate can serve more than one request. Reusing the database
// client avoids rebuilding a Neon pool for every request; no request-specific
// state is retained here. Hyperdrive supplies the production connection string.
const databaseClients = new Map<string, Database>();

export function createDb(databaseUrl: string) {
  const existing = databaseClients.get(databaseUrl);
  if (existing) return existing;

  const database = drizzle(new Pool({ connectionString: databaseUrl }), { schema });
  databaseClients.set(databaseUrl, database);
  return database;
}
