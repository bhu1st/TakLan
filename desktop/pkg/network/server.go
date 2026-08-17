package network

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

// Server represents the central LAN chat server hosted by the first computer
type Server struct {
	port       int
	listener   net.Listener
	wsChan     chan net.Conn
	wsListener *channelListener
	mu         sync.RWMutex
	clients    map[string]*ClientConn
	peers      map[string]Peer
	beacon     *DiscoveryBeacon
	stopChan   chan struct{}
	localIP    string
}

// ClientConn holds the active net.Conn or WebSocket for a client session
type ClientConn struct {
	ID     string
	Peer   Peer
	Conn   net.Conn
	WSConn *websocket.Conn
	Writer *bufio.Writer
	mu     sync.Mutex
}

type bufferedConn struct {
	net.Conn
	r io.Reader
}

func (c *bufferedConn) Read(b []byte) (int, error) {
	return c.r.Read(b)
}

type channelListener struct {
	connChan chan net.Conn
	addr     net.Addr
	closed   bool
	mu       sync.Mutex
}

func (l *channelListener) Accept() (net.Conn, error) {
	conn, ok := <-l.connChan
	if !ok {
		return nil, io.EOF
	}
	return conn, nil
}

func (l *channelListener) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.closed {
		l.closed = true
		close(l.connChan)
	}
	return nil
}

func (l *channelListener) Addr() net.Addr {
	return l.addr
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow LAN connections from any device
	},
}

// NewServer initializes a new Server
func NewServer(port int, localIP string) *Server {
	wsChan := make(chan net.Conn, 100)
	return &Server{
		port:     port,
		wsChan:   wsChan,
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
	s.wsListener = &channelListener{connChan: s.wsChan, addr: ln.Addr()}

	// Start persistent HTTP/WebSocket server loop
	go http.Serve(s.wsListener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.handleWebSocket(w, r)
	}))

	// Start UDP Discovery Beacon
	s.beacon = NewDiscoveryBeacon(s.localIP, s.port)
	s.beacon.Start()

	log.Printf("[Server] Server running on %s (TCP & WebSocket)", addr)

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

		go s.dispatchConnection(conn)
	}
}

func (s *Server) dispatchConnection(conn net.Conn) {
	bufr := bufio.NewReader(conn)
	peekBytes, err := bufr.Peek(3)
	if err == nil && string(peekBytes) == "GET" {
		// Pass HTTP / WebSocket connection to persistent HTTP server
		bConn := &bufferedConn{Conn: conn, r: bufr}
		s.wsChan <- bConn
		return
	}

	// Standard TCP client from Desktop node
	bConn := &bufferedConn{Conn: conn, r: bufr}
	s.handleTCPConnection(bConn)
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Server] WebSocket upgrade error: %v", err)
		return
	}
	defer wsConn.Close()

	var clientID string
	defer func() {
		if clientID != "" {
			s.removeClient(clientID)
		}
	}()

	for {
		_, message, err := wsConn.ReadMessage()
		if err != nil {
			break
		}

		var packet Packet
		if err := json.Unmarshal(message, &packet); err != nil {
			log.Printf("[Server] Invalid WS packet JSON: %v", err)
			continue
		}

		clientID = s.processWSPacket(wsConn, clientID, packet)
	}
}

func (s *Server) processWSPacket(wsConn *websocket.Conn, currentClientID string, packet Packet) string {
	if packet.Type == TypeJoin {
		var payload JoinPayload
		if err := json.Unmarshal([]byte(packet.Payload), &payload); err == nil {
			peer := payload.Peer
			clientID := peer.ID

			client := &ClientConn{
				ID:     clientID,
				Peer:   peer,
				WSConn: wsConn,
			}

			s.mu.Lock()
			s.clients[clientID] = client
			s.peers[clientID] = peer
			s.mu.Unlock()

			log.Printf("[Server] Mobile WebSocket Peer joined: %s (%s, IP: %s)", peer.Nickname, peer.ID, peer.IP)

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
			s.broadcastPeerList()
			return clientID
		}
	}
	return s.processPacket(nil, nil, currentClientID, packet)
}

func (s *Server) handleTCPConnection(conn net.Conn) {
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

		log.Printf("[Server] TCP Peer joined: %s (%s, IP: %s)", peer.Nickname, peer.ID, peer.IP)

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
			s.broadcastPacket(packet, "")
		} else {
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
		var targetID string
		switch packet.Type {
		case TypeFileOffer:
			var p FileOfferPayload
			json.Unmarshal([]byte(packet.Payload), &p)
			targetID = p.TargetID
		case TypeFileResponse:
			var p FileResponsePayload
			json.Unmarshal([]byte(packet.Payload), &p)
			s.sendToPeerID(p.RecipientID, packet)
			s.broadcastPacket(packet, p.RecipientID)
			return currentClientID
		case TypeFileChunk:
			var p FileChunkPayload
			json.Unmarshal([]byte(packet.Payload), &p)
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

	if client.WSConn != nil {
		return client.WSConn.WriteMessage(websocket.TextMessage, data)
	}

	if client.Writer != nil {
		client.Writer.WriteString(string(data) + "\n")
		return client.Writer.Flush()
	}
	return nil
}

func (s *Server) sendToPeerID(peerID string, packet Packet) {
	if peerID == "" {
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()

	if client, ok := s.clients[peerID]; ok && client != nil {
		s.sendToClient(client, packet)
		return
	}

	for _, client := range s.clients {
		if client != nil && (client.ID == peerID || client.Peer.Hostname == peerID) {
			s.sendToClient(client, packet)
		}
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
	if s.wsListener != nil {
		s.wsListener.Close()
	}
	if s.beacon != nil {
		s.beacon.Stop()
	}
	if s.listener != nil {
		s.listener.Close()
	}
}
