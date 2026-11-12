package network

import (
	"context"
	"fmt"
	"net"
	"testing"
	"time"

	"taklan/pkg/sysinfo"
)

func TestBuildSubnetCandidates(t *testing.T) {
	_, net24, _ := net.ParseCIDR("192.168.1.50/24")
	_, net29, _ := net.ParseCIDR("10.0.0.10/29") // hosts 10.0.0.9..14

	ifaces := []sysinfo.LocalInterface{
		{Name: "Wi-Fi", IP: net.ParseIP("192.168.1.50").To4(), IPNet: net24},
		{Name: "Lab", IP: net.ParseIP("10.0.0.10").To4(), IPNet: net29},
	}
	exclude := map[string]bool{
		"192.168.1.50": true,
		"10.0.0.10":    true,
	}

	got := BuildSubnetCandidates(ifaces, []string{"192.168.1.99", "169.254.1.5", "192.168.1.50"}, exclude)

	if len(got) == 0 {
		t.Fatal("expected non-empty candidates")
	}
	if got[0] != "192.168.1.99" {
		t.Fatalf("expected priority IP first, got %q", got[0])
	}

	seen := make(map[string]bool)
	for _, ip := range got {
		if seen[ip] {
			t.Fatalf("duplicate candidate IP %q", ip)
		}
		seen[ip] = true
		if ip == "192.168.1.50" || ip == "10.0.0.10" || ip == "169.254.1.5" {
			t.Fatalf("unexpected excluded/link-local IP %q", ip)
		}
	}

	if !seen["10.0.0.9"] || !seen["10.0.0.14"] {
		t.Fatalf("expected /29 subnet hosts to be included")
	}
	if seen["10.0.0.8"] || seen["10.0.0.15"] || seen["10.0.0.20"] {
		t.Fatalf("did not expect network/broadcast/out-of-range /29 IPs")
	}
}

func TestPreferPhysicalInterfaces(t *testing.T) {
	phys := sysinfo.LocalInterface{Name: "Wi-Fi", IsVirtual: false}
	virt := sysinfo.LocalInterface{Name: "vEthernet (WSL)", IsVirtual: true}

	got := preferPhysicalInterfaces([]sysinfo.LocalInterface{virt, phys})
	if len(got) != 1 || got[0].Name != "Wi-Fi" {
		t.Fatalf("expected only physical interface, got %+v", got)
	}

	onlyVirt := preferPhysicalInterfaces([]sysinfo.LocalInterface{virt})
	if len(onlyVirt) != 1 || onlyVirt[0].Name != "vEthernet (WSL)" {
		t.Fatalf("expected virtual fallback when no physical interfaces exist, got %+v", onlyVirt)
	}
}

func TestServerProbeAndClientLifecycle(t *testing.T) {
	srv := NewServer(0, "127.0.0.1")
	if err := srv.Start(); err != nil {
		t.Fatalf("Server.Start failed: %v", err)
	}
	defer srv.Stop()

	addr := fmt.Sprintf("127.0.0.1:%d", srv.port)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	peerCount, ok := ProbeHostAddr(ctx, addr, time.Second)
	if !ok {
		t.Fatalf("expected ProbeHostAddr(%s) to succeed", addr)
	}
	if peerCount != 0 {
		t.Fatalf("expected 0 initial peers, got %d", peerCount)
	}

	joinedCh := make(chan struct{}, 1)
	discCh := make(chan error, 1)

	cli := NewClient(addr, Peer{
		ID:       "p1",
		Nickname: "Tester",
		IP:       "127.0.0.1",
		Hostname: "TEST-PC",
	}, func(pkt Packet) {
		if pkt.Type == TypeJoinAck {
			select {
			case joinedCh <- struct{}{}:
			default:
			}
		}
	}, func(err error) {
		select {
		case discCh <- err:
		default:
		}
	})

	if err := cli.Connect(); err != nil {
		t.Fatalf("Client.Connect failed: %v", err)
	}
	defer cli.Close()

	select {
	case <-joinedCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for JOIN_ACK")
	}

	if !cli.IsConnected() {
		t.Fatal("expected client to report connected")
	}
	if got := srv.ClientCount(); got != 1 {
		t.Fatalf("expected Server.ClientCount() == 1, got %d", got)
	}

	peerCount, ok = ProbeHostAddr(ctx, addr, time.Second)
	if !ok || peerCount != 1 {
		t.Fatalf("expected ProbeHostAddr after join to report ok=true, peerCount=1; got ok=%v peerCount=%d", ok, peerCount)
	}

	srv.Stop()
	// Idempotent second stop should not panic
	srv.Stop()

	select {
	case <-discCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for onDisconnect callback after server stop")
	}
}
