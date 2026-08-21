import { createDb } from "@clipflow/db";

/**
 * Executes a callback within a database transaction.
 * Ensures atomicity for complex operations (e.g. creating user + adding audit log).
 */
export const UserTransaction = {
  async execute<T>(
    db: ReturnType<typeof createDb>,
    callback: (tx: any) => Promise<T>
  ): Promise<T> {
    return await db.transaction(async (tx: any) => {
      return await callback(tx);
    });
  },
};
