package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"lanmsngr/pkg/filetransfer"
	"lanmsngr/pkg/network"
	"lanmsngr/pkg/sysinfo"

	"github.com/google/uuid"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type InitialState struct {
	MyPeer     network.Peer   `json:"myPeer"`
	IsHost     bool           `json:"isHost"`
	ServerAddr string         `json:"serverAddr"`
	Peers      []network.Peer `json:"peers"`
}

// App struct
type App struct {
	ctx        context.Context
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

// shutdown is called when the app closes
func (a *App) shutdown(ctx context.Context) {
	if a.client != nil {
		a.client.Close()
	}
	if a.server != nil {
		a.server.Stop()
	}
}

// onPacketReceived handles network packets on client node
func (a *App) onPacketReceived(packet network.Packet) {
	switch packet.Type {
	case network.TypeJoinAck:
		var ack network.JoinAckPayload
		if err := network.UnmarshalPayload(packet.Payload, &ack); err == nil {
			a.peers = ack.Peers
			wailsRuntime.EventsEmit(a.ctx, "joined-ack", ack)
			wailsRuntime.EventsEmit(a.ctx, "peers-updated", a.peers)
		}

	case network.TypePeerList:
		var payload network.PeerListPayload
		if err := network.UnmarshalPayload(packet.Payload, &payload); err == nil {
			a.peers = payload.Peers
			wailsRuntime.EventsEmit(a.ctx, "peers-updated", a.peers)
		}

	case network.TypeChat:
		var chat network.ChatMessagePayload
		if err := network.UnmarshalPayload(packet.Payload, &chat); err == nil {
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
			a.fileMgr.RegisterIncomingOffer(offer.TransferID, offer.SenderID, offer.SenderNick, offer.TargetID, offer.FileName, offer.FileSize)
			wailsRuntime.EventsEmit(a.ctx, "file-offer", offer)
		}

	case network.TypeFileResponse:
		var resp network.FileResponsePayload
		if err := network.UnmarshalPayload(packet.Payload, &resp); err == nil {
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

			statusPayload := network.FileStatusPayload{
				TransferID: chunk.TransferID,
				Status:     statusStr,
				Progress:   progress,
				Error:      errStr,
			}
			wailsRuntime.EventsEmit(a.ctx, "file-progress", statusPayload)
		}

	case network.TypeFileStatus:
		var status network.FileStatusPayload
		if err := network.UnmarshalPayload(packet.Payload, &status); err == nil {
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
		Peers:      a.peers,
	}
}

// SetNickname updates nickname network-wide
func (a *App) SetNickname(newNick string) (bool, error) {
	if newNick == "" {
		return false, fmt.Errorf("nickname cannot be empty")
	}
	a.myPeer.Nickname = newNick
	if a.client != nil {
		if err := a.client.UpdateNickname(newNick); err != nil {
			return false, err
		}
	}
	return true, nil
}

// SendChatMessage sends a message to public channel or direct target
func (a *App) SendChatMessage(targetID, content string) error {
	if a.client == nil {
		return fmt.Errorf("client not connected")
	}
	msgID := uuid.New().String()[:8]
	return a.client.SendChatMessage(msgID, targetID, content)
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

	offerPayload, _ := network.MarshalPayload(network.FileOfferPayload{
		TransferID: transferID,
		SenderID:   a.myPeer.ID,
		SenderNick: a.myPeer.Nickname,
		SenderIP:   a.myPeer.IP,
		TargetID:   targetID,
		FileName:   state.FileName,
		FileSize:   state.FileSize,
		Timestamp:  network.CurrentTimestamp(),
	})

	if err := a.client.SendPacket(network.Packet{Type: network.TypeFileOffer, Payload: offerPayload}); err != nil {
		return "", err
	}

	wailsRuntime.EventsEmit(a.ctx, "file-offer", network.FileOfferPayload{
		TransferID: transferID,
		SenderID:   a.myPeer.ID,
		SenderNick: a.myPeer.Nickname,
		SenderIP:   a.myPeer.IP,
		TargetID:   targetID,
		FileName:   state.FileName,
		FileSize:   state.FileSize,
		Timestamp:  network.CurrentTimestamp(),
	})

	return transferID, nil
}

// AcceptFileTransfer prompts recipient for save location per transfer and accepts stream
func (a *App) AcceptFileTransfer(transferID string) error {
	t := a.fileMgr.GetTransfer(transferID)
	if t == nil {
		return fmt.Errorf("transfer offer not found")
	}

	// PROMPT RECIPIENT PER TRANSFER USING WAILS NATIVE SAVE DIALOG
	savePath, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           fmt.Sprintf("Save %s from %s", t.FileName, t.SenderNick),
		DefaultFilename: t.FileName,
	})

	if err != nil || savePath == "" {
		// User cancelled save dialog
		return a.RejectFileTransfer(transferID)
	}

	if _, err := a.fileMgr.AcceptTransfer(transferID, savePath); err != nil {
		return err
	}

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
	respPayload, _ := network.MarshalPayload(network.FileResponsePayload{
		TransferID:  transferID,
		RecipientID: a.myPeer.ID,
		Accepted:    false,
	})
	return a.client.SendPacket(network.Packet{Type: network.TypeFileResponse, Payload: respPayload})
}
