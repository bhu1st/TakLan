package sysinfo

import (
	"net"
	"testing"
)

func TestIsPrivateIPv4(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
	}{
		{"192.168.1.10", true},
		{"10.0.0.5", true},
		{"172.16.0.1", true},
		{"172.20.10.2", true},
		{"172.31.255.254", true},
		{"172.2.0.1", false},
		{"172.15.255.255", false},
		{"172.32.0.1", false},
		{"8.8.8.8", false},
		{"169.254.1.10", false},
	}

	for _, tc := range cases {
		ip := net.ParseIP(tc.ip)
		if got := isPrivateIPv4(ip); got != tc.want {
			t.Errorf("isPrivateIPv4(%q) = %v, want %v", tc.ip, got, tc.want)
		}
	}
}

func TestIsVirtualInterface(t *testing.T) {
	if !isVirtualInterface(net.Interface{Name: "vEthernet (WSL)"}) {
		t.Fatal("expected vEthernet (WSL) to be detected as virtual")
	}
	if !isVirtualInterface(net.Interface{Name: "VirtualBox Host-Only Network"}) {
		t.Fatal("expected VirtualBox adapter to be detected as virtual")
	}
	if isVirtualInterface(net.Interface{Name: "Wi-Fi", Flags: net.FlagUp}) {
		t.Fatal("expected Wi-Fi not to be detected as virtual")
	}
	if isVirtualInterface(net.Interface{Name: "Ethernet", Flags: net.FlagUp}) {
		t.Fatal("expected Ethernet not to be detected as virtual")
	}
}

func TestInterfaceRankPrefersPhysicalOverVirtual(t *testing.T) {
	physical := LocalInterface{Name: "Wi-Fi", IsVirtual: false, IsPrivate: true, IsDefault: false}
	virtualDefault := LocalInterface{Name: "vEthernet (Default Switch)", IsVirtual: true, IsPrivate: true, IsDefault: true}

	if interfaceRank(physical) >= interfaceRank(virtualDefault) {
		t.Fatalf("expected physical private rank (%d) < virtual default rank (%d)", interfaceRank(physical), interfaceRank(virtualDefault))
	}
}

