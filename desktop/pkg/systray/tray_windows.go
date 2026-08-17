//go:build windows

package systray

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows/registry"
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	procRegisterClassExW    = user32.NewProc("RegisterClassExW")
	procCreateWindowExW     = user32.NewProc("CreateWindowExW")
	procDefWindowProcW      = user32.NewProc("DefWindowProcW")
	procPostQuitMessage     = user32.NewProc("PostQuitMessage")
	procDestroyWindow       = user32.NewProc("DestroyWindow")
	procGetMessageW         = user32.NewProc("GetMessageW")
	procTranslateMessage    = user32.NewProc("TranslateMessage")
	procDispatchMessageW    = user32.NewProc("DispatchMessageW")
	procCreatePopupMenu     = user32.NewProc("CreatePopupMenu")
	procDestroyMenu         = user32.NewProc("DestroyMenu")
	procAppendMenuW         = user32.NewProc("AppendMenuW")
	procTrackPopupMenu      = user32.NewProc("TrackPopupMenu")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procGetCursorPos        = user32.NewProc("GetCursorPos")
	procLoadIconW           = user32.NewProc("LoadIconW")
	procExtractIconExW      = shell32.NewProc("ExtractIconExW")
	procShellNotifyIconW    = shell32.NewProc("Shell_NotifyIconW")
	procGetModuleHandleW    = kernel32.NewProc("GetModuleHandleW")
)

const (
	NIM_ADD    = 0x00000000
	NIM_MODIFY = 0x00000001
	NIM_DELETE = 0x00000002

	NIF_MESSAGE = 0x00000001
	NIF_ICON    = 0x00000002
	NIF_TIP     = 0x00000004

	WM_DESTROY  = 0x0002
	WM_USER     = 0x0400
	WM_TRAYICON = WM_USER + 1

	WM_LBUTTONUP     = 0x0202
	WM_LBUTTONDBLCLK = 0x0203
	WM_RBUTTONUP     = 0x0205
	WM_CONTEXTMENU   = 0x007B

	MF_STRING    = 0x00000000
	MF_CHECKED   = 0x00000008
	MF_UNCHECKED = 0x00000000
	MF_SEPARATOR = 0x00000800

	TPM_RETURNCMD   = 0x0100
	TPM_NONOTIFY    = 0x0080
	TPM_RIGHTBUTTON = 0x0002

	IDI_APPLICATION = 32512

	CMD_SHOW      = 1001
	CMD_AUTOSTART = 1002
	CMD_EXIT      = 1003
)

type POINT struct {
	X, Y int32
}

type MSG struct {
	HWnd    syscall.Handle
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      POINT
}

type WNDCLASSEXW struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     syscall.Handle
	HIcon         syscall.Handle
	HCursor       syscall.Handle
	HbrBackground syscall.Handle
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       syscall.Handle
}

type NOTIFYICONDATAW struct {
	CbSize            uint32
	HWnd              syscall.Handle
	UID               uint32
	UFlags            uint32
	UCallbackMessage  uint32
	HIcon             syscall.Handle
	SzTip             [128]uint16
	DwState           uint32
	DwStateMask       uint32
	SzInfo            [256]uint16
	UTimeoutOrVersion uint32
	SzInfoTitle       [64]uint16
	DwInfoFlags       uint32
	GuidItem          [16]byte
	HBalloonIcon      syscall.Handle
}

type Tray struct {
	appName string
	hWnd    syscall.Handle
	nid     NOTIFYICONDATAW
	onShow  func()
	onExit  func()
}

var currentTray *Tray

func utf16Ptr(s string) *uint16 {
	res, _ := syscall.UTF16PtrFromString(s)
	return res
}

func IsAutoStartEnabled(appName string) bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()

	val, _, err := k.GetStringValue(appName)
	if err != nil || val == "" {
		return false
	}
	return true
}

func SetAutoStart(appName string, enable bool) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()

	if enable {
		exePath, err := os.Executable()
		if err != nil {
			return err
		}
		exePath, _ = filepath.Abs(exePath)
		return k.SetStringValue(appName, fmt.Sprintf(`"%s"`, exePath))
	} else {
		err := k.DeleteValue(appName)
		if err != nil && err != registry.ErrNotExist {
			return err
		}
		return nil
	}
}

func trayWndProc(hWnd syscall.Handle, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case WM_TRAYICON:
		switch lParam {
		case WM_LBUTTONUP, WM_LBUTTONDBLCLK:
			if currentTray != nil && currentTray.onShow != nil {
				currentTray.onShow()
			}
		case WM_RBUTTONUP, WM_CONTEXTMENU:
			if currentTray != nil {
				currentTray.showContextMenu()
			}
		}
		return 0
	case WM_DESTROY:
		procPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(uintptr(hWnd), uintptr(msg), wParam, lParam)
	return r
}

func (t *Tray) showContextMenu() {
	var pt POINT
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWindow.Call(uintptr(t.hWnd))

	hMenu, _, _ := procCreatePopupMenu.Call()
	if hMenu == 0 {
		return
	}
	defer procDestroyMenu.Call(hMenu)

	procAppendMenuW.Call(hMenu, uintptr(MF_STRING), uintptr(CMD_SHOW), uintptr(unsafe.Pointer(utf16Ptr("Open LAN Msngr"))))

	autoStartFlags := uintptr(MF_STRING)
	if IsAutoStartEnabled(t.appName) {
		autoStartFlags |= uintptr(MF_CHECKED)
	}
	procAppendMenuW.Call(hMenu, autoStartFlags, uintptr(CMD_AUTOSTART), uintptr(unsafe.Pointer(utf16Ptr("Run at Startup"))))

	procAppendMenuW.Call(hMenu, uintptr(MF_SEPARATOR), 0, 0)
	procAppendMenuW.Call(hMenu, uintptr(MF_STRING), uintptr(CMD_EXIT), uintptr(unsafe.Pointer(utf16Ptr("Exit"))))

	cmd, _, _ := procTrackPopupMenu.Call(
		hMenu,
		uintptr(TPM_RETURNCMD|TPM_NONOTIFY|TPM_RIGHTBUTTON),
		uintptr(pt.X),
		uintptr(pt.Y),
		0,
		uintptr(t.hWnd),
		0,
	)

	switch cmd {
	case CMD_SHOW:
		if t.onShow != nil {
			t.onShow()
		}
	case CMD_AUTOSTART:
		enabled := IsAutoStartEnabled(t.appName)
		_ = SetAutoStart(t.appName, !enabled)
	case CMD_EXIT:
		if t.onExit != nil {
			t.onExit()
		}
	}
}

func Start(appName string, onShow func(), onExit func()) *Tray {
	t := &Tray{
		appName: appName,
		onShow:  onShow,
		onExit:  onExit,
	}
	currentTray = t

	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		hInstance, _, _ := procGetModuleHandleW.Call(0)
		className := "LANMsngrTrayClass"

		wndClass := WNDCLASSEXW{
			CbSize:        uint32(unsafe.Sizeof(WNDCLASSEXW{})),
			LpfnWndProc:   syscall.NewCallback(trayWndProc),
			HInstance:     syscall.Handle(hInstance),
			LpszClassName: utf16Ptr(className),
		}

		procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wndClass)))

		hWnd, _, _ := procCreateWindowExW.Call(
			0,
			uintptr(unsafe.Pointer(utf16Ptr(className))),
			uintptr(unsafe.Pointer(utf16Ptr(appName))),
			0,
			0, 0, 0, 0,
			0, 0,
			hInstance,
			0,
		)

		if hWnd == 0 {
			return
		}
		t.hWnd = syscall.Handle(hWnd)

		var hIcon syscall.Handle
		exePath, err := os.Executable()
		if err == nil {
			var hLarge, hSmall syscall.Handle
			r, _, _ := procExtractIconExW.Call(
				uintptr(unsafe.Pointer(utf16Ptr(exePath))),
				0,
				uintptr(unsafe.Pointer(&hLarge)),
				uintptr(unsafe.Pointer(&hSmall)),
				1,
			)
			if r > 0 && hSmall != 0 {
				hIcon = hSmall
			} else if r > 0 && hLarge != 0 {
				hIcon = hLarge
			}
		}
		if hIcon == 0 {
			h, _, _ := procLoadIconW.Call(0, uintptr(IDI_APPLICATION))
			hIcon = syscall.Handle(h)
		}

		t.nid = NOTIFYICONDATAW{
			CbSize:           uint32(unsafe.Sizeof(NOTIFYICONDATAW{})),
			HWnd:             t.hWnd,
			UID:              1,
			UFlags:           NIF_ICON | NIF_MESSAGE | NIF_TIP,
			UCallbackMessage: WM_TRAYICON,
			HIcon:            hIcon,
		}

		tipUtf16, _ := syscall.UTF16FromString(appName)
		copy(t.nid.SzTip[:], tipUtf16)

		procShellNotifyIconW.Call(uintptr(NIM_ADD), uintptr(unsafe.Pointer(&t.nid)))

		var msg MSG
		for {
			r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
			if r == 0 || int32(r) == -1 {
				break
			}
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
			procDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
		}
	}()

	return t
}

func (t *Tray) Stop() {
	if t.hWnd != 0 {
		procShellNotifyIconW.Call(uintptr(NIM_DELETE), uintptr(unsafe.Pointer(&t.nid)))
		procDestroyWindow.Call(uintptr(t.hWnd))
		t.hWnd = 0
	}
}
