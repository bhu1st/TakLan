package network

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"
)

// Client handles connection from app node to the central LAN Server
type Client struct {
	serverAddr string
	peer       Peer
	conn       net.Conn
	writer     *bufio.Writer
	mu         sync.Mutex
	stopChan   chan struct{}
	onPacket   func(packet Packet)
}

// NewClient creates a new Client instance
func NewClient(serverAddr string, peer Peer, onPacket func(packet Packet)) *Client {
	return &Client{
		serverAddr: serverAddr,
		peer:       peer,
		stopChan:   make(chan struct{}),
		onPacket:   onPacket,
	}
}

// Connect establishes TCP connection with LAN Server and sends JOIN
func (c *Client) Connect() error {
	conn, err := net.DialTimeout("tcp", c.serverAddr, 5*time.Second)
	if err != nil {
		return fmt.Errorf("failed to connect to server at %s: %w", c.serverAddr, err)
	}

	c.conn = conn
	c.writer = bufio.NewWriter(conn)

	// Send JOIN packet
	joinPayload, _ := json.Marshal(JoinPayload{Peer: c.peer})
	if err := c.SendPacket(Packet{Type: TypeJoin, Payload: string(joinPayload)}); err != nil {
		conn.Close()
		return fmt.Errorf("failed to send JOIN: %w", err)
	}

	go c.readLoop()
	return nil
}

func (c *Client) readLoop() {
	defer c.conn.Close()
	reader := bufio.NewReader(c.conn)

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err != io.EOF {
				log.Printf("[Client] Read error: %v", err)
			}
			break
		}

		var packet Packet
		if err := json.Unmarshal([]byte(line), &packet); err != nil {
			log.Printf("[Client] Invalid packet: %v", err)
			continue
		}

		if c.onPacket != nil {
			c.onPacket(packet)
		}
	}
}

// SendPacket writes a packet as JSON line over the socket
func (c *Client) SendPacket(packet Packet) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.writer == nil {
		return fmt.Errorf("client not connected")
	}

	data, err := json.Marshal(packet)
	if err != nil {
		return err
	}

	if _, err := c.writer.WriteString(string(data) + "\n"); err != nil {
		return err
	}
	return c.writer.Flush()
}

// SendChatMessage sends a text message
func (c *Client) SendChatMessage(msgID, targetID, targetHostname, content string) error {
	payload, _ := json.Marshal(ChatMessagePayload{
		ID:             msgID,
		SenderID:       c.peer.ID,
		SenderHostname: c.peer.Hostname,
		SenderNick:     c.peer.Nickname,
		SenderIP:       c.peer.IP,
		TargetID:       targetID,
		TargetHostname: targetHostname,
		Content:        content,
		Timestamp:      CurrentTimestamp(),
	})
	return c.SendPacket(Packet{Type: TypeChat, Payload: string(payload)})
}

// SendPing sends a buzz / ping alert
func (c *Client) SendPing(targetID string) error {
	payload, _ := json.Marshal(PingPayload{
		SenderID:   c.peer.ID,
		SenderNick: c.peer.Nickname,
		SenderIP:   c.peer.IP,
		TargetID:   targetID,
		Timestamp:  CurrentTimestamp(),
	})
	return c.SendPacket(Packet{Type: TypePing, Payload: string(payload)})
}

// UpdateNickname sends updated nickname
func (c *Client) UpdateNickname(newNick string) error {
	c.peer.Nickname = newNick
	payload, _ := json.Marshal(NickUpdatePayload{
		PeerID:      c.peer.ID,
		NewNickname: newNick,
	})
	return c.SendPacket(Packet{Type: TypeNickUpdate, Payload: string(payload)})
}

// Close disconnects client from server
func (c *Client) Close() {
	close(c.stopChan)
	if c.conn != nil {
		c.conn.Close()
	}
}
