package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type PeerRecord struct {
	Hostname string `json:"hostname"`
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	IP       string `json:"ip"`
	IsHost   bool   `json:"isHost"`
	LastSeen int64  `json:"lastSeen"`
}

type MessageRecord struct {
	ID             string `json:"id"`
	SenderID       string `json:"senderId"`
	SenderHostname string `json:"senderHostname"`
	SenderNick     string `json:"senderNick"`
	SenderIP       string `json:"senderIp"`
	TargetHostname string `json:"targetHostname"` // "" for public channel, Hostname for private
	Content        string `json:"content"`
	Timestamp      int64  `json:"timestamp"`
}

type FileOfferRecord struct {
	TransferID     string `json:"transferId"`
	SenderID       string `json:"senderId"`
	SenderHostname string `json:"senderHostname"`
	SenderNick     string `json:"senderNick"`
	SenderIP       string `json:"senderIp"`
	TargetHostname string `json:"targetHostname"`
	FileName       string `json:"fileName"`
	FileSize       int64  `json:"fileSize"`
	Status         string `json:"status"` // "offered", "completed", "rejected", "failed"
	SavePath       string `json:"savePath"`
	Timestamp      int64  `json:"timestamp"`
}

type Database struct {
	db *sql.DB
	mu sync.Mutex
}

func InitDB() (*Database, error) {
	exePath, err := os.Executable()
	var dbDir string
	if err == nil && exePath != "" {
		dbDir = filepath.Dir(exePath)
	} else {
		appDataDir, err := os.UserConfigDir()
		if err != nil || appDataDir == "" {
			appDataDir = "."
		}
		dbDir = filepath.Join(appDataDir, "taklan")
	}

	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return nil, err
	}

	dbPath := filepath.Join(dbDir, "history.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database at %s: %w", dbPath, err)
	}

	if _, err := db.Exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;"); err != nil {
		// Ignore if PRAGMA fails
	}

	d := &Database{db: db}
	if err := d.createTables(); err != nil {
		return nil, err
	}

	return d, nil
}

func (d *Database) createTables() error {
	createPeersTable := `
	CREATE TABLE IF NOT EXISTS peers (
		hostname TEXT PRIMARY KEY,
		id TEXT NOT NULL,
		nickname TEXT NOT NULL,
		ip TEXT NOT NULL,
		is_host INTEGER NOT NULL,
		last_seen INTEGER NOT NULL
	);`

	createMessagesTable := `
	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		sender_id TEXT NOT NULL,
		sender_hostname TEXT NOT NULL,
		sender_nick TEXT NOT NULL,
		sender_ip TEXT NOT NULL,
		target_hostname TEXT NOT NULL,
		content TEXT NOT NULL,
		timestamp INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_messages_target_hostname ON messages(target_hostname);
	CREATE INDEX IF NOT EXISTS idx_messages_sender_hostname ON messages(sender_hostname);
	CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
	`

	createFileTransfersTable := `
	CREATE TABLE IF NOT EXISTS file_transfers (
		transfer_id TEXT PRIMARY KEY,
		sender_id TEXT NOT NULL,
		sender_hostname TEXT NOT NULL,
		sender_nick TEXT NOT NULL,
		sender_ip TEXT NOT NULL,
		target_hostname TEXT NOT NULL,
		file_name TEXT NOT NULL,
		file_size INTEGER NOT NULL,
		status TEXT NOT NULL,
		save_path TEXT NOT NULL DEFAULT '',
		timestamp INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_file_transfers_target_hostname ON file_transfers(target_hostname);
	CREATE INDEX IF NOT EXISTS idx_file_transfers_sender_hostname ON file_transfers(sender_hostname);
	`

	if _, err := d.db.Exec(createPeersTable); err != nil {
		return fmt.Errorf("failed to create peers table: %w", err)
	}
	if _, err := d.db.Exec(createMessagesTable); err != nil {
		return fmt.Errorf("failed to create messages table: %w", err)
	}
	if _, err := d.db.Exec(createFileTransfersTable); err != nil {
		return fmt.Errorf("failed to create file_transfers table: %w", err)
	}

	return nil
}

func (d *Database) UpsertPeer(hostname, id, nickname, ip string, isHost bool) error {
	if hostname == "" {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()

	isHostInt := 0
	if isHost {
		isHostInt = 1
	}

	query := `
	INSERT INTO peers (hostname, id, nickname, ip, is_host, last_seen)
	VALUES (?, ?, ?, ?, ?, ?)
	ON CONFLICT(hostname) DO UPDATE SET
		id = excluded.id,
		nickname = excluded.nickname,
		ip = excluded.ip,
		is_host = excluded.is_host,
		last_seen = excluded.last_seen;
	`
	_, err := d.db.Exec(query, hostname, id, nickname, ip, isHostInt, time.Now().UnixMilli())
	return err
}

func (d *Database) GetKnownPeers() ([]PeerRecord, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	query := `SELECT hostname, id, nickname, ip, is_host, last_seen FROM peers ORDER BY last_seen DESC`
	rows, err := d.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []PeerRecord
	for rows.Next() {
		var p PeerRecord
		var isHostInt int
		if err := rows.Scan(&p.Hostname, &p.ID, &p.Nickname, &p.IP, &isHostInt, &p.LastSeen); err != nil {
			continue
		}
		p.IsHost = (isHostInt != 0)
		result = append(result, p)
	}
	return result, nil
}

func (d *Database) SaveMessage(msg MessageRecord) error {
	if msg.ID == "" {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()

	query := `
	INSERT OR IGNORE INTO messages (id, sender_id, sender_hostname, sender_nick, sender_ip, target_hostname, content, timestamp)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?);
	`
	_, err := d.db.Exec(query, msg.ID, msg.SenderID, msg.SenderHostname, msg.SenderNick, msg.SenderIP, msg.TargetHostname, msg.Content, msg.Timestamp)
	return err
}

func (d *Database) GetMessages(targetHostname, targetID, myHostname, myID string, beforeTimestamp int64, limit int) ([]MessageRecord, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	var query string
	var args []interface{}

	if targetHostname == "" && targetID == "" {
		if beforeTimestamp > 0 {
			query = `SELECT id, sender_id, sender_hostname, sender_nick, sender_ip, target_hostname, content, timestamp 
			         FROM messages 
			         WHERE (target_hostname = '' OR target_hostname = 'general') AND timestamp < ?
			         ORDER BY timestamp DESC LIMIT ?`
			args = []interface{}{beforeTimestamp, limit}
		} else {
			query = `SELECT id, sender_id, sender_hostname, sender_nick, sender_ip, target_hostname, content, timestamp 
			         FROM messages 
			         WHERE target_hostname = '' OR target_hostname = 'general'
			         ORDER BY timestamp DESC LIMIT ?`
			args = []interface{}{limit}
		}
	} else {
		if beforeTimestamp > 0 {
			query = `SELECT id, sender_id, sender_hostname, sender_nick, sender_ip, target_hostname, content, timestamp 
			         FROM messages 
			         WHERE (( (sender_hostname = ? OR (sender_id != '' AND sender_id = ?))
			                  AND (target_hostname = ? OR target_hostname = ? OR target_hostname = ?) )
			             OR ( (sender_hostname = ? OR sender_hostname = ? OR (sender_id != '' AND (sender_id = ? OR sender_id = ?)))
			                  AND (target_hostname = ? OR target_hostname = ? OR target_hostname = '') ))
			           AND timestamp < ?
			         ORDER BY timestamp DESC LIMIT ?`
			args = []interface{}{
				myHostname, myID, targetHostname, targetID, targetHostname,
				targetHostname, targetID, targetHostname, targetID, myHostname, myID,
				beforeTimestamp, limit,
			}
		} else {
			query = `SELECT id, sender_id, sender_hostname, sender_nick, sender_ip, target_hostname, content, timestamp 
			         FROM messages 
			         WHERE (( (sender_hostname = ? OR (sender_id != '' AND sender_id = ?))
			                  AND (target_hostname = ? OR target_hostname = ? OR target_hostname = ?) )
			             OR ( (sender_hostname = ? OR sender_hostname = ? OR (sender_id != '' AND (sender_id = ? OR sender_id = ?)))
			                  AND (target_hostname = ? OR target_hostname = ? OR target_hostname = '') ))
			         ORDER BY timestamp DESC LIMIT ?`
			args = []interface{}{
				myHostname, myID, targetHostname, targetID, targetHostname,
				targetHostname, targetID, targetHostname, targetID, myHostname, myID,
				limit,
			}
		}
	}

	rows, err := d.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var descResult []MessageRecord
	for rows.Next() {
		var m MessageRecord
		if err := rows.Scan(&m.ID, &m.SenderID, &m.SenderHostname, &m.SenderNick, &m.SenderIP, &m.TargetHostname, &m.Content, &m.Timestamp); err != nil {
			continue
		}
		descResult = append(descResult, m)
	}

	result := make([]MessageRecord, len(descResult))
	for i, item := range descResult {
		result[len(descResult)-1-i] = item
	}
	return result, nil
}

func (d *Database) SaveFileOffer(offer FileOfferRecord) error {
	if offer.TransferID == "" {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()

	query := `
	INSERT INTO file_transfers (transfer_id, sender_id, sender_hostname, sender_nick, sender_ip, target_hostname, file_name, file_size, status, save_path, timestamp)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(transfer_id) DO UPDATE SET
		status = excluded.status,
		save_path = CASE WHEN excluded.save_path != '' THEN excluded.save_path ELSE file_transfers.save_path END;
	`
	_, err := d.db.Exec(query, offer.TransferID, offer.SenderID, offer.SenderHostname, offer.SenderNick, offer.SenderIP, offer.TargetHostname, offer.FileName, offer.FileSize, offer.Status, offer.SavePath, offer.Timestamp)
	return err
}

func (d *Database) UpdateFileStatus(transferID string, status string, savePath string) error {
	if transferID == "" {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()

	query := `
	UPDATE file_transfers 
	SET status = ?, 
	    save_path = CASE 
			WHEN ? != '' AND ? NOT LIKE 'content://%' THEN ? 
			ELSE save_path 
		END
	WHERE transfer_id = ?;
	`
	_, err := d.db.Exec(query, status, savePath, savePath, savePath, transferID)
	return err
}

func (d *Database) GetFileOffers(targetHostname, targetID, myHostname, myID string, beforeTimestamp int64, limit int) ([]FileOfferRecord, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	var query string
	var args []interface{}

	if targetHostname == "" && targetID == "" {
		if beforeTimestamp > 0 {
			query = `SELECT transfer_id, sender_id, sender_hostname, sender_nick, sender_ip, target_hostname, file_name, file_size, status, save_path, timestamp 
			         FROM file_transfers 
			         WHERE (target_hostname = '' OR target_hostname = 'general') AND timestamp < ?
			         ORDER BY timestamp DESC LIMIT ?`
			args = []interface{}{beforeTimestamp, limit}
		} else {
			query = `SELECT transfer_id, sender_id, sender_hostname, sender_nick, sender_ip, target_hostname, file_name, file_size, status, save_path, timestamp 
			         FROM file_transfers 
			         WHERE target_hostname = '' OR target_hostname = 'general'
			         ORDER BY timestamp DESC LIMIT ?`
			args = []interface{}{limit}
		}
	} else {
		if beforeTimestamp > 0 {
			query = `SELECT transfer_id, sender_id, sender_hostname, sender_nick, sender_ip, target_hostname, file_name, file_size, status, save_path, timestamp 
			         FROM file_transfers 
			         WHERE (( (sender_hostname = ? OR (sender_id != '' AND sender_id = ?))
			                  AND (target_hostname = ? OR target_hostname = ? OR target_hostname = ?) )
			             OR ( (sender_hostname = ? OR sender_hostname = ? OR (sender_id != '' AND (sender_id = ? OR sender_id = ?)))
			                  AND (target_hostname = ? OR target_hostname = ? OR target_hostname = '') ))
			           AND timestamp < ?
			         ORDER BY timestamp DESC LIMIT ?`
			args = []interface{}{
				myHostname, myID, targetHostname, targetID, targetHostname,
				targetHostname, targetID, targetHostname, targetID, myHostname, myID,
				beforeTimestamp, limit,
			}
		} else {
			query = `SELECT transfer_id, sender_id, sender_hostname, sender_nick, sender_ip, target_hostname, file_name, file_size, status, save_path, timestamp 
			         FROM file_transfers 
			         WHERE (( (sender_hostname = ? OR (sender_id != '' AND sender_id = ?))
			                  AND (target_hostname = ? OR target_hostname = ? OR target_hostname = ?) )
			             OR ( (sender_hostname = ? OR sender_hostname = ? OR (sender_id != '' AND (sender_id = ? OR sender_id = ?)))
			                  AND (target_hostname = ? OR target_hostname = ? OR target_hostname = '') ))
			         ORDER BY timestamp DESC LIMIT ?`
			args = []interface{}{
				myHostname, myID, targetHostname, targetID, targetHostname,
				targetHostname, targetID, targetHostname, targetID, myHostname, myID,
				limit,
			}
		}
	}

	rows, err := d.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var descResult []FileOfferRecord
	for rows.Next() {
		var f FileOfferRecord
		if err := rows.Scan(&f.TransferID, &f.SenderID, &f.SenderHostname, &f.SenderNick, &f.SenderIP, &f.TargetHostname, &f.FileName, &f.FileSize, &f.Status, &f.SavePath, &f.Timestamp); err != nil {
			continue
		}
		descResult = append(descResult, f)
	}

	result := make([]FileOfferRecord, len(descResult))
	for i, item := range descResult {
		result[len(descResult)-1-i] = item
	}
	return result, nil
}

func (d *Database) Close() error {
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}
