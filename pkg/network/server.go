package network

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
)

// Server represents the central LAN chat server hosted by the first computer
type Server struct {
	port       int
	listener   net.Listener
	mu         sync.RWMutex
	clients    map[string]*ClientConn
	peers      map[string]Peer
	beacon     *DiscoveryBeacon
	stopChan   chan struct{}
	localIP    string
}

// ClientConn holds the active net.Conn for a client session
type ClientConn struct {
	ID       string
	Peer     Peer
	Conn     net.Conn
	Writer   *bufio.Writer
	mu       sync.Mutex
}

// NewServer initializes a new Server
func NewServer(port int, localIP string) *Server {
	return &Server{
		port:     port,
		clients:  make(map[string]*ClientConn),
		peers:    make(map[string]Peer),
		stopChan: make(chan struct{}),
		localIP:  localIP,
	}
}

// Start begins listening on TCP port and starts UDP Discovery Beacon
func (s *Server) Start() error {
	addr := fmt.Sprintf("0.0.0.0:%d", s.port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to bind server TCP port %d: %w", s.port, err)
	}
	s.listener = ln

	// Start UDP Discovery Beacon
	s.beacon = NewDiscoveryBeacon(s.localIP, s.port)
	s.beacon.Start()

	log.Printf("[Server] Server running on %s", addr)

	go s.acceptLoop()
	return nil
}

func (s *Server) acceptLoop() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			select {
			case <-s.stopChan:
				return
			default:
				log.Printf("[Server] Accept error: %v", err)
				continue
			}
		}

		go s.handleConnection(conn)
	}
}

func (s *Server) handleConnection(conn net.Conn) {
	defer conn.Close()

	reader := bufio.NewReader(conn)
	writer := bufio.NewWriter(conn)

	var clientID string

	defer func() {
		if clientID != "" {
			s.removeClient(clientID)
		}
	}()

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err != io.EOF {
				log.Printf("[Server] Read error from client %s: %v", clientID, err)
			}
			break
		}

		var packet Packet
		if err := json.Unmarshal([]byte(line), &packet); err != nil {
			log.Printf("[Server] Invalid packet JSON: %v", err)
			continue
		}

		clientID = s.processPacket(conn, writer, clientID, packet)
	}
}

func (s *Server) processPacket(conn net.Conn, writer *bufio.Writer, currentClientID string, packet Packet) string {
	switch packet.Type {
	case TypeJoin:
		var payload JoinPayload
		if err := json.Unmarshal([]byte(packet.Payload), &payload); err != nil {
			return currentClientID
		}

		peer := payload.Peer
		clientID := peer.ID

		client := &ClientConn{
			ID:     clientID,
			Peer:   peer,
			Conn:   conn,
			Writer: writer,
		}

		s.mu.Lock()
		s.clients[clientID] = client
		s.peers[clientID] = peer
		s.mu.Unlock()

		log.Printf("[Server] Peer joined: %s (%s, IP: %s)", peer.Nickname, peer.ID, peer.IP)

		// Send JOIN_ACK back to connecting client
		s.mu.RLock()
		peerList := make([]Peer, 0, len(s.peers))
		for _, p := range s.peers {
			peerList = append(peerList, p)
		}
		s.mu.RUnlock()

		ackPayload, _ := json.Marshal(JoinAckPayload{
			PeerID: clientID,
			Peers:  peerList,
		})
		s.sendToClient(client, Packet{Type: TypeJoinAck, Payload: string(ackPayload)})

		// Broadcast updated peer list to all connected clients
		s.broadcastPeerList()
		return clientID

	case TypeNickUpdate:
		var payload NickUpdatePayload
		if err := json.Unmarshal([]byte(packet.Payload), &payload); err != nil {
			return currentClientID
		}

		s.mu.Lock()
		if peer, exists := s.peers[payload.PeerID]; exists {
			peer.Nickname = payload.NewNickname
			s.peers[payload.PeerID] = peer
			if client, ok := s.clients[payload.PeerID]; ok {
				client.Peer = peer
			}
		}
		s.mu.Unlock()

		s.broadcastPeerList()

	case TypeChat:
		var payload ChatMessagePayload
		if err := json.Unmarshal([]byte(packet.Payload), &payload); err != nil {
			return currentClientID
		}

		if payload.TargetID == "" {
			// Public broadcast chat
			s.broadcastPacket(packet, "")
		} else {
			// Private direct chat -> send to target and back to sender
			s.sendToPeerID(payload.TargetID, packet)
			if payload.SenderID != payload.TargetID {
				s.sendToPeerID(payload.SenderID, packet)
			}
		}

	case TypePing:
		var payload PingPayload
		if err := json.Unmarshal([]byte(packet.Payload), &payload); err != nil {
			return currentClientID
		}

		if payload.TargetID == "" {
			s.broadcastPacket(packet, payload.SenderID)
		} else {
			s.sendToPeerID(payload.TargetID, packet)
		}

	case TypeFileOffer, TypeFileResponse, TypeFileChunk, TypeFileStatus:
		// Route file transfer control & data payloads to target peer
		var targetID string
		switch packet.Type {
		case TypeFileOffer:
			var p FileOfferPayload
			json.Unmarshal([]byte(packet.Payload), &p)
			targetID = p.TargetID
		case TypeFileResponse:
			var p FileResponsePayload
			json.Unmarshal([]byte(packet.Payload), &p)
			// Send response to file sender or recipient
			s.sendToPeerID(p.RecipientID, packet)
			s.broadcastPacket(packet, p.RecipientID)
			return currentClientID
		case TypeFileChunk:
			var p FileChunkPayload
			json.Unmarshal([]byte(packet.Payload), &p)
			// Relay chunk to recipient
			s.broadcastPacket(packet, currentClientID)
			return currentClientID
		case TypeFileStatus:
			s.broadcastPacket(packet, "")
			return currentClientID
		}

		if targetID != "" {
			s.sendToPeerID(targetID, packet)
		} else {
			s.broadcastPacket(packet, currentClientID)
		}
	}

	return currentClientID
}

func (s *Server) sendToClient(client *ClientConn, packet Packet) error {
	client.mu.Lock()
	defer client.mu.Unlock()

	data, err := json.Marshal(packet)
	if err != nil {
		return err
	}

	client.Writer.WriteString(string(data) + "\n")
	return client.Writer.Flush()
}

func (s *Server) sendToPeerID(peerID string, packet Packet) {
	s.mu.RLock()
	client, ok := s.clients[peerID]
	s.mu.RUnlock()

	if ok && client != nil {
		s.sendToClient(client, packet)
	}
}

func (s *Server) broadcastPacket(packet Packet, excludeID string) {
	s.mu.RLock()
	clients := make([]*ClientConn, 0, len(s.clients))
	for id, client := range s.clients {
		if id != excludeID {
			clients = append(clients, client)
		}
	}
	s.mu.RUnlock()

	for _, client := range clients {
		s.sendToClient(client, packet)
	}
}

func (s *Server) broadcastPeerList() {
	s.mu.RLock()
	peerList := make([]Peer, 0, len(s.peers))
	for _, p := range s.peers {
		peerList = append(peerList, p)
	}
	s.mu.RUnlock()

	payload, _ := json.Marshal(PeerListPayload{Peers: peerList})
	s.broadcastPacket(Packet{Type: TypePeerList, Payload: string(payload)}, "")
}

func (s *Server) removeClient(clientID string) {
	s.mu.Lock()
	delete(s.clients, clientID)
	delete(s.peers, clientID)
	s.mu.Unlock()

	log.Printf("[Server] Peer disconnected: %s", clientID)
	s.broadcastPeerList()
}

// Stop shuts down TCP listener and discovery beacon
func (s *Server) Stop() {
	close(s.stopChan)
	if s.beacon != nil {
		s.beacon.Stop()
	}
	if s.listener != nil {
		s.listener.Close()
	}
}
