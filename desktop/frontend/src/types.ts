export interface Peer {
  id: string;
  nickname: string;
  ip: string;
  hostname: string;
  isHost: boolean;
  joinedAt: number;
  isOnline?: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderHostname?: string;
  senderNick: string;
  senderIp: string;
  targetId: string;
  targetHostname?: string;
  content: string;
  timestamp: number;
}

export interface PingAlert {
  senderId: string;
  senderNick: string;
  senderIp: string;
  targetId: string;
  timestamp: number;
}

export interface FileOffer {
  transferId: string;
  senderId: string;
  senderHostname?: string;
  senderNick: string;
  senderIp: string;
  targetId: string;
  targetHostname?: string;
  fileName: string;
  fileSize: number;
  savePath?: string;
  timestamp: number;
}

export interface FileProgress {
  transferId: string;
  status: 'offered' | 'transferring' | 'completed' | 'failed' | 'rejected';
  progress: number;
  error?: string;
  savePath?: string;
}

export interface InitialState {
  myPeer: Peer;
  isHost: boolean;
  serverAddr: string;
  peers: Peer[];
}

export interface LastMessageInfo {
  content: string;
  timestamp: number;
  senderNick: string;
}
