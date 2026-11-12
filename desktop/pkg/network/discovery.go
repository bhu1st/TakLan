package network

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"taklan/pkg/sysinfo"

	"github.com/gorilla/websocket"
)

const (
	UDPDiscoveryPort = 25253
	TCPDefaultPort   = 25252
	BeaconMagic      = "TAKLAN_BEACON_V1"
)

// DiscoveredHost describes a reachable TakLan server found on the LAN.
type DiscoveredHost struct {
	Addr      string
	IP        string
	Port      int
	PeerCount int
	Via       string
}

// DiscoveryBeacon broadcasts server availability on LAN
type DiscoveryBeacon struct {
	serverIP   string
	serverPort int
	stopChan   chan struct{}
	stopOnce   sync.Once
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
	seen := make(map[string]bool)
	var addrs []string
	add := func(addr string) {
		if !seen[addr] {
			seen[addr] = true
			addrs = append(addrs, addr)
		}
	}

	add(fmt.Sprintf("255.255.255.255:%d", UDPDiscoveryPort))
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
			if ip4 == nil || (ip4[0] == 169 && ip4[1] == 254) {
				continue
			}
			mask := ipNet.Mask
			if len(mask) == 4 {
				bcast := make(net.IP, 4)
				for i := 0; i < 4; i++ {
					bcast[i] = ip4[i] | ^mask[i]
				}
				add(fmt.Sprintf("%s:%d", bcast.String(), UDPDiscoveryPort))
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
				_, _ = conn.Write(message)
				_ = conn.Close()
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
	b.stopOnce.Do(func() {
		close(b.stopChan)
	})
	b.wg.Wait()
}

type discoverResponse struct {
	App       string `json:"app"`
	Port      int    `json:"port"`
	PeerCount int    `json:"peerCount"`
}

// ProbeHostAddr checks whether addr (ip:port) hosts a reachable TakLan server.
// Returns (peerCount, true) when verified. peerCount may be 0 for legacy servers.
func ProbeHostAddr(ctx context.Context, addr string, timeout time.Duration) (int, bool) {
	if timeout <= 0 {
		timeout = 400 * time.Millisecond
	}

	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	dialer := &net.Dialer{Timeout: timeout}
	client := &http.Client{
		Transport: &http.Transport{
			DialContext:       dialer.DialContext,
			DisableKeepAlives: true,
		},
		Timeout: timeout,
	}

	req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, fmt.Sprintf("http://%s/discover", addr), nil)
	if err != nil {
		return 0, false
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		var payload discoverResponse
		if err := json.NewDecoder(resp.Body).Decode(&payload); err == nil && payload.App == "taklan" {
			return payload.PeerCount, true
		}
		return 0, false
	}

	// Backwards-compatibility with older TakLan servers (v1.2.0 / v1.2.1) that only serve WebSocket at /ws
	if resp.StatusCode == http.StatusBadRequest {
		wsDialer := websocket.Dialer{
			NetDialContext:   dialer.DialContext,
			HandshakeTimeout: timeout,
		}
		wsConn, wsResp, wsErr := wsDialer.DialContext(probeCtx, fmt.Sprintf("ws://%s/ws", addr), nil)
		if wsResp != nil && wsResp.Body != nil {
			_ = wsResp.Body.Close()
		}
		if wsErr == nil && wsConn != nil {
			_ = wsConn.Close()
			return 0, true
		}
	}

	return 0, false
}

// DiscoverServer listens for UDP broadcast for a given timeout period.
// Returns discovered server IP:Port or empty string if none found.
func DiscoverServer(timeout time.Duration) (string, error) {
	host, err := discoverServerUDP(context.Background(), timeout, nil)
	if err != nil {
		return "", err
	}
	return host.Addr, nil
}

func discoverServerUDP(ctx context.Context, timeout time.Duration, excludeIPs map[string]bool) (DiscoveredHost, error) {
	listenAddr, err := net.ResolveUDPAddr("udp4", fmt.Sprintf("0.0.0.0:%d", UDPDiscoveryPort))
	if err != nil {
		return DiscoveredHost{}, err
	}

	conn, err := net.ListenUDP("udp4", listenAddr)
	if err != nil {
		// Port might be in use or blocked on same machine
		return DiscoveredHost{}, err
	}
	defer conn.Close()

	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-done:
		}
	}()

	_ = conn.SetReadDeadline(time.Now().Add(timeout))

	buf := make([]byte, 1024)
	for {
		n, addr, err := conn.ReadFromUDP(buf)
		if err != nil {
			return DiscoveredHost{}, err // Timeout or read error
		}

		payload := strings.TrimSpace(string(buf[:n]))
		parts := strings.Split(payload, ":")
		if len(parts) < 3 || parts[0] != BeaconMagic {
			continue
		}

		serverPortStr := strings.TrimSpace(parts[2])
		serverPort, convErr := strconv.Atoi(serverPortStr)
		if convErr != nil || serverPort <= 0 || serverPort > 65535 {
			serverPort = TCPDefaultPort
		}

		var candidates []string
		if addr != nil && addr.IP != nil {
			srcIP := addr.IP.String()
			if srcIP != "" && !addr.IP.IsLoopback() && !addr.IP.IsUnspecified() {
				candidates = append(candidates, srcIP)
			}
		}

		beaconIP := strings.TrimSpace(parts[1])
		if beaconIP != "" && beaconIP != "0.0.0.0" && beaconIP != "127.0.0.1" {
			if len(candidates) == 0 || candidates[0] != beaconIP {
				candidates = append(candidates, beaconIP)
			}
		}

		for _, ip := range candidates {
			if excludeIPs != nil && excludeIPs[ip] {
				continue
			}
			targetAddr := fmt.Sprintf("%s:%d", ip, serverPort)
			if peerCount, ok := ProbeHostAddr(ctx, targetAddr, 500*time.Millisecond); ok {
				return DiscoveredHost{
					Addr:      targetAddr,
					IP:        ip,
					Port:      serverPort,
					PeerCount: peerCount,
					Via:       "udp",
				}, nil
			}
		}
	}
}

func lanHostWeight(lastOctet int) int {
	if lastOctet >= 1 && lastOctet <= 30 {
		return lastOctet
	}
	if lastOctet >= 100 && lastOctet <= 160 {
		return lastOctet - 60
	}
	return lastOctet + 200
}

// BuildSubnetCandidates builds an ordered, deduplicated list of IPv4 candidates to probe on TCP.
func BuildSubnetCandidates(localIfaces []sysinfo.LocalInterface, priorityIPs []string, excludeIPs map[string]bool) []string {
	seen := make(map[string]bool)
	var candidates []string

	addCandidate := func(ipStr string) {
		ip := net.ParseIP(strings.TrimSpace(ipStr)).To4()
		if ip == nil || ip.IsLoopback() || ip.IsUnspecified() {
			return
		}
		if ip[0] == 169 && ip[1] == 254 {
			return
		}
		norm := ip.String()
		if excludeIPs != nil && excludeIPs[norm] {
			return
		}
		if !seen[norm] {
			seen[norm] = true
			candidates = append(candidates, norm)
		}
	}

	for _, pIP := range priorityIPs {
		addCandidate(pIP)
	}

	seenPrefix := make(map[string]bool)
	for _, li := range localIfaces {
		ip4 := li.IP.To4()
		if ip4 == nil {
			continue
		}

		prefixKey := fmt.Sprintf("%d.%d.%d", ip4[0], ip4[1], ip4[2])
		if seenPrefix[prefixKey] {
			continue
		}
		seenPrefix[prefixKey] = true

		ones, bits := 24, 32
		if li.IPNet != nil {
			ones, bits = li.IPNet.Mask.Size()
		}

		startOctet, endOctet := 1, 254
		if bits == 32 && ones > 24 && ones < 32 {
			// Narrow subnet smaller than /24: only scan valid host addresses in that subnet
			maskByte := li.IPNet.Mask[3]
			netOctet := int(ip4[3] & maskByte)
			bcastOctet := int(ip4[3] | ^maskByte)
			if bcastOctet-netOctet >= 2 {
				startOctet = netOctet + 1
				endOctet = bcastOctet - 1
			}
		} else if bits == 32 && ones == 32 {
			continue
		}

		var octets []int
		for i := startOctet; i <= endOctet; i++ {
			octets = append(octets, i)
		}
		sort.Slice(octets, func(i, j int) bool {
			return lanHostWeight(octets[i]) < lanHostWeight(octets[j])
		})

		for _, oct := range octets {
			addCandidate(fmt.Sprintf("%s.%d", prefixKey, oct))
		}
	}

	return candidates
}

// LocalIPSet returns a lookup set of all active non-loopback IPv4 addresses on this machine.
func LocalIPSet(ifaces []sysinfo.LocalInterface) map[string]bool {
	set := make(map[string]bool, len(ifaces)+2)
	set["127.0.0.1"] = true
	for _, li := range ifaces {
		if ip4 := li.IP.To4(); ip4 != nil {
			set[ip4.String()] = true
		}
	}
	return set
}

func probeCandidates(ctx context.Context, ips []string, port int, workers int, perHostTimeout time.Duration) (DiscoveredHost, bool) {
	if len(ips) == 0 {
		return DiscoveredHost{}, false
	}
	if workers <= 0 {
		workers = 48
	}
	if workers > len(ips) {
		workers = len(ips)
	}

	scanCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	jobs := make(chan string)
	resultCh := make(chan DiscoveredHost, 1)
	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ip := range jobs {
				if scanCtx.Err() != nil {
					return
				}
				addr := fmt.Sprintf("%s:%d", ip, port)
				if peerCount, ok := ProbeHostAddr(scanCtx, addr, perHostTimeout); ok {
					select {
					case resultCh <- DiscoveredHost{
						Addr:      addr,
						IP:        ip,
						Port:      port,
						PeerCount: peerCount,
						Via:       "tcp-scan",
					}:
						cancel()
					default:
					}
					return
				}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, ip := range ips {
			select {
			case <-scanCtx.Done():
				return
			case jobs <- ip:
			}
		}
	}()

	wg.Wait()
	select {
	case host := <-resultCh:
		return host, true
	default:
		return DiscoveredHost{}, false
	}
}

func preferPhysicalInterfaces(ifaces []sysinfo.LocalInterface) []sysinfo.LocalInterface {
	var physical []sysinfo.LocalInterface
	for _, li := range ifaces {
		if !li.IsVirtual {
			physical = append(physical, li)
		}
	}
	if len(physical) > 0 {
		return physical
	}
	return ifaces
}

// DiscoverServerViaTCP scans priority IPs and local /24 subnets for a TakLan server on TCP port.
func DiscoverServerViaTCP(ctx context.Context, port int, priorityIPs []string) (DiscoveredHost, error) {
	ifaces := sysinfo.GetLocalInterfaces()
	exclude := LocalIPSet(ifaces)

	candidates := BuildSubnetCandidates(preferPhysicalInterfaces(ifaces), priorityIPs, exclude)
	if host, ok := probeCandidates(ctx, candidates, port, 48, 350*time.Millisecond); ok {
		return host, nil
	}
	return DiscoveredHost{}, fmt.Errorf("no TakLan host found via TCP subnet scan")
}

// DiscoverAny combines UDP beacon listening, priority IP probing, and TCP subnet scanning
// so standard Windows users with inbound UDP blocked still find the LAN host automatically.
func DiscoverAny(ctx context.Context, port int, priorityIPs []string) (DiscoveredHost, error) {
	ifaces := sysinfo.GetLocalInterfaces()
	exclude := LocalIPSet(ifaces)

	discCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	resultCh := make(chan DiscoveredHost, 3)

	// 1. Probe known/priority IPs immediately
	var cleanPriority []string
	seenPrio := make(map[string]bool)
	for _, p := range priorityIPs {
		ip := net.ParseIP(strings.TrimSpace(p)).To4()
		if ip == nil {
			continue
		}
		s := ip.String()
		if !exclude[s] && !seenPrio[s] {
			seenPrio[s] = true
			cleanPriority = append(cleanPriority, s)
		}
	}

	var wg sync.WaitGroup
	if len(cleanPriority) > 0 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if host, ok := probeCandidates(discCtx, cleanPriority, port, len(cleanPriority), 400*time.Millisecond); ok {
				select {
				case resultCh <- host:
					cancel()
				default:
				}
			}
		}()
	}

	// 2. Listen for UDP beacons (fast path when firewall allows UDP 25253)
	wg.Add(1)
	go func() {
		defer wg.Done()
		if host, err := discoverServerUDP(discCtx, 1300*time.Millisecond, exclude); err == nil && host.Addr != "" {
			select {
			case resultCh <- host:
				cancel()
			default:
			}
		}
	}()

	// 3. After a brief UDP head-start (450ms), run outbound TCP subnet scan (firewall-safe fallback)
	wg.Add(1)
	go func() {
		defer wg.Done()
		timer := time.NewTimer(450 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-discCtx.Done():
			return
		case <-timer.C:
		}

		// Exclude priority IPs already probed above
		subnetExclude := make(map[string]bool, len(exclude)+len(cleanPriority))
		for k, v := range exclude {
			subnetExclude[k] = v
		}
		for _, p := range cleanPriority {
			subnetExclude[p] = true
		}

		candidates := BuildSubnetCandidates(preferPhysicalInterfaces(ifaces), nil, subnetExclude)
		if host, ok := probeCandidates(discCtx, candidates, port, 48, 350*time.Millisecond); ok {
			select {
			case resultCh <- host:
				cancel()
			default:
			}
		}
	}()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case host := <-resultCh:
		return host, nil
	case <-done:
		select {
		case host := <-resultCh:
			return host, nil
		default:
			return DiscoveredHost{}, fmt.Errorf("no TakLan host server found on LAN")
		}
	case <-ctx.Done():
		return DiscoveredHost{}, ctx.Err()
	}
}

// CanBindPort checks if local TCP port is free to listen on
func CanBindPort(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}
