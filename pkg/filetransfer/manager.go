package filetransfer

import (
	"encoding/base64"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sync"
)


const ChunkSize = 64 * 1024 // 64KB chunk size

type TransferState struct {
	TransferID   string
	SenderID     string
	SenderNick   string
	RecipientID  string
	FileName     string
	FileSize     int64
	SavePath     string
	IsSender     bool
	BytesHandled int64
	FileHandle   *os.File
	Status       string // "offered", "accepted", "transferring", "completed", "rejected", "failed"
}

type Manager struct {
	mu        sync.RWMutex
	transfers map[string]*TransferState
}

func NewManager() *Manager {
	return &Manager{
		transfers: make(map[string]*TransferState),
	}
}

// RegisterOffer creates an offer entry on sender side
func (m *Manager) RegisterOffer(transferID, senderID, senderNick, recipientID, filePath string) (*TransferState, error) {
	fi, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open source file: %w", err)
	}

	state := &TransferState{
		TransferID:   transferID,
		SenderID:     senderID,
		SenderNick:   senderNick,
		RecipientID:  recipientID,
		FileName:     filepath.Base(filePath),
		FileSize:     fi.Size(),
		SavePath:     filePath,
		IsSender:     true,
		BytesHandled: 0,
		Status:       "offered",
	}

	m.mu.Lock()
	m.transfers[transferID] = state
	m.mu.Unlock()

	return state, nil
}

// RegisterIncomingOffer registers an incoming offer on recipient side
func (m *Manager) RegisterIncomingOffer(transferID, senderID, senderNick, recipientID, fileName string, fileSize int64) *TransferState {
	state := &TransferState{
		TransferID:   transferID,
		SenderID:     senderID,
		SenderNick:   senderNick,
		RecipientID:  recipientID,
		FileName:     fileName,
		FileSize:     fileSize,
		IsSender:     false,
		BytesHandled: 0,
		Status:       "offered",
	}

	m.mu.Lock()
	m.transfers[transferID] = state
	m.mu.Unlock()

	return state
}

// AcceptTransfer sets destination path on recipient side and opens file
func (m *Manager) AcceptTransfer(transferID, savePath string) (*TransferState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, ok := m.transfers[transferID]
	if !ok {
		return nil, fmt.Errorf("transfer ID %s not found", transferID)
	}

	// Ensure destination directory exists
	dir := filepath.Dir(savePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create destination directory: %w", err)
	}

	f, err := os.Create(savePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create destination file: %w", err)
	}

	state.SavePath = savePath
	state.FileHandle = f
	state.Status = "transferring"
	return state, nil
}

// WriteChunk appends incoming chunk on recipient side
func (m *Manager) WriteChunk(transferID string, chunkIndex, totalChunks int, dataB64 string) (float64, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, ok := m.transfers[transferID]
	if !ok || state.FileHandle == nil {
		return 0, false, fmt.Errorf("active transfer or handle not found for %s", transferID)
	}

	data, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return 0, false, fmt.Errorf("failed to decode chunk data: %w", err)
	}

	n, err := state.FileHandle.Write(data)
	if err != nil {
		state.Status = "failed"
		state.FileHandle.Close()
		return 0, false, fmt.Errorf("failed to write chunk to disk: %w", err)
	}

	state.BytesHandled += int64(n)
	var progress float64
	if state.FileSize > 0 {
		progress = math.Min(100.0, (float64(state.BytesHandled)/float64(state.FileSize))*100.0)
	}

	isComplete := state.BytesHandled >= state.FileSize || chunkIndex == totalChunks-1

	if isComplete {
		state.Status = "completed"
		state.FileHandle.Close()
		state.FileHandle = nil
	}

	return progress, isComplete, nil
}

// StartSendingStream reads file in chunks and sends via packet sender callback
func (m *Manager) StartSendingStream(transferID string, sendChunkFunc func(chunkIndex, totalChunks int, dataB64 string) error, sendStatusFunc func(status string, progress float64, errStr string)) {
	m.mu.RLock()
	state, ok := m.transfers[transferID]
	m.mu.RUnlock()

	if !ok {
		if sendStatusFunc != nil {
			sendStatusFunc("failed", 0, "transfer not found")
		}
		return
	}

	file, err := os.Open(state.SavePath)
	if err != nil {
		if sendStatusFunc != nil {
			sendStatusFunc("failed", 0, err.Error())
		}
		return
	}
	defer file.Close()

	totalChunks := int(math.Ceil(float64(state.FileSize) / float64(ChunkSize)))
	if totalChunks == 0 {
		totalChunks = 1
	}

	buf := make([]byte, ChunkSize)
	chunkIndex := 0

	for {
		n, err := file.Read(buf)
		if n > 0 {
			dataB64 := base64.StdEncoding.EncodeToString(buf[:n])
			if sendErr := sendChunkFunc(chunkIndex, totalChunks, dataB64); sendErr != nil {
				if sendStatusFunc != nil {
					sendStatusFunc("failed", 0, sendErr.Error())
				}
				return
			}

			state.BytesHandled += int64(n)
			chunkIndex++

			progress := math.Min(100.0, (float64(state.BytesHandled)/float64(state.FileSize))*100.0)
			if sendStatusFunc != nil {
				sendStatusFunc("transferring", progress, "")
			}
		}

		if err != nil {
			if err == io.EOF {
				break
			}
			if sendStatusFunc != nil {
				sendStatusFunc("failed", 0, err.Error())
			}
			return
		}
	}

	m.mu.Lock()
	state.Status = "completed"
	m.mu.Unlock()

	if sendStatusFunc != nil {
		sendStatusFunc("completed", 100.0, "")
	}
}

func (m *Manager) GetTransfer(transferID string) *TransferState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.transfers[transferID]
}
