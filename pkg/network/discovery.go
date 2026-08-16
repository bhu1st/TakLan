package network

import (
	"fmt"
	"net"
	"strings"
	"sync"
	"time"
)

const (
	UDPDiscoveryPort = 25253
	TCPDefaultPort   = 25252
	BeaconMagic      = "LANMSNGR_BEACON_V1"
)

// DiscoveryBeacon broadcasts server availability on LAN
type DiscoveryBeacon struct {
	serverIP   string
	serverPort int
	stopChan   chan struct{}
	wg         sync.WaitGroup
}

// NewDiscoveryBeacon creates a UDP broadcast beacon for server
func NewDiscoveryBeacon(serverIP string, serverPort int) *DiscoveryBeacon {
	return &DiscoveryBeacon{
		serverIP:   serverIP,
		serverPort: serverPort,
		stopChan:   make(chan struct{}),
	}
}

// getBroadcastAddrs returns 255.255.255.255 and subnet broadcast addresses for active IPv4 interfaces
func getBroadcastAddrs() []string {
	addrs := []string{fmt.Sprintf("255.255.255.255:%d", UDPDiscoveryPort)}
	ifaces, err := net.Interfaces()
	if err != nil {
		return addrs
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrsList, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrsList {
			ipNet, ok := a.(*net.IPNet)
			if !ok || ipNet.IP.IsLoopback() {
				continue
			}
			ip4 := ipNet.IP.To4()
			if ip4 == nil {
				continue
			}
			mask := ipNet.Mask
			if len(mask) == 4 {
				bcast := make(net.IP, 4)
				for i := 0; i < 4; i++ {
					bcast[i] = ip4[i] | ^mask[i]
				}
				addrs = append(addrs, fmt.Sprintf("%s:%d", bcast.String(), UDPDiscoveryPort))
			}
		}
	}
	return addrs
}

// Start begins broadcasting UDP packets every 500ms
func (b *DiscoveryBeacon) Start() {
	b.wg.Add(1)
	go func() {
		defer b.wg.Done()

		message := []byte(fmt.Sprintf("%s:%s:%d", BeaconMagic, b.serverIP, b.serverPort))

		sendBroadcast := func() {
			for _, targetAddr := range getBroadcastAddrs() {
				raddr, err := net.ResolveUDPAddr("udp4", targetAddr)
				if err != nil {
					continue
				}
				conn, err := net.DialUDP("udp4", nil, raddr)
				if err != nil {
					continue
				}
				conn.Write(message)
				conn.Close()
			}
		}

		// Send initial broadcast immediately
		sendBroadcast()

		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-b.stopChan:
				return
			case <-ticker.C:
				sendBroadcast()
			}
		}
	}()
}

// Stop halts the UDP beacon
func (b *DiscoveryBeacon) Stop() {
	close(b.stopChan)
	b.wg.Wait()
}

// DiscoverServer listens for UDP broadcast for a given timeout period.
// Returns discovered server IP:Port or empty string if none found.
func DiscoverServer(timeout time.Duration) (string, error) {
	listenAddr, err := net.ResolveUDPAddr("udp4", fmt.Sprintf("0.0.0.0:%d", UDPDiscoveryPort))
	if err != nil {
		return "", err
	}

	conn, err := net.ListenUDP("udp4", listenAddr)
	if err != nil {
		// Port might be in use if running server on same machine
		return "", err
	}
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(timeout))

	buf := make([]byte, 1024)
	for {
		n, addr, err := conn.ReadFromUDP(buf)
		if err != nil {
			return "", err // Timeout or read error
		}

		payload := string(buf[:n])
		parts := strings.Split(payload, ":")
		if len(parts) >= 3 && parts[0] == BeaconMagic {
			serverIP := parts[1]
			serverPort := parts[2]
			// Handle loopback or 0.0.0.0 fallback
			if serverIP == "0.0.0.0" || serverIP == "127.0.0.1" {
				serverIP = addr.IP.String()
			}
			return fmt.Sprintf("%s:%s", serverIP, serverPort), nil
		}
	}
}

// CanBindPort checks if local TCP port is free to listen on
func CanBindPort(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		return false
	}
	ln.Close()
	return true
}
