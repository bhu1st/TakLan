package network

import (
	"encoding/json"
	"time"
)

// MessageType defines the type of message sent over TCP connection
type MessageType string

const (
	TypeJoin         MessageType = "JOIN"
	TypeJoinAck      MessageType = "JOIN_ACK"
	TypePeerList     MessageType = "PEER_LIST"
	TypeChat         MessageType = "CHAT"
	TypePing         MessageType = "PING"
	TypeNickUpdate   MessageType = "NICK_UPDATE"
	TypeFileOffer    MessageType = "FILE_OFFER"
	TypeFileResponse MessageType = "FILE_RESPONSE"
	TypeFileChunk    MessageType = "FILE_CHUNK"
	TypeFileStatus   MessageType = "FILE_STATUS"
)

// Peer represents a connected client in the LAN network
type Peer struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	IP       string `json:"ip"`
	Hostname string `json:"hostname"`
	IsHost   bool   `json:"isHost"`
	JoinedAt int64  `json:"joinedAt"`
}

// Packet wraps all JSON messages over the TCP stream
type Packet struct {
	Type    MessageType `json:"type"`
	Payload string      `json:"payload"` // JSON serialized payload string
}

// JoinPayload sent when client connects
type JoinPayload struct {
	Peer Peer `json:"peer"`
}

// JoinAckPayload sent by server back to connecting client
type JoinAckPayload struct {
	PeerID string `json:"peerId"`
	Peers  []Peer `json:"peers"`
}

// PeerListPayload sent whenever peers list changes
type PeerListPayload struct {
	Peers []Peer `json:"peers"`
}

// ChatMessagePayload represents a text chat message
type ChatMessagePayload struct {
	ID             string `json:"id"`
	SenderID       string `json:"senderId"`
	SenderHostname string `json:"senderHostname"`
	SenderNick     string `json:"senderNick"`
	SenderIP       string `json:"senderIp"`
	TargetID       string `json:"targetId"`       // Empty for public channel, PeerID for private
	TargetHostname string `json:"targetHostname"` // Empty for public channel, Hostname for private
	Content        string `json:"content"`
	Timestamp      int64  `json:"timestamp"`
}

// PingPayload represents a buzz / ping alert to a user
type PingPayload struct {
	SenderID   string `json:"senderId"`
	SenderNick string `json:"senderNick"`
	SenderIP   string `json:"senderIp"`
	TargetID   string `json:"targetId"` // Target peer ID or empty for global ping
	Timestamp  int64  `json:"timestamp"`
}

// NickUpdatePayload sent when user changes nickname
type NickUpdatePayload struct {
	PeerID      string `json:"peerId"`
	NewNickname string `json:"newNickname"`
}

// FileOfferPayload sent when initiating a file transfer
type FileOfferPayload struct {
	TransferID     string `json:"transferId"`
	SenderID       string `json:"senderId"`
	SenderHostname string `json:"senderHostname,omitempty"`
	SenderNick     string `json:"senderNick"`
	SenderIP       string `json:"senderIp"`
	TargetID       string `json:"targetId"`
	TargetHostname string `json:"targetHostname,omitempty"`
	FileName       string `json:"fileName"`
	FileSize       int64  `json:"fileSize"`
	Timestamp      int64  `json:"timestamp"`
}

// FileResponsePayload sent when recipient accepts or rejects file
type FileResponsePayload struct {
	TransferID  string `json:"transferId"`
	RecipientID string `json:"recipientId"`
	Accepted    bool   `json:"accepted"`
	SavePath    string `json:"savePath,omitempty"`
}

// FileChunkPayload represents a chunk of file data
type FileChunkPayload struct {
	TransferID  string `json:"transferId"`
	ChunkIndex  int    `json:"chunkIndex"`
	TotalChunks int    `json:"totalChunks"`
	DataB64     string `json:"dataB64"`
}

// FileStatusPayload reports progress or completion
type FileStatusPayload struct {
	TransferID string  `json:"transferId"`
	Status     string  `json:"status"`   // "transferring", "completed", "rejected", "failed"
	Progress   float64 `json:"progress"` // 0 to 100
	SavePath   string  `json:"savePath,omitempty"`
	Error      string  `json:"error,omitempty"`
}

func CurrentTimestamp() int64 {
	return time.Now().UnixMilli()
}

func MarshalPayload(v interface{}) (string, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func UnmarshalPayload(payloadStr string, v interface{}) error {
	return json.Unmarshal([]byte(payloadStr), v)
}
