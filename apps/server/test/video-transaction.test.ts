import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TibaoDatabase } from "../src/database.js";

test("synchronous transaction helper rejects nested and thenable callbacks and rolls back", () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-video-transaction-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  try {
    database.raw.exec("CREATE TABLE transaction_fixture(value INTEGER NOT NULL)");
    assert.throws(
      () => database.transaction(() => database.transaction(() => 1)),
      /Nested database transactions/,
    );
    assert.throws(
      () => (database.transaction as (callback: () => unknown) => unknown)(() => Promise.resolve(1)),
      /must be synchronous/,
    );
    const count = database.raw.prepare("SELECT COUNT(*) AS count FROM transaction_fixture").get() as {
      count: number;
    };
    assert.equal(count.count, 0);
    assert.equal(
      database.transaction(() => {
        database.raw.prepare("INSERT INTO transaction_fixture(value) VALUES (1)").run();
        return 7;
      }),
      7,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("transaction helper preserves an error that already caused SQLite to roll back", () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-video-auto-rollback-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  try {
    database.raw.exec(`
      CREATE TABLE auto_rollback_fixture(
        value INTEGER NOT NULL UNIQUE ON CONFLICT ROLLBACK
      )
    `);

    assert.throws(
      () => database.transaction(() => {
        database.raw.prepare("INSERT INTO auto_rollback_fixture(value) VALUES (1)").run();
        database.raw.prepare("INSERT INTO auto_rollback_fixture(value) VALUES (1)").run();
      }),
      /UNIQUE constraint failed/,
    );
    const count = database.raw.prepare("SELECT COUNT(*) AS count FROM auto_rollback_fixture").get() as {
      count: number;
    };
    assert.equal(count.count, 0);
    assert.equal(database.transaction(() => 9), 9);

    database.raw.exec("BEGIN");
    assert.throws(
      () => database.transaction(() => 10),
      /cannot start a transaction within a transaction/,
    );
    database.raw.exec("ROLLBACK");
    assert.equal(database.transaction(() => 11), 11);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
