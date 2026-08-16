import * as Network from 'expo-network';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import { Vibration } from 'react-native';
import { Peer, ChatMessage, FileOffer, FileProgress, PingAlert, Packet } from '../types/network';

type EventListener = (data: any) => void;

class NetworkService {
  private socket: WebSocket | null = null;
  private serverAddr: string = '';
  private listeners: Map<string, Set<EventListener>> = new Map();
  private isConnected: boolean = false;
  private currentPeers: Peer[] = [];
  private reconnectTimer: any = null;

  private outgoingTransfers: Map<string, { uri: string; fileName: string; fileSize: number }> = new Map();
  private incomingOffers: Map<string, FileOffer> = new Map();
  private incomingTransfers: Map<string, { fileUri: string; offer: FileOffer }> = new Map();

  private myPeer: Peer = {
    id: `android-${Math.random().toString(36).substring(2, 8)}`,
    nickname: 'Android-Device',
    ip: 'Fetching IP...',
    hostname: 'AndroidDevice',
    isHost: false,
    joinedAt: Date.now(),
  };

  constructor() {
    this.initDeviceIp();
    this.initAudioMode();
  }

  private async initAudioMode() {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: true,
      });
    } catch (err) {
      console.warn('[Android Audio] Init audio mode error:', err);
    }
  }

  private async playPingSound() {
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3' },
        { shouldPlay: true }
      );
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (err) {
      console.warn('[Android Audio] Error playing sound:', err);
    }
  }

  public getMyPeer(): Peer {
    return this.myPeer;
  }

  public getPeers(): Peer[] {
    return this.currentPeers;
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public getServerAddr(): string {
    return this.serverAddr;
  }

  private async initDeviceIp() {
    try {
      const ip = await Network.getIpAddressAsync();
      if (ip && ip !== '0.0.0.0' && ip !== '127.0.0.1') {
        this.myPeer.ip = ip;
        this.myPeer.nickname = `Android-${ip.split('.').pop() || 'Mobile'}`;
        this.myPeer.hostname = `Android-${ip}`;
        this.emit('peer-info-updated', this.myPeer);

        // Fast isolated subnet auto-discovery
        this.autoDiscoverHost(ip);
      } else {
        this.myPeer.ip = '127.0.0.1';
      }
    } catch (err) {
      console.warn('[Android Network] Could not fetch local IP:', err);
      this.myPeer.ip = '192.168.1.x';
    }
  }

  private async autoDiscoverHost(localIp: string) {
    const parts = localIp.split('.');
    if (parts.length !== 4) return;
    const subnetPrefix = `${parts[0]}.${parts[1]}.${parts[2]}`;

    const candidateIps: string[] = [];
    for (let i = 1; i <= 254; i++) {
      const candidate = `${subnetPrefix}.${i}`;
      if (candidate !== localIp) {
        candidateIps.push(candidate);
      }
    }

    // Sort to prioritize low host IPs (.1 - .30) and (.100 - .130) first
    candidateIps.sort((a, b) => {
      const lastA = parseInt(a.split('.').pop() || '0');
      const lastB = parseInt(b.split('.').pop() || '0');
      const weight = (val: number) => {
        if (val <= 30) return val;
        if (val >= 100 && val <= 130) return val - 50;
        return val + 200;
      };
      return weight(lastA) - weight(lastB);
    });

    const batchSize = 10;
    for (let i = 0; i < candidateIps.length; i += batchSize) {
      if (this.isConnected) break;
      const batch = candidateIps.slice(i, i + batchSize);
      await Promise.all(
        batch.map((targetIp) => {
          if (this.isConnected) return Promise.resolve(true);
          return this.probeHost(targetIp, 25252, 600);
        })
      );
    }
  }

  private probeHost(ip: string, port: number = 25252, timeoutMs: number = 600): Promise<boolean> {
    if (this.isConnected) return Promise.resolve(true);

    return new Promise((resolve) => {
      let ws: WebSocket | null = null;
      const timer = setTimeout(() => {
        if (ws) {
          try { ws.close(); } catch (_) { }
        }
        resolve(false);
      }, timeoutMs);

      try {
        ws = new WebSocket(`ws://${ip}:${port}/ws`);

        ws.onopen = () => {
          clearTimeout(timer);
          if (!this.isConnected) {
            this.attachSocket(ws!, `${ip}:${port}`);
            resolve(true);
          } else {
            try { ws!.close(); } catch (_) { }
            resolve(false);
          }
        };

        ws.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };

        ws.onclose = () => {
          clearTimeout(timer);
          resolve(false);
        };
      } catch (e) {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }

  private scheduleAutoReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(async () => {
      if (this.isConnected) {
        if (this.reconnectTimer) {
          clearInterval(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        return;
      }
      if (this.serverAddr) {
        const parts = this.serverAddr.split(':');
        const ip = parts[0];
        const port = parseInt(parts[1]) || 25252;
        const success = await this.probeHost(ip, port, 800);
        if (success) {
          if (this.reconnectTimer) {
            clearInterval(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          return;
        }
      }
      if (this.myPeer.ip && this.myPeer.ip !== 'Fetching IP...') {
        this.autoDiscoverHost(this.myPeer.ip);
      }
    }, 4000);
  }

  private attachSocket(ws: WebSocket, addr: string) {
    if (this.socket && this.socket !== ws) {
      try { this.socket.close(); } catch (_) { }
    }

    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket = ws;
    this.serverAddr = addr;
    this.isConnected = true;

    // Send JOIN packet to server
    const joinPayload = JSON.stringify({ peer: this.myPeer });
    this.sendPacket({ type: 'JOIN', payload: joinPayload });
    this.emit('connection-status', { connected: true, serverAddr: this.serverAddr });

    ws.onmessage = (event) => {
      try {
        const packet: Packet = JSON.parse(event.data);
        this.handleIncomingPacket(packet);
      } catch (e) {
        console.warn('[Android Network] Error parsing packet:', e);
      }
    };

    ws.onerror = () => {
      if (this.socket === ws) {
        console.warn('[Android Network] Socket error on active connection');
        this.isConnected = false;
        this.emit('connection-status', { connected: false, error: 'Connection error' });
        this.scheduleAutoReconnect();
      }
    };

    ws.onclose = () => {
      if (this.socket === ws) {
        console.log('[Android Network] Connection closed');
        this.isConnected = false;
        this.emit('connection-status', { connected: false });
        this.scheduleAutoReconnect();
      }
    };
  }

  public setNickname(newNick: string) {
    this.myPeer.nickname = newNick;
    if (this.isConnected && this.socket) {
      const payload = JSON.stringify({ peerId: this.myPeer.id, newNickname: newNick });
      this.sendPacket({ type: 'NICK_UPDATE', payload });
    }
  }

  public connect(serverIp: string, port: number = 25252): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isConnected && this.serverAddr === `${serverIp}:${port}`) {
        resolve(true);
        return;
      }

      const addr = `${serverIp}:${port}`;
      const wsUrl = `ws://${serverIp}:${port}/ws`;
      let ws: WebSocket | null = null;

      const timer = setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.OPEN) {
          try { ws.close(); } catch (_) { }
          resolve(false);
        }
      }, 3000);

      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          clearTimeout(timer);
          this.attachSocket(ws!, addr);
          resolve(true);
        };

        ws.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };

        ws.onclose = () => {
          clearTimeout(timer);
          resolve(false);
        };
      } catch (e) {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }

  public disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isConnected = false;
    this.emit('connection-status', { connected: false });
  }

  public sendChatMessage(targetId: string, content: string) {
    const msg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      senderId: this.myPeer.id,
      senderNick: this.myPeer.nickname,
      senderIp: this.myPeer.ip,
      targetId,
      content,
      timestamp: Date.now(),
    };

    const payload = JSON.stringify(msg);
    this.sendPacket({ type: 'CHAT', payload });
    // Emit locally for optimistic update
    this.emit('new-message', msg);
  }

  public sendPing(targetId: string) {
    const ping: PingAlert = {
      id: `ping-${Date.now()}`,
      senderId: this.myPeer.id,
      senderNick: this.myPeer.nickname,
      senderIp: this.myPeer.ip,
      targetId,
      timestamp: Date.now(),
    };

    const payload = JSON.stringify(ping);
    this.sendPacket({ type: 'PING', payload });
  }

  public async pickAndSendFile(targetId: string): Promise<boolean> {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (res.canceled || !res.assets || res.assets.length === 0) {
        return false;
      }

      const asset = res.assets[0];
      const transferId = `tr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const fileName = asset.name || 'file';
      const fileSize = asset.size || 0;
      const uri = asset.uri;

      this.outgoingTransfers.set(transferId, { uri, fileName, fileSize });

      const offer: FileOffer = {
        transferId,
        senderId: this.myPeer.id,
        senderNick: this.myPeer.nickname,
        senderIp: this.myPeer.ip,
        targetId,
        fileName,
        fileSize,
        timestamp: Date.now(),
      };

      const payload = JSON.stringify(offer);
      this.sendPacket({ type: 'FILE_OFFER', payload });
      this.emit('file-offer', offer);
      return true;
    } catch (err) {
      console.warn('[Android Network] DocumentPicker error:', err);
      return false;
    }
  }

  public async acceptFileTransfer(transferId: string, offer?: FileOffer) {
    let fileUri = '';
    const activeOffer = offer || this.incomingOffers.get(transferId);
    const fileName = activeOffer?.fileName || `file-${Date.now()}`;

    try {
      if (FileSystem.StorageAccessFramework) {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const directoryUri = permissions.directoryUri;
          fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
            directoryUri,
            fileName,
            'application/octet-stream'
          );
        }
      }
    } catch (err) {
      console.warn('[Android Network] StorageAccessFramework error:', err);
    }

    if (!fileUri) {
      // Fallback to Expo documentDirectory
      const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      fileUri = `${FileSystem.documentDirectory}${cleanName}`;
    }

    if (activeOffer) {
      this.incomingTransfers.set(transferId, { fileUri, offer: activeOffer });
    }

    // Initialize/clear file at target uri
    try {
      await FileSystem.writeAsStringAsync(fileUri, '', { encoding: 'base64' });
    } catch (_) { }

    const payload = JSON.stringify({
      transferId,
      recipientId: this.myPeer.id,
      accepted: true,
      savePath: fileUri,
    });
    this.sendPacket({ type: 'FILE_RESPONSE', payload });
    this.emit('file-progress', { transferId, status: 'transferring', progress: 0, savePath: fileUri });
  }

  public rejectFileTransfer(transferId: string) {
    const payload = JSON.stringify({
      transferId,
      recipientId: this.myPeer.id,
      accepted: false,
    });
    this.sendPacket({ type: 'FILE_RESPONSE', payload });
    this.emit('file-progress', { transferId, status: 'rejected', progress: 0 });
  }

  private async startStreamingFile(transferId: string) {
    const transfer = this.outgoingTransfers.get(transferId);
    if (!transfer) return;

    try {
      const { uri } = transfer;
      const base64Content = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });

      const chunkSize = 32 * 1024; // 32KB chunks
      const totalChunks = Math.ceil(base64Content.length / chunkSize) || 1;

      for (let i = 0; i < totalChunks; i++) {
        const chunkB64 = base64Content.substring(i * chunkSize, (i + 1) * chunkSize);
        const chunkPayload = JSON.stringify({
          transferId,
          chunkIndex: i,
          totalChunks,
          dataB64: chunkB64,
        });

        this.sendPacket({ type: 'FILE_CHUNK', payload: chunkPayload });

        const pct = Math.round(((i + 1) / totalChunks) * 100);
        const isComplete = i >= totalChunks - 1;
        this.emit('file-progress', {
          transferId,
          status: isComplete ? 'completed' : 'transferring',
          progress: pct,
        });

        // Small pause to prevent WebSocket frame congestion
        await new Promise((r) => setTimeout(r, 15));
      }
    } catch (err) {
      console.warn('[Android Network] Error streaming file:', err);
      this.emit('file-progress', {
        transferId,
        status: 'failed',
        progress: 0,
        error: String(err),
      });
    }
  }

  private sendPacket(packet: Packet) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(packet));
    }
  }

  private async handleIncomingPacket(packet: Packet) {
    try {
      switch (packet.type) {
        case 'JOIN_ACK': {
          const payload = JSON.parse(packet.payload);
          this.currentPeers = payload.peers || [];
          this.emit('peers-updated', this.currentPeers);
          break;
        }
        case 'PEER_LIST': {
          const payload = JSON.parse(packet.payload);
          this.currentPeers = payload.peers || [];
          this.emit('peers-updated', this.currentPeers);
          break;
        }
        case 'CHAT': {
          const chat: ChatMessage = JSON.parse(packet.payload);
          this.emit('new-message', chat);
          break;
        }
        case 'PING': {
          const ping: PingAlert = JSON.parse(packet.payload);

          // 1. Haptic Vibration Feedback
          try {
            Vibration.vibrate([0, 250, 250, 250]);
          } catch (_) { }

          // 2. Play Audio Ping Chime
          this.playPingSound();

          this.emit('ping-received', ping);
          break;
        }
        case 'FILE_OFFER': {
          const offer: FileOffer = JSON.parse(packet.payload);
          this.incomingOffers.set(offer.transferId, offer);
          this.emit('file-offer', offer);
          break;
        }
        case 'FILE_RESPONSE': {
          const resp = JSON.parse(packet.payload);
          this.emit('file-response', resp);
          if (resp.accepted) {
            this.startStreamingFile(resp.transferId);
          } else {
            this.emit('file-progress', { transferId: resp.transferId, status: 'rejected', progress: 0 });
          }
          break;
        }
        case 'FILE_CHUNK': {
          const chunkPayload = JSON.parse(packet.payload);
          const { transferId, chunkIndex, totalChunks, dataB64 } = chunkPayload;
          const transferInfo = this.incomingTransfers.get(transferId);

          if (transferInfo && dataB64) {
            try {
              await FileSystem.writeAsStringAsync(transferInfo.fileUri, dataB64, {
                encoding: 'base64',
                append: true,
              });
            } catch (err) {
              console.warn('[Android Network] Error writing chunk to file:', err);
            }
          }

          const currentChunk = (chunkIndex || 0) + 1;
          const total = totalChunks || 1;
          const progressPct = Math.min(100, Math.round((currentChunk / total) * 100));
          const isComplete = currentChunk >= total;

          this.emit('file-progress', {
            transferId,
            status: isComplete ? 'completed' : 'transferring',
            progress: progressPct,
            savePath: transferInfo?.fileUri,
          });
          break;
        }
        case 'FILE_PROGRESS':
        case 'FILE_STATUS': {
          const progress: FileProgress = JSON.parse(packet.payload);
          this.emit('file-progress', progress);
          break;
        }
      }
    } catch (e) {
      console.warn('[Android Network] Error handling packet:', e);
    }
  }

  public on(event: string, fn: EventListener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
  }

  public off(event: string, fn: EventListener) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.delete(fn);
    }
  }

  private emit(event: string, data: any) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach((fn) => fn(data));
    }
  }
}

export const networkService = new NetworkService();
