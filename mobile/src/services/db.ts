import * as SQLite from 'expo-sqlite';
import { ChatMessage, FileOffer } from '../types/network';

const DB_NAME = 'taklan.db';

class DatabaseService {
  private db: SQLite.SQLiteDatabase | null = null;

  async init(): Promise<void> {
    try {
      this.db = await SQLite.openDatabaseAsync(DB_NAME);
      await this.db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          sender_id TEXT NOT NULL,
          sender_hostname TEXT DEFAULT '',
          sender_nick TEXT DEFAULT '',
          sender_ip TEXT DEFAULT '',
          target_id TEXT DEFAULT '',
          target_hostname TEXT DEFAULT '',
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS file_transfers (
          transfer_id TEXT PRIMARY KEY,
          sender_id TEXT NOT NULL,
          sender_hostname TEXT DEFAULT '',
          sender_nick TEXT DEFAULT '',
          sender_ip TEXT DEFAULT '',
          target_id TEXT DEFAULT '',
          target_hostname TEXT DEFAULT '',
          file_name TEXT NOT NULL,
          file_size INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'offered',
          save_path TEXT DEFAULT '',
          timestamp INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS peers (
          id TEXT PRIMARY KEY,
          nickname TEXT DEFAULT '',
          ip TEXT DEFAULT '',
          hostname TEXT DEFAULT '',
          joined_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
        CREATE INDEX IF NOT EXISTS idx_messages_target ON messages(target_id);
        CREATE INDEX IF NOT EXISTS idx_file_transfers_timestamp ON file_transfers(timestamp);
      `);
      console.log('[DB] Database initialised');
    } catch (err) {
      console.error('[DB] Init error:', err);
    }
  }

  async saveMessage(msg: ChatMessage): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.runAsync(
        `INSERT OR IGNORE INTO messages
           (id, sender_id, sender_hostname, sender_nick, sender_ip, target_id, target_hostname, content, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        msg.id,
        msg.senderId,
        msg.senderHostname ?? '',
        msg.senderNick,
        msg.senderIp,
        msg.targetId,
        msg.targetHostname ?? '',
        msg.content,
        msg.timestamp,
      );
    } catch (err) {
      console.warn('[DB] saveMessage error:', err);
    }
  }

  async saveFileOffer(offer: FileOffer): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.runAsync(
        `INSERT OR IGNORE INTO file_transfers
           (transfer_id, sender_id, sender_hostname, sender_nick, sender_ip, target_id, target_hostname,
            file_name, file_size, status, save_path, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'offered', ?, ?)`,
        offer.transferId,
        offer.senderId,
        offer.senderHostname ?? '',
        offer.senderNick,
        offer.senderIp,
        offer.targetId,
        offer.targetHostname ?? '',
        offer.fileName,
        offer.fileSize,
        offer.savePath ?? '',
        offer.timestamp,
      );
    } catch (err) {
      console.warn('[DB] saveFileOffer error:', err);
    }
  }

  async updateFileStatus(transferId: string, status: string, savePath?: string): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.runAsync(
        `UPDATE file_transfers SET status = ?, save_path = COALESCE(NULLIF(?, ''), save_path) WHERE transfer_id = ?`,
        status,
        savePath ?? '',
        transferId,
      );
    } catch (err) {
      console.warn('[DB] updateFileStatus error:', err);
    }
  }

  async savePeer(id: string, nickname: string, ip: string, hostname: string, joinedAt: number): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO peers (id, nickname, ip, hostname, joined_at) VALUES (?, ?, ?, ?, ?)`,
        id, nickname, ip, hostname, joinedAt,
      );
    } catch (err) {
      console.warn('[DB] savePeer error:', err);
    }
  }

  /**
   * Retrieves up to `limit` messages for a conversation, before a given timestamp cursor.
   * For the General channel pass targetId = '' and targetHostname = ''.
   * Returns messages in ascending timestamp order (oldest → newest).
   */
  async getMessages(
    targetId: string,
    targetHostname: string,
    myId: string,
    myHostname: string,
    beforeTimestamp?: number,
    limit: number = 100,
  ): Promise<ChatMessage[]> {
    if (!this.db) return [];
    try {
      const before = beforeTimestamp ?? Date.now() + 1;
      let rows: any[];

      if (!targetId && !targetHostname) {
        rows = await this.db.getAllAsync(
          `SELECT * FROM messages
           WHERE (target_id = '' OR target_id = 'general' OR target_hostname = '' OR target_hostname = 'general')
             AND timestamp < ?
           ORDER BY timestamp DESC LIMIT ?`,
          before, limit,
        );
      } else {
        const tId = targetId || '';
        const tHost = targetHostname || targetId || '';
        const mId = myId || '';
        const mHost = myHostname || myId || '';

        rows = await this.db.getAllAsync(
          `SELECT * FROM messages
           WHERE timestamp < ?
             AND (
               (
                 (sender_id = ? OR (sender_hostname != '' AND sender_hostname = ?))
                 AND (target_id = ? OR target_id = ? OR (target_hostname != '' AND (target_hostname = ? OR target_hostname = ?)))
               )
               OR
               (
                 (sender_id = ? OR sender_id = ? OR (sender_hostname != '' AND (sender_hostname = ? OR sender_hostname = ?)))
                 AND (target_id = ? OR target_id = '' OR (target_hostname != '' AND target_hostname = ?))
               )
             )
           ORDER BY timestamp DESC LIMIT ?`,
          before,
          mId, mHost,
          tId, tHost, tId, tHost,
          tId, tHost, tId, tHost,
          mId, mHost,
          limit,
        );
      }

      return rows.reverse().map((r: any) => ({
        id: r.id,
        senderId: r.sender_id,
        senderHostname: r.sender_hostname || undefined,
        senderNick: r.sender_nick,
        senderIp: r.sender_ip,
        targetId: r.target_id,
        targetHostname: r.target_hostname || undefined,
        content: r.content,
        timestamp: r.timestamp,
      }));
    } catch (err) {
      console.warn('[DB] getMessages error:', err);
      return [];
    }
  }

  /**
   * Retrieves up to `limit` file offers for a conversation, before a given timestamp cursor.
   * Returns items in ascending timestamp order (oldest → newest).
   */
  async getFileOffers(
    targetId: string,
    targetHostname: string,
    myId: string,
    myHostname: string,
    beforeTimestamp?: number,
    limit: number = 100,
  ): Promise<FileOffer[]> {
    if (!this.db) return [];
    try {
      const before = beforeTimestamp ?? Date.now() + 1;
      let rows: any[];

      if (!targetId && !targetHostname) {
        rows = await this.db.getAllAsync(
          `SELECT * FROM file_transfers
           WHERE (target_id = '' OR target_id = 'general' OR target_hostname = '' OR target_hostname = 'general')
             AND timestamp < ?
           ORDER BY timestamp DESC LIMIT ?`,
          before, limit,
        );
      } else {
        const tId = targetId || '';
        const tHost = targetHostname || targetId || '';
        const mId = myId || '';
        const mHost = myHostname || myId || '';

        rows = await this.db.getAllAsync(
          `SELECT * FROM file_transfers
           WHERE timestamp < ?
             AND (
               (
                 (sender_id = ? OR (sender_hostname != '' AND sender_hostname = ?))
                 AND (target_id = ? OR target_id = ? OR (target_hostname != '' AND (target_hostname = ? OR target_hostname = ?)))
               )
               OR
               (
                 (sender_id = ? OR sender_id = ? OR (sender_hostname != '' AND (sender_hostname = ? OR sender_hostname = ?)))
                 AND (target_id = ? OR target_id = '' OR (target_hostname != '' AND target_hostname = ?))
               )
             )
           ORDER BY timestamp DESC LIMIT ?`,
          before,
          mId, mHost,
          tId, tHost, tId, tHost,
          tId, tHost, tId, tHost,
          mId, mHost,
          limit,
        );
      }

      return rows.reverse().map((r: any) => ({
        transferId: r.transfer_id,
        senderId: r.sender_id,
        senderHostname: r.sender_hostname || undefined,
        senderNick: r.sender_nick,
        senderIp: r.sender_ip,
        targetId: r.target_id,
        targetHostname: r.target_hostname || undefined,
        fileName: r.file_name,
        fileSize: r.file_size,
        status: r.status,
        savePath: r.save_path || undefined,
        timestamp: r.timestamp,
      }));
    } catch (err) {
      console.warn('[DB] getFileOffers error:', err);
      return [];
    }
  }
}

export const db = new DatabaseService();
