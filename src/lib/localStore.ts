/**
 * Nơi lưu dữ liệu của chế độ "lưu trên máy" (không có máy chủ): SQLite của app.
 * Mỗi dòng dữ liệu là một hàng trong bảng qp_rows → mỗi lần bán chỉ ghi vài hàng (không ghi lại cả kho).
 * Nằm trong vùng riêng của app nên còn nguyên khi cập nhật app; chỉ mất khi gỡ app hoặc xóa dữ liệu app.
 */
import * as SQLite from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import type { RowStoreAdapter } from './demoClient';

const LEGACY_KEY = 'quickpos.local.v1';
const META_KEY = 'quickpos.local.meta';
const LAST_BACKUP_KEY = 'quickpos.lastBackupAt';

let dbh: SQLite.SQLiteDatabase | null = null;
function handle(): SQLite.SQLiteDatabase {
  if (dbh) return dbh;
  dbh = SQLite.openDatabaseSync('quickpos-local.db');
  // WAL: ghi nhanh, đọc không chặn ghi; synchronous NORMAL đủ an toàn cho mất điện (WAL)
  dbh.execSync(
    'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; ' +
      'CREATE TABLE IF NOT EXISTS qp_rows (t TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL, j TEXT NOT NULL, PRIMARY KEY (t, k)); ' +
      'CREATE INDEX IF NOT EXISTS qp_rows_order ON qp_rows (t, n); ' +
      // Kho lưu trữ đơn cũ hơn 13 tháng: không nạp khi mở app, tra theo id / id đơn / quán|ngày
      'CREATE TABLE IF NOT EXISTS qp_archive (t TEXT NOT NULL, k TEXT NOT NULL, o TEXT, d TEXT, j TEXT NOT NULL, PRIMARY KEY (t, k)); ' +
      'CREATE INDEX IF NOT EXISTS qp_archive_o ON qp_archive (t, o); ' +
      'CREATE INDEX IF NOT EXISTS qp_archive_d ON qp_archive (t, d);',
  );
  return dbh;
}

export const rowStore: RowStoreAdapter = {
  loadRows: () => handle().getAllSync<{ t: string; k: string; n: number; j: string }>('SELECT t, k, n, j FROM qp_rows ORDER BY t, n'),
  loadMeta: () => Storage.getItemSync(META_KEY),
  apply({ replace, upsert, meta, archive }) {
    const h = handle();
    h.withTransactionSync(() => {
      if (archive?.length) {
        const put = h.prepareSync('INSERT OR REPLACE INTO qp_archive (t, k, o, d, j) VALUES (?, ?, ?, ?, ?)');
        const del = h.prepareSync('DELETE FROM qp_rows WHERE t = ? AND k = ?');
        try {
          for (const r of archive) {
            put.executeSync([r.t, r.k, r.o, r.d, r.j]);
            del.executeSync([r.t, r.k]);
          }
        } finally {
          put.finalizeSync();
          del.finalizeSync();
        }
      }
      const ins = h.prepareSync('INSERT OR REPLACE INTO qp_rows (t, k, n, j) VALUES (?, ?, ?, ?)');
      try {
        for (const tb of replace) {
          h.runSync('DELETE FROM qp_rows WHERE t = ?', [tb.t]);
          for (const r of tb.rows) ins.executeSync([tb.t, r.k, r.n, r.j]);
        }
        for (const r of upsert) ins.executeSync([r.t, r.k, r.n, r.j]);
      } finally {
        ins.finalizeSync();
      }
    });
    Storage.setItemSync(META_KEY, meta);
  },
  legacyLoad: () => Storage.getItemSync(LEGACY_KEY),
  legacyClear: () => void Storage.removeItemSync(LEGACY_KEY),
  archiveFind: (t, col, v) =>
    handle()
      .getAllSync<{ j: string }>(`SELECT j FROM qp_archive WHERE t = ? AND ${col === 'k' ? 'k' : col === 'o' ? 'o' : 'd'} = ?`, [t, v])
      .map((r) => r.j),
  archiveAll: () => handle().getAllSync<{ t: string; j: string }>('SELECT t, j FROM qp_archive'),
  archiveClear: () => void handle().runSync('DELETE FROM qp_archive', []),
};

export function lastBackupAt(): string | null {
  try {
    return Storage.getItemSync(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

export function markBackedUp(at: string = new Date().toISOString()) {
  try {
    Storage.setItemSync(LAST_BACKUP_KEY, at);
  } catch {
    // không ghi được thì lần sau nhắc lại
  }
}
