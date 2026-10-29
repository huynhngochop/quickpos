/** Lưu hàng đợi đơn tiền mặt trong SQLite trên máy (sống qua tắt app, cập nhật app). */
import * as SQLite from 'expo-sqlite';
import type { QueueStore, QueuedSale } from './queue';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync('quickpos.db');
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS cash_queue (
        order_id    TEXT PRIMARY KEY NOT NULL,
        business_id TEXT NOT NULL,
        payload     TEXT NOT NULL,
        sold_at     TEXT NOT NULL,
        attempts    INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'PENDING',
        last_error  TEXT
      );
      CREATE INDEX IF NOT EXISTS cash_queue_sold ON cash_queue (sold_at);
    `);
    return d;
  })();
  return dbPromise;
}

interface Row {
  order_id: string;
  payload: string;
  attempts: number;
  status: 'PENDING' | 'STUCK';
  last_error: string | null;
}

export const sqliteQueueStore: QueueStore = {
  async add(sale) {
    const d = await db();
    // INSERT OR IGNORE: bấm 2 lần cùng mã đơn không tạo 2 dòng
    await d.runAsync(
      'INSERT OR IGNORE INTO cash_queue (order_id, business_id, payload, sold_at, attempts, status, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)',
      sale.orderId,
      sale.businessId,
      JSON.stringify(sale),
      sale.soldAt,
      sale.attempts,
      sale.status,
      sale.lastError,
    );
  },
  async list() {
    const d = await db();
    const rows = await d.getAllAsync<Row>('SELECT order_id, payload, attempts, status, last_error FROM cash_queue ORDER BY sold_at ASC');
    return rows.map((r) => ({ ...(JSON.parse(r.payload) as QueuedSale), attempts: r.attempts, status: r.status, lastError: r.last_error }));
  },
  async remove(orderId) {
    const d = await db();
    await d.runAsync('DELETE FROM cash_queue WHERE order_id = ?', orderId);
  },
  async update(orderId, patch) {
    const d = await db();
    await d.runAsync(
      'UPDATE cash_queue SET attempts = ?, status = ?, last_error = ? WHERE order_id = ?',
      patch.attempts,
      patch.status,
      patch.lastError,
      orderId,
    );
  },
};
