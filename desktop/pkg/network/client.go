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
	serverAddr   string
	peer         Peer
	conn         net.Conn
	writer       *bufio.Writer
	mu           sync.Mutex
	stopChan     chan struct{}
	stopOnce     sync.Once
	closed       bool
	connected    bool
	onPacket     func(packet Packet)
	onDisconnect func(err error)
}

// NewClient creates a new Client instance
func NewClient(serverAddr string, peer Peer, onPacket func(packet Packet), onDisconnect ...func(err error)) *Client {
	var disconnectFn func(err error)
	if len(onDisconnect) > 0 {
		disconnectFn = onDisconnect[0]
	}
	return &Client{
		serverAddr:   serverAddr,
		peer:         peer,
		stopChan:     make(chan struct{}),
		onPacket:     onPacket,
		onDisconnect: disconnectFn,
	}
}

// Connect establishes TCP connection with LAN Server and sends JOIN
func (c *Client) Connect() error {
	conn, err := net.DialTimeout("tcp", c.serverAddr, 4*time.Second)
	if err != nil {
		return fmt.Errorf("failed to connect to server at %s: %w", c.serverAddr, err)
	}

	if tcpConn, ok := conn.(*net.TCPConn); ok {
		_ = tcpConn.SetKeepAlive(true)
		_ = tcpConn.SetKeepAlivePeriod(15 * time.Second)
	}

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		_ = conn.Close()
		return fmt.Errorf("client closed")
	}
	c.conn = conn
	c.writer = bufio.NewWriter(conn)
	c.connected = true
	c.mu.Unlock()

	// Send JOIN packet
	joinPayload, _ := json.Marshal(JoinPayload{Peer: c.peer})
	if err := c.SendPacket(Packet{Type: TypeJoin, Payload: string(joinPayload)}); err != nil {
		c.mu.Lock()
		c.connected = false
		c.writer = nil
		c.mu.Unlock()
		_ = conn.Close()
		return fmt.Errorf("failed to send JOIN: %w", err)
	}

	go c.readLoop(conn)
	return nil
}

// IsConnected reports whether the client TCP stream is currently active.
func (c *Client) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected && !c.closed
}

func (c *Client) readLoop(conn net.Conn) {
	defer conn.Close()
	reader := bufio.NewReader(conn)

	var loopErr error
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			loopErr = err
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

	c.mu.Lock()
	wasClosed := c.closed
	c.connected = false
	c.writer = nil
	c.mu.Unlock()

	if !wasClosed && c.onDisconnect != nil {
		c.onDisconnect(loopErr)
	}
}

// SendPacket writes a packet as JSON line over the socket
func (c *Client) SendPacket(packet Packet) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed || !c.connected || c.writer == nil {
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
func (c *Client) SendChatMessage(msgID, targetID, targetHostname, content string, replyTo *ChatReplyPayload) error {
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
		ReplyTo:        replyTo,
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
	c.mu.Lock()
	c.peer.Nickname = newNick
	c.mu.Unlock()

	payload, _ := json.Marshal(NickUpdatePayload{
		PeerID:      c.peer.ID,
		NewNickname: newNick,
	})
	return c.SendPacket(Packet{Type: TypeNickUpdate, Payload: string(payload)})
}

// Close disconnects client from server
func (c *Client) Close() {
	c.stopOnce.Do(func() {
		close(c.stopChan)
		c.mu.Lock()
		c.closed = true
		c.connected = false
		c.writer = nil
		conn := c.conn
		c.mu.Unlock()

		if conn != nil {
			_ = conn.Close()
		}
	})
}
