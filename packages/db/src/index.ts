import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export * from "./schema";

export function createDb(databaseUrl: string) {
  // Use Neon's Worker-compatible WebSocket client directly. Unlike the HTTP
  // driver it supports the transactions required by submissions and reviews.
  neonConfig.webSocketConstructor = WebSocket;
  return drizzle(new Pool({ connectionString: databaseUrl }), { schema });
}
