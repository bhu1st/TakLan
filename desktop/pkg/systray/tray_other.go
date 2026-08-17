//go:build !windows

package systray

type Tray struct{}

func Start(appName string, onShow func(), onExit func()) *Tray {
	return &Tray{}
}

func (t *Tray) Stop() {}
