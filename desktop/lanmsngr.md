# Implementation Plan - LAN Messenger (Go + Wails v2 + Tailwind CSS)

Build a cross-platform desktop LAN Messenger application using **Go**, **Wails v2**, and **Tailwind CSS**. The app automatically coordinates between devices on a Local Area Network (LAN) by electing the first node as the LAN Chat Server while subsequent nodes join as clients.

---

## Architecture Overview

```
                        +------------------------------------+
                        |  First Computer Launched          |
                        |  (Host Node: Server + Client)      |
                        |  - TCP Server (Port 25252)         |
                        |  - UDP Discovery Beacon (25253)    |
                        +-----------------+------------------+
                                          |
                        +-----------------+------------------+
                        |                                    |
            +-----------v-----------+            +-----------v-----------+
            |  Second Computer      |            |  Third Computer       |
            |  (Peer Client)        |            |  (Peer Client)        |
            |  - Discovers via UDP  |            |  - Discovers via UDP  |
            |  - Connects via TCP   |            |  - Connects via TCP   |
            +-----------------------+            +-----------------------+
```

### Key Technical Mechanisms

1. **Auto-Server Election & UDP Subnet Discovery**:
   - **Port Binding Check**: On startup, the app attempts to listen on TCP port `25252`.
   - **Host Mode**: If port `25252` is available and no active server is detected via UDP broadcast, the app binds the TCP server and starts broadcasting a UDP heartbeat on port `25253`. It also connects locally as a client.
   - **Client Mode**: If port `25252` is taken or a UDP server beacon is received, the app joins as a Client connected to the discovered server IP.
   - **Failover / Re-election**: If the host disconnects, remaining clients perform a failover check to elect a new server host seamlessly.

2. **Network-Wide Identity & IP Auto-Detection**:
   - Auto-detects the machine's primary non-loopback LAN IPv4 address (e.g. `192.168.1.105`).
   - Generates a default nickname (e.g., `User-PCName`) which can be customized network-wide via the UI settings.
   - Broadcaster notifies all connected peers of nickname or IP changes in real time.

3. **Real-time Messaging & Peer Directory**:
   - Server maintains connected clients session registry with fields: `ID`, `Nickname`, `IP`, `Hostname`, `JoinedAt`.
   - Supports direct 1-to-1 messaging, group channel chat, and network peer presence updates (`PEER_JOIN`, `PEER_LEAVE`, `NICKNAME_UPDATE`).

4. **File Transfer via Chat**:
   - Native OS file picker integration using Wails `runtime.OpenFileDialog`.
   - Sender streams files in binary chunks (with unique file transfer ID, chunk index, checksum, total size).
   - Recipient accepts transfer and receives chunks directly to their chosen destination path, showing a progress percentage bar in chat.

5. **User Ping / Buzz Alert**:
   - Sending a "Ping" to a user sends a priority nudge event.
   - Recipient device triggers:
     - Synthetic audio beep alert via Web Audio API.
     - Window flash and focus (`runtime.WindowUnminimise`, `runtime.WindowShow`).
     - Screen-shake CSS micro-animation and visual toast alert ("🔔 [Nickname] pinged you!").

---

## User Review Required

> [!IMPORTANT]
> - **Default Ports**: We will use TCP port `25252` for chat/file messaging and UDP port `25253` for subnet discovery beaconing. Please ensure these ports are allowed through your local firewall.
> - **Frontend Stack**: We will use **React + Tailwind CSS + Lucide Icons** inside Wails v2 to build a modern, high-performance dark/light glassmorphism desktop interface.

---

## Open Questions

> [!NOTE]
> 1. **File Transfer Location**: Should incoming files prompt for a save directory per transfer, or auto-save into a designated "LAN Messenger Downloads" folder? *(Proposed default: Prompt per transfer with option to auto-save)*.
> 2. **Subnet Discovery**: Is standard UDP Broadcast (`255.255.255.255:25253`) sufficient, or should we support manual IP entry for subnets that block UDP broadcast? *(Proposed default: Auto UDP discovery + manual IP connect option)*.

---

## Proposed Changes

### Project Initialization & Core Structure
We will initialize the Wails app in `z:/xampp82/htdocs/lanmsngr` using Wails CLI: `wails init -n lanmsngr -t react`.

```
lanmsngr/
├── app.go                       # Wails backend methods bound to JS frontend
├── main.go                      # Entry point initializing Wails app & Go runtime
├── wails.json                   # Wails project configuration
├── pkg/
│   ├── network/
│   │   ├── protocol.go          # JSON message structures & commands
│   │   ├── discovery.go         # UDP subnet broadcast & server detection
│   │   ├── server.go            # Host TCP server managing client connections
│   │   └── client.go            # Peer TCP client for sending/receiving
│   ├── filetransfer/
│   │   └── manager.go           # Chunked file streaming sender/receiver
│   └── sysinfo/
│       └── ip.go                # LAN IPv4 detection logic
└── frontend/
    ├── src/
    │   ├── App.tsx              # Main React App & layout structure
    │   ├── components/
    │   │   ├── Sidebar.tsx      # Connected peers list, LAN IP, Host status
    │   │   ├── ChatArea.tsx     # Active conversation header & message timeline
    │   │   ├── MessageItem.tsx  # Text messages, ping banners, file cards
    │   │   ├── FileCard.tsx     # File download progress bar & controls
    │   │   ├── NicknameModal.tsx# Network-wide nickname editor
    │   │   └── TopBar.tsx       # App controls, status badge, quick ping button
    │   ├── utils/
    │   │   └── audio.ts         # Synthetic ping alert sound generator
    │   ├── index.css            # Tailwind CSS directives & custom animations
    │   └── main.tsx
    ├── tailwind.config.js       # Tailwind theme & color system setup
    └── postcss.config.js
```

---

### Backend (Go) Components

#### [NEW] [ip.go](file:///z:/xampp82/htdocs/lanmsngr/pkg/sysinfo/ip.go)
- Detect active non-loopback LAN IPv4 addresses (e.g. `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`).

#### [NEW] [protocol.go](file:///z:/xampp82/htdocs/lanmsngr/pkg/network/protocol.go)
- Message structs for:
  - `JOIN_REQUEST` / `JOIN_RESPONSE`
  - `PEER_LIST_UPDATE`
  - `CHAT_MESSAGE`
  - `NICKNAME_CHANGE`
  - `USER_PING`
  - `FILE_OFFER` / `FILE_CHUNK` / `FILE_ACCEPT` / `FILE_CANCEL`

#### [NEW] [discovery.go](file:///z:/xampp82/htdocs/lanmsngr/pkg/network/discovery.go)
- UDP listener on `25253` broadcasting server info (`server_ip:port`, `server_hostname`).
- Dynamic server election logic: Check TCP port `25252` availability and listen for UDP broadcast beacons.

#### [NEW] [server.go](file:///z:/xampp82/htdocs/lanmsngr/pkg/network/server.go)
- TCP listener managing concurrent client connections.
- Broadcast hub to forward text messages, peer updates, pings, and file transfers to targeted or all clients.

#### [NEW] [client.go](file:///z:/xampp82/htdocs/lanmsngr/pkg/network/client.go)
- Client connection loop with automatic reconnect handling.
- Event integration emitting events to the Wails frontend via `runtime.EventsEmit`.

#### [NEW] [manager.go](file:///z:/xampp82/htdocs/lanmsngr/pkg/filetransfer/manager.go)
- File chunking (64KB chunks), sha256 checksum calculation, stream writer, and download progress calculator.

#### [NEW] [app.go](file:///z:/xampp82/htdocs/lanmsngr/app.go)
- Exposes Go functions to frontend:
  - `GetNetworkInfo() (string ip, bool isServer, string peerId)`
  - `UpdateNickname(newName string)`
  - `SendChatMessage(targetId string, text string)`
  - `PingUser(targetId string)`
  - `SelectAndSendFile(targetId string)`
  - `AcceptFileTransfer(transferId string)`

---

### Frontend (React + Tailwind CSS) Components

#### [NEW] [tailwind.config.js](file:///z:/xampp82/htdocs/lanmsngr/frontend/tailwind.config.js)
- Custom color palette (Slate, Indigo, Cyan accents, Emerald active status).
- Micro-animation keyframes (`ping-bounce`, `shake`, `pulse-subtle`, `glass`).

#### [NEW] [index.css](file:///z:/xampp82/htdocs/lanmsngr/frontend/src/index.css)
- Tailwind base, components, utilities, custom glassmorphism styles, dark theme background gradients.

#### [NEW] [Sidebar.tsx](file:///z:/xampp82/htdocs/lanmsngr/frontend/src/components/Sidebar.tsx)
- Displays current user badge (Nickname + LAN IP e.g. `192.168.1.15` + Server Host badge).
- List of online LAN clients with status dot, LAN IP, and individual "Ping" action button.
- Filter/search bar for clients.

#### [NEW] [ChatArea.tsx](file:///z:/xampp82/htdocs/lanmsngr/frontend/src/components/ChatArea.tsx)
- Broadcast main channel chat + 1-on-1 private chat tabs.
- Chat history feed with timestamp, sender avatar, nickname, and IP.
- Input bar with action buttons for: Text message, File upload attachment, Ping alert.

#### [NEW] [FileCard.tsx](file:///z:/xampp82/htdocs/lanmsngr/frontend/src/components/FileCard.tsx)
- Card displaying filename, file size, sender IP/nickname, Accept button, and progress bar with transfer rate.

#### [NEW] [PingAlert.tsx](file:///z:/xampp82/htdocs/lanmsngr/frontend/src/components/PingAlert.tsx)
- Visual toast notification with screen shake animation and audio tone trigger whenever a peer sends a Ping.

---

## Verification Plan

### Automated Tests & Builds
- Execute `wails build` to ensure cross-compilation and backend-frontend binding code generation succeed without errors.
- Test Go networking packages via `go test ./pkg/...`.

### Manual Verification
1. **Multi-Instance Testing (Local Host)**:
   - Launch first app instance -> verify it starts in **Host Mode** (TCP server on `25252`).
   - Launch second app instance -> verify it detects host and connects in **Client Mode**.
   - Verify both instances display each other in the connected clients list along with their LAN IPs (`127.0.0.1` or LAN IP).
2. **Nickname Update**:
   - Change nickname on Instance A -> verify Instance B receives real-time nickname update in peer list and chat.
3. **Chat & File Transfer**:
   - Send text message from A to B -> verify instant delivery.
   - Select a test file on Instance A -> accept on Instance B -> verify progress bar completes and file saved matches original file byte-for-byte.
4. **Ping Alert**:
   - Click "Ping" on Instance B -> verify Instance A plays ping chime, shakes screen/flashes toast banner, and brings window to focus.
