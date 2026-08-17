import type { TibaoDatabase } from "../database.js";

// This file intentionally participates in the server typecheck. It keeps the
// synchronous SQLite transaction contract enforceable as the helper evolves.
export function transactionTypeFixture(database: TibaoDatabase): void {
  if (false) {
    // @ts-expect-error async callbacks must never compile for DatabaseSync transactions.
    database.transaction(async () => 1);
  }
}
