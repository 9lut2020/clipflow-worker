import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export * from "./schema";

export function createDb(databaseUrl: string) {
  // Hyperdrive owns the durable pool. A pg client must be scoped to the Worker
  // request; reusing a pg Pool across requests can retain an already-closed
  // Workerd socket and cause intermittent 500 responses.
  return drizzle(new Pool({ connectionString: databaseUrl }), { schema });
}
