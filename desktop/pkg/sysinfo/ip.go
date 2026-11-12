package sysinfo

import (
	"net"
	"os"
	"sort"
	"strings"
	"time"
)

// LocalInterface describes an active IPv4 network interface on this machine.
type LocalInterface struct {
	Name      string
	IP        net.IP
	IPNet     *net.IPNet
	IsVirtual bool
	IsPrivate bool
	IsDefault bool
}

var virtualInterfaceKeywords = []string{
	"vethernet",
	"wsl",
	"hyper-v",
	"virtualbox",
	"vbox",
	"vmware",
	"vmnet",
	"docker",
	"tailscale",
	"zerotier",
	"wireguard",
	"bluetooth",
	"npcap",
	"loopback",
	"tunnel",
	"teredo",
	"isatap",
}

func isVirtualInterface(iface net.Interface) bool {
	if iface.Flags&net.FlagPointToPoint != 0 {
		return true
	}
	lower := strings.ToLower(iface.Name)
	for _, kw := range virtualInterfaceKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

func isPrivateIPv4(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	if ip4[0] == 192 && ip4[1] == 168 {
		return true
	}
	if ip4[0] == 10 {
		return true
	}
	if ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31 {
		return true
	}
	return false
}

func isLinkLocalIPv4(ip net.IP) bool {
	ip4 := ip.To4()
	return ip4 != nil && ip4[0] == 169 && ip4[1] == 254
}

func getDefaultRouteIP() string {
	conn, err := net.DialTimeout("udp4", "8.8.8.8:80", 150*time.Millisecond)
	if err != nil {
		return ""
	}
	defer conn.Close()
	if udpAddr, ok := conn.LocalAddr().(*net.UDPAddr); ok && udpAddr.IP != nil {
		return udpAddr.IP.String()
	}
	return ""
}

func interfaceRank(li LocalInterface) int {
	switch {
	case !li.IsVirtual && li.IsPrivate && li.IsDefault:
		return 0
	case !li.IsVirtual && li.IsPrivate:
		return 1
	case !li.IsVirtual && li.IsDefault:
		return 2
	case !li.IsVirtual:
		return 3
	case li.IsPrivate && li.IsDefault:
		return 4
	case li.IsPrivate:
		return 5
	default:
		return 6
	}
}

// GetLocalInterfaces returns active non-loopback IPv4 interfaces sorted by LAN priority.
func GetLocalInterfaces() []LocalInterface {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}

	defaultIP := getDefaultRouteIP()
	var results []LocalInterface

	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		virtual := isVirtualInterface(iface)
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok || ipNet.IP.IsLoopback() {
				continue
			}
			ip4 := ipNet.IP.To4()
			if ip4 == nil || isLinkLocalIPv4(ip4) {
				continue
			}
			results = append(results, LocalInterface{
				Name:      iface.Name,
				IP:        ip4,
				IPNet:     ipNet,
				IsVirtual: virtual,
				IsPrivate: isPrivateIPv4(ip4),
				IsDefault: defaultIP != "" && ip4.String() == defaultIP,
			})
		}
	}

	sort.SliceStable(results, func(i, j int) bool {
		return interfaceRank(results[i]) < interfaceRank(results[j])
	})

	return results
}

// GetLocalIP returns the primary non-loopback IPv4 address of the local machine.
func GetLocalIP() string {
	ifaces := GetLocalInterfaces()
	if len(ifaces) > 0 {
		return ifaces[0].IP.String()
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
