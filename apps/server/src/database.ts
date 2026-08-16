import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ImportIssue,
  TaskChannel,
  TaskRecord,
  TaskStatus,
  ValidatedImportRow,
} from "@tibao/core";

type SqlRow = Record<string, unknown>;

export interface ShopPublic {
  id: string;
  name: string;
  shopCipher: string;
  apiConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShopPrivate extends ShopPublic {
  encryptedAccessToken: string;
}

export interface BatchSummary {
  id: string;
  filename: string;
  source: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  createdAt: string;
  counts: Record<string, number>;
}

export interface CreateBatchResult extends BatchSummary {
  invalidDetails: Array<{ sourceRow: number; issues: ImportIssue[] }>;
}

export interface TaskFilters {
  batchId?: string;
  status?: TaskStatus;
  channel?: TaskChannel;
  limit?: number;
}

export interface CompleteTaskInput {
  status: TaskStatus;
  submissionId?: string | null;
  requestId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface CapturedProductInput {
  id: string;
  title: string;
  status: string | null;
  categoryName: string | null;
  brandName: string | null;
  price: number | null;
  currency: string | null;
  stock: number | null;
}

export interface CapturedProduct extends CapturedProductInput {
  shopId: string;
  categoryNames: string[];
  sourceUrl: string;
  capturedAt: string;
  updatedAt: string;
}

export interface UpsertCapturedProductsResult {
  total: number;
  inserted: number;
  updated: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function taskFromRow(row: SqlRow): TaskRecord {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    shopId: String(row.shop_id),
    opportunityId: String(row.opportunity_id),
    productId: String(row.product_id),
    channel: String(row.channel) as TaskChannel,
    status: String(row.status) as TaskStatus,
    attempts: Number(row.attempts),
    errorCode: row.error_code === null ? null : String(row.error_code),
    errorMessage: row.error_message === null ? null : String(row.error_message),
    submissionId: row.submission_id === null ? null : String(row.submission_id),
    requestId: row.request_id === null ? null : String(row.request_id),
    sourceRow: Number(row.source_row),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function shopPublicFromRow(row: SqlRow): ShopPublic {
  return {
    id: String(row.id),
    name: String(row.name),
    shopCipher: String(row.shop_cipher),
    apiConfigured: Boolean(String(row.access_token_encrypted ?? "")),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function capturedProductFromRow(row: SqlRow): CapturedProduct {
  const categoryName = row.category_name === null ? null : String(row.category_name);
  return {
    shopId: String(row.shop_id),
    id: String(row.product_id),
    title: String(row.title),
    status: row.status === null ? null : String(row.status),
    categoryName,
    categoryNames: categoryName ? [categoryName] : [],
    brandName: row.brand_name === null ? null : String(row.brand_name),
    price: row.price === null ? null : Number(row.price),
    currency: row.currency === null ? null : String(row.currency),
    stock: row.stock === null ? null : Number(row.stock),
    sourceUrl: String(row.source_url),
    capturedAt: String(row.captured_at),
    updatedAt: String(row.updated_at),
  };
}

export class TibaoDatabase {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  close(): void {
    this.raw.close();
  }

  private migrate(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS shops (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        shop_cipher TEXT NOT NULL UNIQUE,
        access_token_encrypted TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        source TEXT NOT NULL,
        total_rows INTEGER NOT NULL,
        valid_rows INTEGER NOT NULL,
        invalid_rows INTEGER NOT NULL,
        duplicate_rows INTEGER NOT NULL DEFAULT 0,
        invalid_details_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        shop_id TEXT NOT NULL REFERENCES shops(id),
        opportunity_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        channel TEXT NOT NULL CHECK(channel IN ('api', 'extension')),
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        submission_id TEXT,
        request_id TEXT,
        source_row INTEGER NOT NULL,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(shop_id, opportunity_id, product_id)
      );

      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        event TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS captured_products (
        shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT,
        category_name TEXT,
        brand_name TEXT,
        price REAL,
        currency TEXT,
        stock INTEGER,
        source_url TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(shop_id, product_id)
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_batch_status ON tasks(batch_id, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_channel_status ON tasks(channel, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_lease ON tasks(status, lease_expires_at);
      CREATE INDEX IF NOT EXISTS idx_captured_products_updated
        ON captured_products(shop_id, updated_at DESC);
    `);
  }

  createShop(input: {
    name: string;
    shopCipher?: string;
    encryptedAccessToken?: string;
  }): ShopPublic {
    const timestamp = nowIso();
    const id = randomUUID();
    const shopCipher = input.shopCipher?.trim() || `extension:${id}`;
    const encryptedAccessToken = input.encryptedAccessToken ?? "";
    this.raw
      .prepare(`
        INSERT INTO shops (id, name, shop_cipher, access_token_encrypted, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(shop_cipher) DO UPDATE SET
          name = excluded.name,
          access_token_encrypted = excluded.access_token_encrypted,
          updated_at = excluded.updated_at
      `)
      .run(id, input.name, shopCipher, encryptedAccessToken, timestamp, timestamp);
    const row = this.raw.prepare("SELECT * FROM shops WHERE shop_cipher = ?").get(shopCipher) as SqlRow;
    return shopPublicFromRow(row);
  }

  listShops(): ShopPublic[] {
    return (this.raw.prepare("SELECT * FROM shops ORDER BY created_at DESC").all() as SqlRow[]).map(
      shopPublicFromRow,
    );
  }

  getShop(id: string): ShopPrivate | null {
    const row = this.raw.prepare("SELECT * FROM shops WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) return null;
    return { ...shopPublicFromRow(row), encryptedAccessToken: String(row.access_token_encrypted) };
  }

  upsertCapturedProducts(input: {
    shopId: string;
    sourceUrl: string;
    capturedAt: string;
    products: CapturedProductInput[];
  }): UpsertCapturedProductsResult {
    const products = [...new Map(input.products.map((product) => [product.id, product])).values()];
    if (products.length === 0) return { total: 0, inserted: 0, updated: 0 };
    const placeholders = products.map(() => "?").join(", ");
    const existingRows = this.raw
      .prepare(
        `SELECT product_id FROM captured_products WHERE shop_id = ? AND product_id IN (${placeholders})`,
      )
      .all(input.shopId, ...products.map((product) => product.id)) as SqlRow[];
    const existing = new Set(existingRows.map((row) => String(row.product_id)));
    const timestamp = nowIso();
    const statement = this.raw.prepare(`
      INSERT INTO captured_products (
        shop_id, product_id, title, status, category_name, brand_name,
        price, currency, stock, source_url, captured_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_id, product_id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        category_name = excluded.category_name,
        brand_name = excluded.brand_name,
        price = excluded.price,
        currency = excluded.currency,
        stock = excluded.stock,
        source_url = excluded.source_url,
        captured_at = excluded.captured_at,
        updated_at = excluded.updated_at
    `);
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      for (const product of products) {
        statement.run(
          input.shopId,
          product.id,
          product.title,
          product.status,
          product.categoryName,
          product.brandName,
          product.price,
          product.currency,
          product.stock,
          input.sourceUrl,
          input.capturedAt,
          timestamp,
        );
      }
      this.raw.exec("COMMIT");
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
    const updated = products.filter((product) => existing.has(product.id)).length;
    return { total: products.length, inserted: products.length - updated, updated };
  }

  listCapturedProducts(shopId: string, limit = 200): CapturedProduct[] {
    return (
      this.raw
        .prepare(
          "SELECT * FROM captured_products WHERE shop_id = ? ORDER BY updated_at DESC, product_id LIMIT ?",
        )
        .all(shopId, Math.min(Math.max(limit, 1), 5_000)) as SqlRow[]
    ).map(capturedProductFromRow);
  }

  createBatch(input: {
    filename: string;
    source: string;
    validRows: ValidatedImportRow[];
    invalidRows: Array<{ sourceRow: number; issues: ImportIssue[] }>;
    totalRows: number;
  }): CreateBatchResult {
    const batchId = randomUUID();
    const timestamp = nowIso();
    let inserted = 0;
    let duplicateRows = 0;
    const invalidDetails = [...input.invalidRows];
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      this.raw
        .prepare(`
          INSERT INTO batches (
            id, filename, source, total_rows, valid_rows, invalid_rows,
            duplicate_rows, invalid_details_json, created_at
          ) VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?)
        `)
        .run(
          batchId,
          input.filename,
          input.source,
          input.totalRows,
          input.invalidRows.length,
          JSON.stringify(invalidDetails),
          timestamp,
        );

      const statement = this.raw.prepare(`
        INSERT OR IGNORE INTO tasks (
          id, batch_id, shop_id, opportunity_id, product_id, channel, status,
          attempts, source_row, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ready', 0, ?, ?, ?)
      `);
      for (const row of input.validRows) {
        const result = statement.run(
          randomUUID(),
          batchId,
          row.input.shopId,
          row.input.opportunityId,
          row.input.productId,
          row.input.channel,
          row.input.sourceRow,
          timestamp,
          timestamp,
        );
        if (result.changes > 0) {
          inserted += 1;
        } else {
          duplicateRows += 1;
          invalidDetails.push({
            sourceRow: row.input.sourceRow,
            issues: [
              {
                row: row.input.sourceRow,
                field: "row",
                code: "duplicate",
                message: "该店铺、机会和商品已在历史批次中存在",
              },
            ],
          });
        }
      }
      this.raw
        .prepare(`
          UPDATE batches SET valid_rows = ?, invalid_rows = ?, duplicate_rows = ?, invalid_details_json = ?
          WHERE id = ?
        `)
        .run(inserted, input.invalidRows.length + duplicateRows, duplicateRows, JSON.stringify(invalidDetails), batchId);
      this.raw.exec("COMMIT");
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }

    return {
      id: batchId,
      filename: input.filename,
      source: input.source,
      totalRows: input.totalRows,
      validRows: inserted,
      invalidRows: input.invalidRows.length + duplicateRows,
      duplicateRows,
      createdAt: timestamp,
      counts: inserted ? { ready: inserted } : {},
      invalidDetails,
    };
  }

  listBatches(limit = 50): BatchSummary[] {
    const batches = this.raw
      .prepare("SELECT * FROM batches ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(Math.max(limit, 1), 200)) as SqlRow[];
    const countStatement = this.raw.prepare(
      "SELECT status, COUNT(*) AS count FROM tasks WHERE batch_id = ? GROUP BY status",
    );
    return batches.map((row) => {
      const countRows = countStatement.all(String(row.id)) as SqlRow[];
      return {
        id: String(row.id),
        filename: String(row.filename),
        source: String(row.source),
        totalRows: Number(row.total_rows),
        validRows: Number(row.valid_rows),
        invalidRows: Number(row.invalid_rows),
        duplicateRows: Number(row.duplicate_rows),
        createdAt: String(row.created_at),
        counts: Object.fromEntries(countRows.map((item) => [String(item.status), Number(item.count)])),
      };
    });
  }

  listTasks(filters: TaskFilters = {}): TaskRecord[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filters.batchId) {
      clauses.push("batch_id = ?");
      values.push(filters.batchId);
    }
    if (filters.status) {
      clauses.push("status = ?");
      values.push(filters.status);
    }
    if (filters.channel) {
      clauses.push("channel = ?");
      values.push(filters.channel);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(filters.limit ?? 200, 1), 5_000);
    return (
      this.raw
        .prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC, source_row ASC LIMIT ?`)
        .all(...values, limit) as SqlRow[]
    ).map(taskFromRow);
  }

  getTask(id: string): TaskRecord | null {
    const row = this.raw.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as SqlRow | undefined;
    return row ? taskFromRow(row) : null;
  }

  existingOpportunityIds(shopId: string, productId: string): string[] {
    const rows = this.raw
      .prepare("SELECT opportunity_id FROM tasks WHERE shop_id = ? AND product_id = ?")
      .all(shopId, productId) as SqlRow[];
    return rows.map((row) => String(row.opportunity_id));
  }

  claimNextTask(
    channel: TaskChannel,
    leaseMinutes: number,
    batchId?: string,
    shopId?: string,
  ): TaskRecord | null {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const clauses = ["status = 'ready'", "channel = ?"];
      const parameters: string[] = [channel];
      if (batchId) {
        clauses.push("batch_id = ?");
        parameters.push(batchId);
      }
      if (shopId) {
        clauses.push("shop_id = ?");
        parameters.push(shopId);
      }
      const row = this.raw
        .prepare(
          `SELECT * FROM tasks WHERE ${clauses.join(" AND ")} ORDER BY created_at, source_row LIMIT 1`,
        )
        .get(...parameters) as SqlRow | undefined;
      if (!row) {
        this.raw.exec("COMMIT");
        return null;
      }
      const timestamp = nowIso();
      const lease = new Date(Date.now() + leaseMinutes * 60_000).toISOString();
      const result = this.raw
        .prepare(`
          UPDATE tasks SET status = 'running', attempts = attempts + 1,
            lease_expires_at = ?, updated_at = ?
          WHERE id = ? AND status = 'ready'
        `)
        .run(lease, timestamp, String(row.id));
      if (result.changes === 0) {
        this.raw.exec("ROLLBACK");
        return null;
      }
      this.addEvent(String(row.id), "claimed", { channel });
      const claimed = this.raw.prepare("SELECT * FROM tasks WHERE id = ?").get(String(row.id)) as SqlRow;
      this.raw.exec("COMMIT");
      return taskFromRow(claimed);
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  completeTask(id: string, input: CompleteTaskInput): TaskRecord | null {
    const timestamp = nowIso();
    const result = this.raw
      .prepare(`
        UPDATE tasks SET status = ?, submission_id = COALESCE(?, submission_id),
          request_id = COALESCE(?, request_id), error_code = ?, error_message = ?,
          lease_expires_at = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(
        input.status,
        input.submissionId ?? null,
        input.requestId ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        timestamp,
        id,
      );
    if (result.changes === 0) return null;
    this.addEvent(id, input.status, input);
    return this.getTask(id);
  }

  requeueTask(id: string, detail: { errorCode?: string; errorMessage?: string } = {}): TaskRecord | null {
    const result = this.raw
      .prepare(`
        UPDATE tasks SET status = 'ready', error_code = ?, error_message = ?,
          lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND status IN ('running', 'failed', 'paused', 'rejected')
      `)
      .run(detail.errorCode ?? null, detail.errorMessage ?? null, nowIso(), id);
    if (result.changes === 0) return null;
    this.addEvent(id, "requeued", detail);
    return this.getTask(id);
  }

  setTaskChannel(id: string, channel: TaskChannel): TaskRecord | null {
    const result = this.raw
      .prepare(`
        UPDATE tasks SET channel = ?, status = 'ready', lease_expires_at = NULL,
          error_code = NULL, error_message = NULL, updated_at = ?
        WHERE id = ? AND status IN ('ready', 'failed', 'paused', 'rejected')
      `)
      .run(channel, nowIso(), id);
    if (result.changes === 0) return null;
    this.addEvent(id, "channel_changed", { channel });
    return this.getTask(id);
  }

  resetExpiredLeases(): number {
    const result = this.raw
      .prepare(`
        UPDATE tasks SET status = 'ready', lease_expires_at = NULL,
          error_code = 'LEASE_EXPIRED', error_message = '执行租约超时，任务已自动回队列', updated_at = ?
        WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
      `)
      .run(nowIso(), nowIso());
    return Number(result.changes);
  }

  private addEvent(taskId: string, event: string, detail: unknown): void {
    this.raw
      .prepare("INSERT INTO task_events (task_id, event, detail_json, created_at) VALUES (?, ?, ?, ?)")
      .run(taskId, event, JSON.stringify(detail ?? {}), nowIso());
  }
}
