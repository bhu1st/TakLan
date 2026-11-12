package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"taklan/pkg/db"
	"taklan/pkg/filetransfer"
	"taklan/pkg/network"
	"taklan/pkg/sysinfo"
	"taklan/pkg/systray"

	"github.com/google/uuid"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type CombinedPeer struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	IP       string `json:"ip"`
	Hostname string `json:"hostname"`
	IsHost   bool   `json:"isHost"`
	JoinedAt int64  `json:"joinedAt"`
	IsOnline bool   `json:"isOnline"`
}

type InitialState struct {
	MyPeer          network.Peer   `json:"myPeer"`
	IsHost          bool           `json:"isHost"`
	IsConnected     bool           `json:"isConnected"`
	IsDiscovering   bool           `json:"isDiscovering"`
	ConnectionError string         `json:"connectionError"`
	ServerAddr      string         `json:"serverAddr"`
	Peers           []CombinedPeer `json:"peers"`
}

// App struct
type App struct {
	ctx             context.Context
	database        *db.Database
	tray            *systray.Tray
	server          *network.Server
	client          *network.Client
	fileMgr         *filetransfer.Manager
	myPeer          network.Peer
	isHost          bool
	isConnected     bool
	isDiscovering   bool
	connectionError string
	serverAddr      string
	peers           []network.Peer
	connMu          sync.Mutex
	stateMu         sync.RWMutex
	stopMonitor     chan struct{}
	stopOnce        sync.Once
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		fileMgr:     filetransfer.NewManager(),
		peers:       make([]network.Peer, 0),
		stopMonitor: make(chan struct{}),
	}
}

// startup is called when the app starts. The context is saved
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	database, err := db.InitDB()
	if err != nil {
		log.Printf("[App] Failed to initialize database: %v", err)
	} else {
		a.database = database
	}

	a.tray = systray.Start("TalkLan", func() {
		wailsRuntime.WindowShow(a.ctx)
		wailsRuntime.WindowUnminimise(a.ctx)
	}, func() {
		wailsRuntime.Quit(a.ctx)
	})

	localIP := sysinfo.GetLocalIP()
	hostname := sysinfo.GetHostname()
	peerID := uuid.New().String()[:8]
	defaultNick := fmt.Sprintf("%s", hostname)

	a.stateMu.Lock()
	a.myPeer = network.Peer{
		ID:       peerID,
		Nickname: defaultNick,
		IP:       localIP,
		Hostname: hostname,
		IsHost:   false,
		JoinedAt: time.Now().UnixMilli(),
	}
	a.serverAddr = fmt.Sprintf("%s:%d", localIP, network.TCPDefaultPort)
	a.isDiscovering = true
	a.stateMu.Unlock()

	if a.database != nil {
		_ = a.database.UpsertPeer(hostname, peerID, defaultNick, localIP, false)
	}

	go func() {
		a.discoverAndConnect()
		a.monitorNetwork()
	}()
}

func (a *App) getPriorityHostIPs() []string {
	if a.database == nil {
		return nil
	}
	knownPeers, err := a.database.GetKnownPeers()
	if err != nil {
		return nil
	}

	var hostIPs []string
	var otherIPs []string
	for _, kp := range knownPeers {
		if kp.IP == "" {
			continue
		}
		if kp.IsHost {
			hostIPs = append(hostIPs, kp.IP)
		} else {
			otherIPs = append(otherIPs, kp.IP)
		}
	}
	return append(hostIPs, otherIPs...)
}

func (a *App) emitStateUpdate() {
	if a.ctx == nil {
		return
	}
	state := a.GetInitialState()
	wailsRuntime.EventsEmit(a.ctx, "initial-state-updated", state)
	wailsRuntime.EventsEmit(a.ctx, "peers-updated", state.Peers)
}

func (a *App) refreshLocalIP() string {
	localIP := sysinfo.GetLocalIP()
	a.stateMu.Lock()
	if localIP != "" && localIP != "127.0.0.1" {
		a.myPeer.IP = localIP
	} else if a.myPeer.IP == "" {
		a.myPeer.IP = "127.0.0.1"
	}
	current := a.myPeer.IP
	a.stateMu.Unlock()
	return current
}

func (a *App) stopNetworkingLocked() {
	a.stateMu.Lock()
	oldClient := a.client
	oldServer := a.server
	a.client = nil
	a.server = nil
	a.isConnected = false
	a.isHost = false
	a.myPeer.IsHost = false
	a.peers = nil
	a.stateMu.Unlock()

	if oldClient != nil {
		oldClient.Close()
	}
	if oldServer != nil {
		oldServer.Stop()
	}
}

func (a *App) connectClientLocked(addr string, asHost bool) error {
	a.stateMu.Lock()
	oldClient := a.client
	a.client = nil
	a.isHost = asHost
	a.myPeer.IsHost = asHost
	a.serverAddr = addr
	a.isConnected = false
	a.connectionError = ""
	myPeerCopy := a.myPeer
	a.stateMu.Unlock()

	if oldClient != nil {
		oldClient.Close()
	}

	var cli *network.Client
	cli = network.NewClient(addr, myPeerCopy, a.onPacketReceived, func(err error) {
		a.handleClientDisconnect(cli, err)
	})

	if err := cli.Connect(); err != nil {
		log.Printf("[App] Failed to connect TCP client to %s: %v", addr, err)
		a.stateMu.Lock()
		a.isConnected = false
		a.connectionError = fmt.Sprintf("Failed to connect to %s", addr)
		a.peers = nil
		a.stateMu.Unlock()
		return err
	}

	a.stateMu.Lock()
	a.client = cli
	a.isConnected = true
	a.connectionError = ""
	a.stateMu.Unlock()

	if a.database != nil {
		_ = a.database.UpsertPeer(myPeerCopy.Hostname, myPeerCopy.ID, myPeerCopy.Nickname, myPeerCopy.IP, asHost)
	}
	return nil
}

func (a *App) handleClientDisconnect(cli *network.Client, err error) {
	a.stateMu.Lock()
	if a.client != cli {
		a.stateMu.Unlock()
		return
	}
	a.client = nil
	a.isConnected = false
	if err != nil {
		a.connectionError = "Disconnected from host server"
	}
	a.peers = nil
	a.stateMu.Unlock()

	log.Printf("[App] Lost connection to host server: %v", err)
	a.emitStateUpdate()
}

func (a *App) discoverAndConnect() {
	a.connMu.Lock()
	defer a.connMu.Unlock()

	localIP := a.refreshLocalIP()

	a.stateMu.Lock()
	a.isDiscovering = true
	a.connectionError = ""
	a.stateMu.Unlock()
	a.emitStateUpdate()

	log.Printf("[App] Discovering active TakLan server on LAN...")
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	discovered, err := network.DiscoverAny(ctx, network.TCPDefaultPort, a.getPriorityHostIPs())
	cancel()

	if err == nil && discovered.Addr != "" {
		log.Printf("[App] Discovered LAN server at %s (via %s)", discovered.Addr, discovered.Via)
		a.stopNetworkingLocked()
		_ = a.connectClientLocked(discovered.Addr, false)
	} else if network.CanBindPort(network.TCPDefaultPort) {
		log.Printf("[App] No active server found. Electing this node as Host Server!")
		a.stopNetworkingLocked()
		srv := network.NewServer(network.TCPDefaultPort, localIP)
		if startErr := srv.Start(); startErr != nil {
			log.Printf("[App] Failed to start server: %v", startErr)
			a.stateMu.Lock()
			a.isHost = false
			a.myPeer.IsHost = false
			a.isConnected = false
			a.connectionError = startErr.Error()
			a.stateMu.Unlock()
		} else {
			a.stateMu.Lock()
			a.server = srv
			a.stateMu.Unlock()
			hostAddr := fmt.Sprintf("%s:%d", localIP, network.TCPDefaultPort)
			_ = a.connectClientLocked(hostAddr, true)
		}
	} else {
		// Port 25252 is already bound locally (another local instance)
		log.Printf("[App] Port %d in use locally. Joining local host server as Client.", network.TCPDefaultPort)
		a.stopNetworkingLocked()
		localAddr := fmt.Sprintf("127.0.0.1:%d", network.TCPDefaultPort)
		if connErr := a.connectClientLocked(localAddr, false); connErr != nil {
			_ = a.connectClientLocked(fmt.Sprintf("%s:%d", localIP, network.TCPDefaultPort), false)
		}
	}

	a.stateMu.Lock()
	a.isDiscovering = false
	a.stateMu.Unlock()
	a.emitStateUpdate()
}

func (a *App) monitorNetwork() {
	ticker := time.NewTicker(6 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-a.stopMonitor:
			return
		case <-ticker.C:
			a.stateMu.RLock()
			connected := a.isConnected
			discovering := a.isDiscovering
			isHost := a.isHost
			srv := a.server
			myIP := a.myPeer.IP
			a.stateMu.RUnlock()

			if discovering {
				continue
			}

			// 1. Auto-recover if client disconnected or failed to connect
			if !connected {
				a.discoverAndConnect()
				continue
			}

			// 2. If we elected self as a lonely Host (only self connected), check if a real Host exists on LAN
			if isHost && srv != nil && srv.ClientCount() <= 1 {
				ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
				discovered, err := network.DiscoverAny(ctx, network.TCPDefaultPort, a.getPriorityHostIPs())
				cancel()
				if err == nil && discovered.Addr != "" {
					// Deterministic tie-breaker: join if external host already has peers (>1) or has lower IP
					if discovered.PeerCount > 1 || (myIP != "" && myIP > discovered.IP) {
						log.Printf("[App] Lonely host detected active LAN server at %s (peers=%d). Switching to Client.", discovered.Addr, discovered.PeerCount)
						a.connMu.Lock()
						a.stateMu.RLock()
						stillLonely := a.isHost && a.server != nil && a.server.ClientCount() <= 1
						a.stateMu.RUnlock()
						if stillLonely {
							a.refreshLocalIP()
							a.stopNetworkingLocked()
							_ = a.connectClientLocked(discovered.Addr, false)
							a.emitStateUpdate()
						}
						a.connMu.Unlock()
					}
				}
			}
		}
	}
}

func normalizeHostInput(hostInput string) (string, error) {
	trimmed := strings.TrimSpace(hostInput)
	trimmed = strings.TrimPrefix(trimmed, "ws://")
	trimmed = strings.TrimPrefix(trimmed, "wss://")
	trimmed = strings.TrimPrefix(trimmed, "http://")
	trimmed = strings.TrimPrefix(trimmed, "https://")
	if idx := strings.Index(trimmed, "/"); idx != -1 {
		trimmed = trimmed[:idx]
	}
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return "", fmt.Errorf("host IP address cannot be empty")
	}

	if !strings.Contains(trimmed, ":") {
		return fmt.Sprintf("%s:%d", trimmed, network.TCPDefaultPort), nil
	}

	host, portStr, err := net.SplitHostPort(trimmed)
	if err != nil || strings.TrimSpace(host) == "" {
		return "", fmt.Errorf("invalid host address format (expected IP or IP:Port)")
	}
	if portStr == "" {
		portStr = strconv.Itoa(network.TCPDefaultPort)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 || port > 65535 {
		return "", fmt.Errorf("invalid TCP port: %s", portStr)
	}
	return fmt.Sprintf("%s:%d", strings.TrimSpace(host), port), nil
}

// ConnectToHost manually connects the desktop node as a Client to a specific host IP[:port].
func (a *App) ConnectToHost(hostInput string) (InitialState, error) {
	targetAddr, err := normalizeHostInput(hostInput)
	if err != nil {
		return a.GetInitialState(), err
	}

	hostOnly, _, _ := net.SplitHostPort(targetAddr)
	localSet := network.LocalIPSet(sysinfo.GetLocalInterfaces())

	a.stateMu.RLock()
	currentlyHosting := a.isHost && a.server != nil
	a.stateMu.RUnlock()

	if currentlyHosting && localSet[hostOnly] {
		return a.GetInitialState(), fmt.Errorf("this computer is already hosting at %s", targetAddr)
	}

	probeCtx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
	_, ok := network.ProbeHostAddr(probeCtx, targetAddr, 2*time.Second)
	cancel()
	if !ok {
		return a.GetInitialState(), fmt.Errorf("could not reach TakLan host at %s — verify IP and host firewall port %d", targetAddr, network.TCPDefaultPort)
	}

	a.connMu.Lock()
	defer a.connMu.Unlock()

	a.refreshLocalIP()
	a.stopNetworkingLocked()
	if err := a.connectClientLocked(targetAddr, false); err != nil {
		a.emitStateUpdate()
		return a.GetInitialState(), err
	}

	a.emitStateUpdate()
	return a.GetInitialState(), nil
}

// RescanNetwork scans the LAN for an active host server (via UDP and TCP subnet scan) and connects if found.
func (a *App) RescanNetwork() (InitialState, error) {
	a.connMu.Lock()
	defer a.connMu.Unlock()

	a.refreshLocalIP()
	a.stateMu.Lock()
	a.isDiscovering = true
	a.connectionError = ""
	currentlyConnected := a.isConnected
	currentlyHost := a.isHost
	a.stateMu.Unlock()
	a.emitStateUpdate()

	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	discovered, err := network.DiscoverAny(ctx, network.TCPDefaultPort, a.getPriorityHostIPs())
	cancel()

	if err == nil && discovered.Addr != "" {
		log.Printf("[App] Rescan found LAN host at %s (via %s)", discovered.Addr, discovered.Via)
		a.stopNetworkingLocked()
		_ = a.connectClientLocked(discovered.Addr, false)
	} else if !currentlyConnected {
		// Not connected and no external host found: try electing self or connecting locally
		localIP := a.refreshLocalIP()
		if !currentlyHost && network.CanBindPort(network.TCPDefaultPort) {
			a.stopNetworkingLocked()
			srv := network.NewServer(network.TCPDefaultPort, localIP)
			if startErr := srv.Start(); startErr != nil {
				a.stateMu.Lock()
				a.connectionError = startErr.Error()
				a.stateMu.Unlock()
			} else {
				a.stateMu.Lock()
				a.server = srv
				a.stateMu.Unlock()
				_ = a.connectClientLocked(fmt.Sprintf("%s:%d", localIP, network.TCPDefaultPort), true)
			}
		} else {
			a.stateMu.RLock()
			addr := a.serverAddr
			asHost := a.isHost
			a.stateMu.RUnlock()
			if addr != "" {
				_ = a.connectClientLocked(addr, asHost)
			}
		}
	}

	a.stateMu.Lock()
	a.isDiscovering = false
	a.stateMu.Unlock()
	a.emitStateUpdate()
	return a.GetInitialState(), nil
}

func (a *App) getClient() *network.Client {
	a.stateMu.RLock()
	defer a.stateMu.RUnlock()
	return a.client
}

func (a *App) sendPacket(packet network.Packet) error {
	cli := a.getClient()
	if cli == nil {
		return fmt.Errorf("not connected to host server")
	}
	return cli.SendPacket(packet)
}

func (a *App) getCombinedPeers() []CombinedPeer {
	a.stateMu.RLock()
	myHostname := a.myPeer.Hostname
	peersCopy := make([]network.Peer, len(a.peers))
	copy(peersCopy, a.peers)
	a.stateMu.RUnlock()

	var result []CombinedPeer
	onlineMap := make(map[string]bool)

	for _, p := range peersCopy {
		if p.Hostname == myHostname {
			continue
		}
		onlineMap[p.Hostname] = true
		result = append(result, CombinedPeer{
			ID:       p.ID,
			Nickname: p.Nickname,
			IP:       p.IP,
			Hostname: p.Hostname,
			IsHost:   p.IsHost,
			JoinedAt: p.JoinedAt,
			IsOnline: true,
		})
	}

	if a.database != nil {
		knownPeers, err := a.database.GetKnownPeers()
		if err == nil {
			for _, kp := range knownPeers {
				if kp.Hostname == myHostname {
					continue
				}
				if !onlineMap[kp.Hostname] {
					result = append(result, CombinedPeer{
						ID:       kp.ID,
						Nickname: kp.Nickname,
						IP:       kp.IP,
						Hostname: kp.Hostname,
						IsHost:   kp.IsHost,
						JoinedAt: kp.LastSeen,
						IsOnline: false,
					})
				}
			}
		}
	}

	return result
}

// shutdown is called when the app closes
func (a *App) shutdown(ctx context.Context) {
	a.stopOnce.Do(func() {
		close(a.stopMonitor)
	})
	if a.database != nil {
		a.database.Close()
	}
	if a.tray != nil {
		a.tray.Stop()
	}
	a.stopNetworkingLocked()
}

// MinimizeToTray hides the application window to system tray
func (a *App) MinimizeToTray() {
	wailsRuntime.WindowHide(a.ctx)
}

func (a *App) resolvePeerHostname(peerID string) string {
	if peerID == "" {
		return ""
	}
	a.stateMu.RLock()
	myID := a.myPeer.ID
	myHostname := a.myPeer.Hostname
	peersCopy := make([]network.Peer, len(a.peers))
	copy(peersCopy, a.peers)
	a.stateMu.RUnlock()

	if peerID == myID || peerID == myHostname {
		return myHostname
	}
	for _, p := range peersCopy {
		if p.ID == peerID || p.Hostname == peerID {
			return p.Hostname
		}
	}
	if a.database != nil {
		knownPeers, err := a.database.GetKnownPeers()
		if err == nil {
			for _, kp := range knownPeers {
				if kp.ID == peerID || kp.Hostname == peerID {
					return kp.Hostname
				}
			}
		}
	}
	return peerID
}

// onPacketReceived handles network packets on client node
func (a *App) onPacketReceived(packet network.Packet) {
	a.stateMu.RLock()
	myPeer := a.myPeer
	a.stateMu.RUnlock()

	switch packet.Type {
	case network.TypeJoinAck:
		var ack network.JoinAckPayload
		if err := network.UnmarshalPayload(packet.Payload, &ack); err == nil {
			a.stateMu.Lock()
			a.peers = ack.Peers
			a.stateMu.Unlock()

			if a.database != nil {
				for _, p := range ack.Peers {
					_ = a.database.UpsertPeer(p.Hostname, p.ID, p.Nickname, p.IP, p.IsHost)
				}
			}
			wailsRuntime.EventsEmit(a.ctx, "joined-ack", ack)
			wailsRuntime.EventsEmit(a.ctx, "peers-updated", a.getCombinedPeers())
		}

	case network.TypePeerList:
		var payload network.PeerListPayload
		if err := network.UnmarshalPayload(packet.Payload, &payload); err == nil {
			a.stateMu.Lock()
			a.peers = payload.Peers
			a.stateMu.Unlock()

			if a.database != nil {
				for _, p := range payload.Peers {
					_ = a.database.UpsertPeer(p.Hostname, p.ID, p.Nickname, p.IP, p.IsHost)
				}
			}
			wailsRuntime.EventsEmit(a.ctx, "peers-updated", a.getCombinedPeers())
		}

	case network.TypeChat:
		var chat network.ChatMessagePayload
		if err := network.UnmarshalPayload(packet.Payload, &chat); err == nil {
			if chat.SenderHostname == "" {
				chat.SenderHostname = a.resolvePeerHostname(chat.SenderID)
			}
			if chat.TargetID != "" && chat.TargetHostname == "" {
				chat.TargetHostname = a.resolvePeerHostname(chat.TargetID)
			}

			var replyRecord *db.ChatReplyRecord
			if chat.ReplyTo != nil {
				replyRecord = &db.ChatReplyRecord{
					ID:         chat.ReplyTo.ID,
					SenderNick: chat.ReplyTo.SenderNick,
					Content:    chat.ReplyTo.Content,
				}
			}

			if a.database != nil {
				_ = a.database.SaveMessage(db.MessageRecord{
					ID:             chat.ID,
					SenderID:       chat.SenderID,
					SenderHostname: chat.SenderHostname,
					SenderNick:     chat.SenderNick,
					SenderIP:       chat.SenderIP,
					TargetHostname: chat.TargetHostname,
					Content:        chat.Content,
					Timestamp:      chat.Timestamp,
					ReplyTo:        replyRecord,
				})
			}
			// If message is from another peer, restore/unminimise window to foreground
			if chat.SenderID != myPeer.ID && chat.SenderHostname != myPeer.Hostname {
				wailsRuntime.WindowUnminimise(a.ctx)
				wailsRuntime.WindowShow(a.ctx)
			}

			wailsRuntime.EventsEmit(a.ctx, "new-message", chat)
		}

	case network.TypePing:
		var ping network.PingPayload
		if err := network.UnmarshalPayload(packet.Payload, &ping); err == nil {
			// Restore window visibility & focus if minimized
			wailsRuntime.WindowUnminimise(a.ctx)
			wailsRuntime.WindowShow(a.ctx)
			wailsRuntime.EventsEmit(a.ctx, "ping-received", ping)
		}

	case network.TypeFileOffer:
		var offer network.FileOfferPayload
		if err := network.UnmarshalPayload(packet.Payload, &offer); err == nil {
			if offer.SenderHostname == "" {
				offer.SenderHostname = a.resolvePeerHostname(offer.SenderID)
			}
			if offer.TargetID != "" && offer.TargetHostname == "" {
				offer.TargetHostname = a.resolvePeerHostname(offer.TargetID)
			}

			a.fileMgr.RegisterIncomingOffer(offer.TransferID, offer.SenderID, offer.SenderNick, offer.TargetID, offer.FileName, offer.FileSize)
			if a.database != nil {
				_ = a.database.SaveFileOffer(db.FileOfferRecord{
					TransferID:     offer.TransferID,
					SenderID:       offer.SenderID,
					SenderHostname: offer.SenderHostname,
					SenderNick:     offer.SenderNick,
					SenderIP:       offer.SenderIP,
					TargetHostname: offer.TargetHostname,
					FileName:       offer.FileName,
					FileSize:       offer.FileSize,
					Status:         "offered",
					SavePath:       "",
					Timestamp:      offer.Timestamp,
				})
			}
			if offer.SenderID != myPeer.ID && offer.SenderHostname != myPeer.Hostname {
				wailsRuntime.WindowUnminimise(a.ctx)
				wailsRuntime.WindowShow(a.ctx)
			}
			wailsRuntime.EventsEmit(a.ctx, "file-offer", offer)
		}

	case network.TypeFileResponse:
		var resp network.FileResponsePayload
		if err := network.UnmarshalPayload(packet.Payload, &resp); err == nil {
			statusStr := "rejected"
			if resp.Accepted {
				statusStr = "transferring"
			}
			if a.database != nil {
				if resp.RecipientID == myPeer.ID {
					_ = a.database.UpdateFileStatus(resp.TransferID, statusStr, resp.SavePath)
				} else {
					_ = a.database.UpdateFileStatus(resp.TransferID, statusStr, "")
				}
			}

			// Don't overwrite sender's local path with recipient's phone path
			if resp.RecipientID != myPeer.ID {
				resp.SavePath = ""
			}

			wailsRuntime.EventsEmit(a.ctx, "file-response", resp)
			if resp.Accepted && resp.RecipientID != myPeer.ID {
				// We are the sender and recipient accepted! Start chunk stream
				go a.fileMgr.StartSendingStream(resp.TransferID, func(chunkIndex, totalChunks int, dataB64 string) error {
					chunkPayload, _ := network.MarshalPayload(network.FileChunkPayload{
						TransferID:  resp.TransferID,
						ChunkIndex:  chunkIndex,
						TotalChunks: totalChunks,
						DataB64:     dataB64,
					})
					return a.sendPacket(network.Packet{Type: network.TypeFileChunk, Payload: chunkPayload})
				}, func(status string, progress float64, errStr string) {
					statusPayload, _ := network.MarshalPayload(network.FileStatusPayload{
						TransferID: resp.TransferID,
						Status:     status,
						Progress:   progress,
						Error:      errStr,
					})
					if a.database != nil {
						_ = a.database.UpdateFileStatus(resp.TransferID, status, "")
					}
					_ = a.sendPacket(network.Packet{Type: network.TypeFileStatus, Payload: statusPayload})
				})
			}
		}

	case network.TypeFileChunk:
		var chunk network.FileChunkPayload
		if err := network.UnmarshalPayload(packet.Payload, &chunk); err == nil {
			progress, isComplete, err := a.fileMgr.WriteChunk(chunk.TransferID, chunk.ChunkIndex, chunk.TotalChunks, chunk.DataB64)
			statusStr := "transferring"
			errStr := ""
			if err != nil {
				statusStr = "failed"
				errStr = err.Error()
			} else if isComplete {
				statusStr = "completed"
			}

			savePath := ""
			if t := a.fileMgr.GetTransfer(chunk.TransferID); t != nil {
				savePath = t.SavePath
			}

			if a.database != nil {
				_ = a.database.UpdateFileStatus(chunk.TransferID, statusStr, savePath)
			}

			statusPayload := network.FileStatusPayload{
				TransferID: chunk.TransferID,
				Status:     statusStr,
				Progress:   progress,
				SavePath:   savePath,
				Error:      errStr,
			}
			wailsRuntime.EventsEmit(a.ctx, "file-progress", statusPayload)
		}

	case network.TypeFileStatus:
		var status network.FileStatusPayload
		if err := network.UnmarshalPayload(packet.Payload, &status); err == nil {
			if a.database != nil {
				_ = a.database.UpdateFileStatus(status.TransferID, status.Status, "")
			}
			wailsRuntime.EventsEmit(a.ctx, "file-progress", status)
		}
	}
}

// ---------------- EXPOSED WAILS METHODS FOR FRONTEND ----------------

// GetInitialState returns the node connection details & initial peer list
func (a *App) GetInitialState() InitialState {
	a.stateMu.RLock()
	myPeer := a.myPeer
	isHost := a.isHost
	isConnected := a.isConnected
	isDiscovering := a.isDiscovering
	connectionError := a.connectionError
	serverAddr := a.serverAddr
	a.stateMu.RUnlock()

	return InitialState{
		MyPeer:          myPeer,
		IsHost:          isHost,
		IsConnected:     isConnected,
		IsDiscovering:   isDiscovering,
		ConnectionError: connectionError,
		ServerAddr:      serverAddr,
		Peers:           a.getCombinedPeers(),
	}
}

// GetMessageHistory returns messages for target hostname/ID with cursor pagination
func (a *App) GetMessageHistory(targetHostname, targetID string, beforeTimestamp int64, limit int) ([]db.MessageRecord, error) {
	if a.database == nil {
		return []db.MessageRecord{}, nil
	}
	a.stateMu.RLock()
	myHostname := a.myPeer.Hostname
	myID := a.myPeer.ID
	a.stateMu.RUnlock()
	return a.database.GetMessages(targetHostname, targetID, myHostname, myID, beforeTimestamp, limit)
}

// GetFileOffersHistory returns historical file offers with cursor pagination
func (a *App) GetFileOffersHistory(targetHostname, targetID string, beforeTimestamp int64, limit int) ([]db.FileOfferRecord, error) {
	if a.database == nil {
		return []db.FileOfferRecord{}, nil
	}
	a.stateMu.RLock()
	myHostname := a.myPeer.Hostname
	myID := a.myPeer.ID
	a.stateMu.RUnlock()
	return a.database.GetFileOffers(targetHostname, targetID, myHostname, myID, beforeTimestamp, limit)
}

// OpenFile opens a local file or folder with system default application
func (a *App) OpenFile(filePath string) error {
	if filePath == "" {
		return fmt.Errorf("file path is empty")
	}
	cleanPath := filepath.Clean(filePath)
	if runtime.GOOS == "windows" {
		return exec.Command("cmd", "/c", "start", "", cleanPath).Run()
	} else if runtime.GOOS == "darwin" {
		return exec.Command("open", cleanPath).Run()
	} else {
		return exec.Command("xdg-open", cleanPath).Run()
	}
}

// SetNickname updates nickname network-wide
func (a *App) SetNickname(newNick string) (bool, error) {
	if newNick == "" {
		return false, fmt.Errorf("nickname cannot be empty")
	}
	a.stateMu.Lock()
	a.myPeer.Nickname = newNick
	myPeer := a.myPeer
	cli := a.client
	a.stateMu.Unlock()

	if a.database != nil {
		_ = a.database.UpsertPeer(myPeer.Hostname, myPeer.ID, myPeer.Nickname, myPeer.IP, myPeer.IsHost)
	}
	if cli != nil {
		if err := cli.UpdateNickname(newNick); err != nil {
			return false, err
		}
	}
	return true, nil
}

// SendChatMessage sends a message to public channel or direct target with optional reply metadata
func (a *App) SendChatMessage(targetID, targetHostname, content, replyToID, replyToNick, replyToContent string) error {
	msgID := uuid.New().String()[:8]
	now := network.CurrentTimestamp()

	if targetHostname == "" && targetID != "" {
		targetHostname = a.resolvePeerHostname(targetID)
	}

	var replyPayload *network.ChatReplyPayload
	var replyRecord *db.ChatReplyRecord
	if replyToID != "" {
		replyPayload = &network.ChatReplyPayload{
			ID:         replyToID,
			SenderNick: replyToNick,
			Content:    replyToContent,
		}
		replyRecord = &db.ChatReplyRecord{
			ID:         replyToID,
			SenderNick: replyToNick,
			Content:    replyToContent,
		}
	}

	a.stateMu.RLock()
	myPeer := a.myPeer
	cli := a.client
	a.stateMu.RUnlock()

	msgPayload := network.ChatMessagePayload{
		ID:             msgID,
		SenderID:       myPeer.ID,
		SenderHostname: myPeer.Hostname,
		SenderNick:     myPeer.Nickname,
		SenderIP:       myPeer.IP,
		TargetID:       targetID,
		TargetHostname: targetHostname,
		Content:        content,
		Timestamp:      now,
		ReplyTo:        replyPayload,
	}

	if a.database != nil {
		_ = a.database.SaveMessage(db.MessageRecord{
			ID:             msgID,
			SenderID:       myPeer.ID,
			SenderHostname: myPeer.Hostname,
			SenderNick:     myPeer.Nickname,
			SenderIP:       myPeer.IP,
			TargetHostname: targetHostname,
			Content:        content,
			Timestamp:      now,
			ReplyTo:        replyRecord,
		})
	}

	wailsRuntime.EventsEmit(a.ctx, "new-message", msgPayload)

	if cli != nil {
		return cli.SendChatMessage(msgID, targetID, targetHostname, content, replyPayload)
	}
	return nil
}

// SendPing sends a buzz alert to a peer or all peers
func (a *App) SendPing(targetID string) error {
	cli := a.getClient()
	if cli == nil {
		return fmt.Errorf("client not connected")
	}
	return cli.SendPing(targetID)
}

// SelectAndSendFile opens OS file picker and offers file to peer
func (a *App) SelectAndSendFile(targetID string) (string, error) {
	cli := a.getClient()
	if cli == nil {
		return "", fmt.Errorf("client not connected")
	}

	filePath, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select File to Send over LAN",
	})
	if err != nil || filePath == "" {
		return "", err
	}

	a.stateMu.RLock()
	myPeer := a.myPeer
	a.stateMu.RUnlock()

	transferID := uuid.New().String()[:8]
	state, err := a.fileMgr.RegisterOffer(transferID, myPeer.ID, myPeer.Nickname, targetID, filePath)
	if err != nil {
		return "", err
	}

	targetHost := a.resolvePeerHostname(targetID)
	now := network.CurrentTimestamp()

	offerPayload, _ := network.MarshalPayload(network.FileOfferPayload{
		TransferID:     transferID,
		SenderID:       myPeer.ID,
		SenderHostname: myPeer.Hostname,
		SenderNick:     myPeer.Nickname,
		SenderIP:       myPeer.IP,
		TargetID:       targetID,
		TargetHostname: targetHost,
		FileName:       state.FileName,
		FileSize:       state.FileSize,
		Timestamp:      now,
	})

	if a.database != nil {
		_ = a.database.SaveFileOffer(db.FileOfferRecord{
			TransferID:     transferID,
			SenderID:       myPeer.ID,
			SenderHostname: myPeer.Hostname,
			SenderNick:     myPeer.Nickname,
			SenderIP:       myPeer.IP,
			TargetHostname: targetHost,
			FileName:       state.FileName,
			FileSize:       state.FileSize,
			Status:         "offered",
			SavePath:       filePath,
			Timestamp:      now,
		})
	}

	if err := cli.SendPacket(network.Packet{Type: network.TypeFileOffer, Payload: offerPayload}); err != nil {
		return "", err
	}

	wailsRuntime.EventsEmit(a.ctx, "file-offer", network.FileOfferPayload{
		TransferID:     transferID,
		SenderID:       myPeer.ID,
		SenderHostname: myPeer.Hostname,
		SenderNick:     myPeer.Nickname,
		SenderIP:       myPeer.IP,
		TargetID:       targetID,
		TargetHostname: targetHost,
		FileName:       state.FileName,
		FileSize:       state.FileSize,
		Timestamp:      now,
	})

	return transferID, nil
}

// AcceptFileTransfer prompts recipient for save location per transfer and accepts stream
func (a *App) AcceptFileTransfer(transferID string) error {
	t := a.fileMgr.GetTransfer(transferID)
	if t == nil {
		return fmt.Errorf("transfer offer not found")
	}

	savePath, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           fmt.Sprintf("Save %s from %s", t.FileName, t.SenderNick),
		DefaultFilename: t.FileName,
	})

	if err != nil || savePath == "" {
		return a.RejectFileTransfer(transferID)
	}

	if _, err := a.fileMgr.AcceptTransfer(transferID, savePath); err != nil {
		return err
	}

	if a.database != nil {
		_ = a.database.UpdateFileStatus(transferID, "transferring", savePath)
	}

	wailsRuntime.EventsEmit(a.ctx, "file-progress", network.FileStatusPayload{
		TransferID: transferID,
		Status:     "transferring",
		Progress:   0,
		SavePath:   savePath,
	})

	a.stateMu.RLock()
	myID := a.myPeer.ID
	a.stateMu.RUnlock()

	respPayload, _ := network.MarshalPayload(network.FileResponsePayload{
		TransferID:  transferID,
		RecipientID: myID,
		Accepted:    true,
		SavePath:    savePath,
	})

	return a.sendPacket(network.Packet{Type: network.TypeFileResponse, Payload: respPayload})
}

// RejectFileTransfer declines incoming file transfer
func (a *App) RejectFileTransfer(transferID string) error {
	if a.database != nil {
		_ = a.database.UpdateFileStatus(transferID, "rejected", "")
	}
	a.stateMu.RLock()
	myID := a.myPeer.ID
	a.stateMu.RUnlock()

	respPayload, _ := network.MarshalPayload(network.FileResponsePayload{
		TransferID:  transferID,
		RecipientID: myID,
		Accepted:    false,
	})
	return a.sendPacket(network.Packet{Type: network.TypeFileResponse, Payload: respPayload})
}
