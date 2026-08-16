package main

import (
	"embed"
	"encoding/json"
	"fmt"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed wails.json
var wailsJSON []byte

type WailsConfig struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

func main() {
	var config WailsConfig
	_ = json.Unmarshal(wailsJSON, &config)

	appVersion := config.Version
	if appVersion == "" {
		appVersion = "1.0.0"
	}

	windowTitle := fmt.Sprintf("LAN Msngr v%s", appVersion)

	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     windowTitle,
		Width:     1120,
		Height:    760,
		MinWidth:  900,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 15, G: 23, B: 42, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
