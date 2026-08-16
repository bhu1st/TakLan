# LAN Msngr v1.0.0

A modern, cross-platform desktop application built with **Go**, **Wails v2**, **React**, and **Tailwind CSS** for real-time messaging and high-speed file transfer across Local Area Networks (LAN).

---

## Architecture Overview

- **Auto-Server Election & UDP Discovery**:
  - The first node launched on a LAN binds TCP port `25252` and becomes the **Host Server**, broadcasting heartbeats over UDP port `25253`.
  - Subsequent instances auto-discover the host via UDP and connect as **Peer Clients**.
- **Real-Time P2P Chat & File Streaming**:
  - Supports General broadcast channel and 1-on-1 private messaging.
  - Efficient chunked binary file transfer streams directly to recipient devices.
- **Audio Chime Alerts & Branding**:
  - Web Audio API synth chimes for incoming private messages and broadcast pings.

---

## Live Development

To run in live development mode:

```bash
wails dev
```

This starts a Vite dev server with instant hot-reloading for React frontend changes and Go backend binding generation.

---

## Production Build

To compile production release binaries to `build/bin/`:

```bash
wails build
```

The resulting executable (`build/bin/lanmsngr.exe`) can be distributed to any device on your local network.

---

## License

Distributed under the [MIT License](LICENSE).
Copyright (c) 2026 bhu1st.
