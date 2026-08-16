package sysinfo

import (
	"net"
	"os"
	"strings"
)

// GetLocalIP returns the primary non-loopback IPv4 address of the local machine.
func GetLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "127.0.0.1"
	}

	var fallbackIP string

	for _, addr := range addrs {
		ipNet, ok := addr.(*net.IPNet)
		if !ok || ipNet.IP.IsLoopback() {
			continue
		}

		ip := ipNet.IP.To4()
		if ip == nil {
			continue
		}

		ipStr := ip.String()

		// Skip link-local APIPA addresses (169.254.x.x)
		if strings.HasPrefix(ipStr, "169.254.") {
			continue
		}

		// Prefer standard private LAN ranges: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
		if strings.HasPrefix(ipStr, "192.168.") || strings.HasPrefix(ipStr, "10.") {
			return ipStr
		}

		if strings.HasPrefix(ipStr, "172.") {
			parts := strings.Split(ipStr, ".")
			if len(parts) >= 2 {
				secondOctet := parts[1]
				if secondOctet >= "16" && secondOctet <= "31" {
					return ipStr
				}
			}
		}

		if fallbackIP == "" {
			fallbackIP = ipStr
		}
	}

	if fallbackIP != "" {
		return fallbackIP
	}

	return "127.0.0.1"
}

// GetHostname returns the OS hostname or a sensible default.
func GetHostname() string {
	hostname, err := os.Hostname()
	if err != nil || hostname == "" {
		return "LAN-User"
	}
	return hostname
}
