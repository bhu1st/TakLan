package main

import (
	"context"
	"fmt"
	"log"
	"os/exec"
	"path/filepath"
	"runtime"
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
	MyPeer     network.Peer   `json:"myPeer"`
	IsHost     bool           `json:"isHost"`
	ServerAddr string         `json:"serverAddr"`
	Peers      []CombinedPeer `json:"peers"`
}

// App struct
type App struct {
	ctx        context.Context
	database   *db.Database
	tray       *systray.Tray
	server     *network.Server
	client     *network.Client
	fileMgr    *filetransfer.Manager
	myPeer     network.Peer
	isHost     bool
	serverAddr string
	peers      []network.Peer
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		fileMgr: filetransfer.NewManager(),
		peers:   make([]network.Peer, 0),
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

	a.tray = systray.Start("LAN Msngr", func() {
		wailsRuntime.WindowShow(a.ctx)
		wailsRuntime.WindowUnminimise(a.ctx)
	}, func() {
		wailsRuntime.Quit(a.ctx)
	})

	localIP := sysinfo.GetLocalIP()
	hostname := sysinfo.GetHostname()
	peerID := uuid.New().String()[:8]
	defaultNick := fmt.Sprintf("%s", hostname)

	a.myPeer = network.Peer{
		ID:       peerID,
		Nickname: defaultNick,
		IP:       localIP,
		Hostname: hostname,
		IsHost:   false,
		JoinedAt: time.Now().UnixMilli(),
	}
	a.serverAddr = fmt.Sprintf("%s:%d", localIP, network.TCPDefaultPort)

	if a.database != nil {
		_ = a.database.UpsertPeer(a.myPeer.Hostname, a.myPeer.ID, a.myPeer.Nickname, a.myPeer.IP, a.myPeer.IsHost)
	}

	go func() {
		// Server Auto-Discovery & Election
		log.Printf("[App] Discovering active server on LAN...")
		discoveredAddr, err := network.DiscoverServer(800 * time.Millisecond)

		if err == nil && discoveredAddr != "" {
			// Server found on network! Join as Client
			log.Printf("[App] Discovered LAN server at %s", discoveredAddr)
			a.serverAddr = discoveredAddr
			a.isHost = false
			a.myPeer.IsHost = false
		} else {
			// Check if local port 25252 is available to host server
			if network.CanBindPort(network.TCPDefaultPort) {
				log.Printf("[App] No active server found. Electing this node as Host Server!")
				srv := network.NewServer(network.TCPDefaultPort, localIP)
				if err := srv.Start(); err != nil {
					log.Printf("[App] Failed to start server: %v", err)
					a.serverAddr = fmt.Sprintf("%s:%d", localIP, network.TCPDefaultPort)
					a.isHost = false
					a.myPeer.IsHost = false
				} else {
					a.server = srv
					a.isHost = true
					a.myPeer.IsHost = true
					a.serverAddr = fmt.Sprintf("%s:%d", localIP, network.TCPDefaultPort)
				}
			} else {
				// Fallback connect to local port host
				log.Printf("[App] Port %d in use. Joining active local host server as Client.", network.TCPDefaultPort)
				a.serverAddr = fmt.Sprintf("%s:%d", localIP, network.TCPDefaultPort)
				a.isHost = false
				a.myPeer.IsHost = false
			}
		}

		if a.database != nil {
			_ = a.database.UpsertPeer(a.myPeer.Hostname, a.myPeer.ID, a.myPeer.Nickname, a.myPeer.IP, a.myPeer.IsHost)
		}

		// Initialize TCP Client connection to server
		cli := network.NewClient(a.serverAddr, a.myPeer, a.onPacketReceived)
		if err := cli.Connect(); err != nil {
			log.Printf("[App] Failed to connect TCP client: %v", err)
		} else {
			a.client = cli
		}

		// Notify frontend with final connection state
		wailsRuntime.EventsEmit(a.ctx, "initial-state-updated", a.GetInitialState())
	}()
}

func (a *App) getCombinedPeers() []CombinedPeer {
	var result []CombinedPeer
	onlineMap := make(map[string]bool)

	for _, p := range a.peers {
		if p.Hostname == a.myPeer.Hostname {
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
				if kp.Hostname == a.myPeer.Hostname {
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
	if a.database != nil {
		a.database.Close()
	}
	if a.tray != nil {
		a.tray.Stop()
	}
	if a.client != nil {
		a.client.Close()
	}
	if a.server != nil {
		a.server.Stop()
	}
}

// MinimizeToTray hides the application window to system tray
func (a *App) MinimizeToTray() {
	wailsRuntime.WindowHide(a.ctx)
}

func (a *App) resolvePeerHostname(peerID string) string {
	if peerID == "" {
		return ""
	}
	if peerID == a.myPeer.ID || peerID == a.myPeer.Hostname {
		return a.myPeer.Hostname
	}
	for _, p := range a.peers {
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
	switch packet.Type {
	case network.TypeJoinAck:
		var ack network.JoinAckPayload
		if err := network.UnmarshalPayload(packet.Payload, &ack); err == nil {
			a.peers = ack.Peers
			if a.database != nil {
				for _, p := range a.peers {
					_ = a.database.UpsertPeer(p.Hostname, p.ID, p.Nickname, p.IP, p.IsHost)
				}
			}
			wailsRuntime.EventsEmit(a.ctx, "joined-ack", ack)
			wailsRuntime.EventsEmit(a.ctx, "peers-updated", a.getCombinedPeers())
		}

	case network.TypePeerList:
		var payload network.PeerListPayload
		if err := network.UnmarshalPayload(packet.Payload, &payload); err == nil {
			a.peers = payload.Peers
			if a.database != nil {
				for _, p := range a.peers {
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
				})
			}
			// If message is from another peer, restore/unminimise window to foreground
			if chat.SenderID != a.myPeer.ID && chat.SenderHostname != a.myPeer.Hostname {
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
			if offer.SenderID != a.myPeer.ID && offer.SenderHostname != a.myPeer.Hostname {
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
				if resp.RecipientID == a.myPeer.ID {
					_ = a.database.UpdateFileStatus(resp.TransferID, statusStr, resp.SavePath)
				} else {
					_ = a.database.UpdateFileStatus(resp.TransferID, statusStr, "")
				}
			}

			// Don't overwrite sender's local path with recipient's phone path
			if resp.RecipientID != a.myPeer.ID {
				resp.SavePath = ""
			}

			wailsRuntime.EventsEmit(a.ctx, "file-response", resp)
			if resp.Accepted && resp.RecipientID != a.myPeer.ID {
				// We are the sender and recipient accepted! Start chunk stream
				go a.fileMgr.StartSendingStream(resp.TransferID, func(chunkIndex, totalChunks int, dataB64 string) error {
					chunkPayload, _ := network.MarshalPayload(network.FileChunkPayload{
						TransferID:  resp.TransferID,
						ChunkIndex:  chunkIndex,
						TotalChunks: totalChunks,
						DataB64:     dataB64,
					})
					return a.client.SendPacket(network.Packet{Type: network.TypeFileChunk, Payload: chunkPayload})
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
					a.client.SendPacket(network.Packet{Type: network.TypeFileStatus, Payload: statusPayload})
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
	return InitialState{
		MyPeer:     a.myPeer,
		IsHost:     a.isHost,
		ServerAddr: a.serverAddr,
		Peers:      a.getCombinedPeers(),
	}
}

// GetMessageHistory returns messages for target hostname/ID with cursor pagination
func (a *App) GetMessageHistory(targetHostname, targetID string, beforeTimestamp int64, limit int) ([]db.MessageRecord, error) {
	if a.database == nil {
		return []db.MessageRecord{}, nil
	}
	return a.database.GetMessages(targetHostname, targetID, a.myPeer.Hostname, a.myPeer.ID, beforeTimestamp, limit)
}

// GetFileOffersHistory returns historical file offers with cursor pagination
func (a *App) GetFileOffersHistory(targetHostname, targetID string, beforeTimestamp int64, limit int) ([]db.FileOfferRecord, error) {
	if a.database == nil {
		return []db.FileOfferRecord{}, nil
	}
	return a.database.GetFileOffers(targetHostname, targetID, a.myPeer.Hostname, a.myPeer.ID, beforeTimestamp, limit)
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
	a.myPeer.Nickname = newNick
	if a.database != nil {
		_ = a.database.UpsertPeer(a.myPeer.Hostname, a.myPeer.ID, a.myPeer.Nickname, a.myPeer.IP, a.myPeer.IsHost)
	}
	if a.client != nil {
		if err := a.client.UpdateNickname(newNick); err != nil {
			return false, err
		}
	}
	return true, nil
}

// SendChatMessage sends a message to public channel or direct target
func (a *App) SendChatMessage(targetID, targetHostname, content string) error {
	msgID := uuid.New().String()[:8]
	now := network.CurrentTimestamp()

	if targetHostname == "" && targetID != "" {
		targetHostname = a.resolvePeerHostname(targetID)
	}

	msgPayload := network.ChatMessagePayload{
		ID:             msgID,
		SenderID:       a.myPeer.ID,
		SenderHostname: a.myPeer.Hostname,
		SenderNick:     a.myPeer.Nickname,
		SenderIP:       a.myPeer.IP,
		TargetID:       targetID,
		TargetHostname: targetHostname,
		Content:        content,
		Timestamp:      now,
	}

	if a.database != nil {
		_ = a.database.SaveMessage(db.MessageRecord{
			ID:             msgID,
			SenderID:       a.myPeer.ID,
			SenderHostname: a.myPeer.Hostname,
			SenderNick:     a.myPeer.Nickname,
			SenderIP:       a.myPeer.IP,
			TargetHostname: targetHostname,
			Content:        content,
			Timestamp:      now,
		})
	}

	wailsRuntime.EventsEmit(a.ctx, "new-message", msgPayload)

	if a.client != nil {
		return a.client.SendChatMessage(msgID, targetID, targetHostname, content)
	}
	return nil
}

// SendPing sends a buzz alert to a peer or all peers
func (a *App) SendPing(targetID string) error {
	if a.client == nil {
		return fmt.Errorf("client not connected")
	}
	return a.client.SendPing(targetID)
}

// SelectAndSendFile opens OS file picker and offers file to peer
func (a *App) SelectAndSendFile(targetID string) (string, error) {
	filePath, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select File to Send over LAN",
	})
	if err != nil || filePath == "" {
		return "", err
	}

	transferID := uuid.New().String()[:8]
	state, err := a.fileMgr.RegisterOffer(transferID, a.myPeer.ID, a.myPeer.Nickname, targetID, filePath)
	if err != nil {
		return "", err
	}

	targetHost := a.resolvePeerHostname(targetID)

	offerPayload, _ := network.MarshalPayload(network.FileOfferPayload{
		TransferID:     transferID,
		SenderID:       a.myPeer.ID,
		SenderHostname: a.myPeer.Hostname,
		SenderNick:     a.myPeer.Nickname,
		SenderIP:       a.myPeer.IP,
		TargetID:       targetID,
		TargetHostname: targetHost,
		FileName:       state.FileName,
		FileSize:       state.FileSize,
		Timestamp:      network.CurrentTimestamp(),
	})

	if a.database != nil {
		_ = a.database.SaveFileOffer(db.FileOfferRecord{
			TransferID:     transferID,
			SenderID:       a.myPeer.ID,
			SenderHostname: a.myPeer.Hostname,
			SenderNick:     a.myPeer.Nickname,
			SenderIP:       a.myPeer.IP,
			TargetHostname: targetHost,
			FileName:       state.FileName,
			FileSize:       state.FileSize,
			Status:         "offered",
			SavePath:       filePath,
			Timestamp:      network.CurrentTimestamp(),
		})
	}

	if err := a.client.SendPacket(network.Packet{Type: network.TypeFileOffer, Payload: offerPayload}); err != nil {
		return "", err
	}

	wailsRuntime.EventsEmit(a.ctx, "file-offer", network.FileOfferPayload{
		TransferID:     transferID,
		SenderID:       a.myPeer.ID,
		SenderHostname: a.myPeer.Hostname,
		SenderNick:     a.myPeer.Nickname,
		SenderIP:       a.myPeer.IP,
		TargetID:       targetID,
		TargetHostname: targetHost,
		FileName:       state.FileName,
		FileSize:       state.FileSize,
		Timestamp:      network.CurrentTimestamp(),
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

	respPayload, _ := network.MarshalPayload(network.FileResponsePayload{
		TransferID:  transferID,
		RecipientID: a.myPeer.ID,
		Accepted:    true,
		SavePath:    savePath,
	})

	return a.client.SendPacket(network.Packet{Type: network.TypeFileResponse, Payload: respPayload})
}

// RejectFileTransfer declines incoming file transfer
func (a *App) RejectFileTransfer(transferID string) error {
	if a.database != nil {
		_ = a.database.UpdateFileStatus(transferID, "rejected", "")
	}
	respPayload, _ := network.MarshalPayload(network.FileResponsePayload{
		TransferID:  transferID,
		RecipientID: a.myPeer.ID,
		Accepted:    false,
	})
	return a.client.SendPacket(network.Packet{Type: network.TypeFileResponse, Payload: respPayload})
}
