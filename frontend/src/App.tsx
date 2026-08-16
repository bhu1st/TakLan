import React, { useEffect, useState, useRef } from 'react';
import { Peer, ChatMessage, FileOffer, FileProgress, InitialState, LastMessageInfo } from './types';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { NicknameModal } from './components/NicknameModal';
import { PingToast } from './components/PingToast';
import { playPrivateMessageAlert } from './utils/notification';
import {
  GetInitialState,
  SetNickname,
  SendChatMessage,
  SendPing,
  SelectAndSendFile,
  AcceptFileTransfer,
  RejectFileTransfer,
} from '../wailsjs/go/main/App';

// Safe wrapper for Wails runtime events listener
const EventsOn = (eventName: string, callback: (...args: any[]) => void) => {
  if ((window as any).runtime && (window as any).runtime.EventsOn) {
    (window as any).runtime.EventsOn(eventName, callback);
  }
};

export function App() {
  const [myPeer, setMyPeer] = useState<Peer>({
    id: 'local',
    nickname: 'Connecting...',
    ip: '127.0.0.1',
    hostname: 'Localhost',
    isHost: false,
    joinedAt: Date.now(),
  });
  const [isHost, setIsHost] = useState(false);
  const [serverAddr, setServerAddr] = useState('127.0.0.1:25252');
  const [peers, setPeers] = useState<Peer[]>([]);

  const [selectedTargetId, setSelectedTargetId] = useState<string>(''); // "" for general channel
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [fileOffers, setFileOffers] = useState<FileOffer[]>([]);
  const [fileProgresses, setFileProgresses] = useState<Record<string, FileProgress>>({});
  const [pings, setPings] = useState<Array<{ id: string; senderNick: string; senderIp: string; timestamp: number; targetId: string }>>([]);

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [lastMessages, setLastMessages] = useState<Record<string, LastMessageInfo>>({});

  const [activePingToast, setActivePingToast] = useState<{ senderNick: string; senderIp: string } | null>(null);
  const [isNicknameModalOpen, setIsNicknameModalOpen] = useState(false);

  const myPeerRef = useRef(myPeer);
  useEffect(() => {
    myPeerRef.current = myPeer;
  }, [myPeer]);

  const selectedTargetIdRef = useRef(selectedTargetId);
  useEffect(() => {
    selectedTargetIdRef.current = selectedTargetId;
    // Clear unread count for active conversation when selectedTargetId changes
    setUnreadCounts(prev => {
      if (!prev[selectedTargetId]) return prev;
      const next = { ...prev };
      delete next[selectedTargetId];
      return next;
    });
  }, [selectedTargetId]);

  // Reset title on window focus
  useEffect(() => {
    document.title = 'LAN Messenger v1.0.0';
    const handleFocus = () => {
      document.title = 'LAN Messenger v1.0.0';
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Fetch initial connection state from Go Wails backend
  useEffect(() => {
    GetInitialState()
      .then((state: InitialState) => {
        if (state) {
          if (state.myPeer) setMyPeer(state.myPeer);
          setIsHost(state.isHost);
          if (state.serverAddr) setServerAddr(state.serverAddr);
          if (state.peers) setPeers(state.peers);
        }
      })
      .catch(err => {
        console.warn("GetInitialState failed or running in browser mode:", err);
      });

    // Register Wails Real-Time Event Listeners
    EventsOn('peers-updated', (updatedPeers: Peer[]) => {
      setPeers(updatedPeers || []);
    });

    EventsOn('new-message', async (chatMsg: ChatMessage) => {
      setMessages(prev => [...prev, chatMsg]);

      const currentMyPeer = myPeerRef.current;
      const isFromOtherUser = Boolean(chatMsg.senderId && chatMsg.senderId !== currentMyPeer.id);
      const chatKey = chatMsg.targetId === '' ? '' : chatMsg.senderId;

      // Track last message per target conversation
      setLastMessages(prev => ({
        ...prev,
        [chatKey]: {
          content: chatMsg.content,
          timestamp: chatMsg.timestamp,
          senderNick: chatMsg.senderNick,
        },
      }));

      if (isFromOtherUser) {
        const isCurrentChat = selectedTargetIdRef.current === chatKey;

        if (!isCurrentChat) {
          setUnreadCounts(prev => ({
            ...prev,
            [chatKey]: (prev[chatKey] || 0) + 1,
          }));
          playPrivateMessageAlert();
        }

        let isMinimised = false;
        try {
          if ((window as any).runtime && (window as any).runtime.WindowIsMinimised) {
            isMinimised = await (window as any).runtime.WindowIsMinimised();
          }
        } catch {
          isMinimised = false;
        }

        const isBackgrounded = isMinimised || document.hidden || !document.hasFocus();

        if (isBackgrounded) {
          document.title = `💬 (${chatMsg.senderNick}) LAN Messenger v1.0.0`;
        }
      }
    });

    EventsOn('ping-received', (pingData: any) => {
      const newPing = {
        id: `ping-${Date.now()}-${Math.random()}`,
        senderNick: pingData.senderNick || 'Peer',
        senderIp: pingData.senderIp || '192.168.x.x',
        timestamp: pingData.timestamp || Date.now(),
        targetId: pingData.targetId || '',
      };
      setPings(prev => [...prev, newPing]);
      setActivePingToast({ senderNick: newPing.senderNick, senderIp: newPing.senderIp });
    });

    EventsOn('file-offer', (offer: FileOffer) => {
      setFileOffers(prev => [...prev, offer]);

      const currentMyPeer = myPeerRef.current;
      const isFromOtherUser = Boolean(offer.senderId && offer.senderId !== currentMyPeer.id);
      const chatKey = offer.targetId === '' ? '' : offer.senderId;

      setLastMessages(prev => ({
        ...prev,
        [chatKey]: {
          content: `📁 Offered file: ${offer.fileName}`,
          timestamp: offer.timestamp,
          senderNick: offer.senderNick,
        },
      }));

      if (isFromOtherUser) {
        const isCurrentChat = selectedTargetIdRef.current === chatKey;
        if (!isCurrentChat) {
          setUnreadCounts(prev => ({
            ...prev,
            [chatKey]: (prev[chatKey] || 0) + 1,
          }));
          playPrivateMessageAlert();
        }
      }
    });

    EventsOn('file-progress', (progress: FileProgress) => {
      setFileProgresses(prev => ({
        ...prev,
        [progress.transferId]: progress,
      }));
    });

    EventsOn('file-response', (resp: { transferId: string; accepted: boolean; savePath?: string }) => {
      setFileProgresses(prev => ({
        ...prev,
        [resp.transferId]: {
          transferId: resp.transferId,
          status: resp.accepted ? 'transferring' : 'rejected',
          progress: resp.accepted ? 0 : 0,
          savePath: resp.savePath,
        },
      }));
    });
  }, []);

  // Handlers
  const handleSelectTarget = (targetId: string) => {
    setSelectedTargetId(targetId);
    setUnreadCounts(prev => {
      if (!prev[targetId]) return prev;
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
  };

  const handleSendMessage = (content: string) => {
    SendChatMessage(selectedTargetId, content).catch(err => {
      console.error("Failed to send message:", err);
    });
  };

  const handleSendFile = () => {
    SelectAndSendFile(selectedTargetId).catch(err => {
      console.error("Failed to offer file:", err);
    });
  };

  const handleSendPing = (targetId: string = selectedTargetId) => {
    SendPing(targetId).catch(err => {
      console.error("Failed to send ping:", err);
    });
  };

  const handleAcceptFile = (transferId: string) => {
    // Triggers Wails native save file dialog per transfer!
    AcceptFileTransfer(transferId).catch(err => {
      console.error("Failed to accept file transfer:", err);
    });
  };

  const handleRejectFile = (transferId: string) => {
    RejectFileTransfer(transferId).catch(err => {
      console.error("Failed to reject file transfer:", err);
    });
  };

  const handleSaveNickname = (newNick: string) => {
    SetNickname(newNick)
      .then(() => {
        setMyPeer(prev => ({ ...prev, nickname: newNick }));
      })
      .catch(err => {
        console.error("Failed to update nickname:", err);
      });
  };

  const targetPeer = peers.find(p => p.id === selectedTargetId);

  return (
    <div className="w-screen h-screen flex bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <Sidebar
        myPeer={myPeer}
        isHost={isHost}
        serverAddr={serverAddr}
        peers={peers}
        selectedTargetId={selectedTargetId}
        unreadCounts={unreadCounts}
        lastMessages={lastMessages}
        onSelectTarget={handleSelectTarget}
        onOpenNicknameModal={() => setIsNicknameModalOpen(true)}
        onSendPing={handleSendPing}
      />

      {/* Main Chat Area */}
      <ChatArea
        myPeer={myPeer}
        selectedTargetId={selectedTargetId}
        targetPeer={targetPeer}
        messages={messages}
        fileOffers={fileOffers}
        fileProgresses={fileProgresses}
        pings={pings}
        onSendMessage={handleSendMessage}
        onSendFile={handleSendFile}
        onSendPing={() => handleSendPing(selectedTargetId)}
        onAcceptFile={handleAcceptFile}
        onRejectFile={handleRejectFile}
      />

      {/* Nickname Editor Modal */}
      <NicknameModal
        myPeer={myPeer}
        isOpen={isNicknameModalOpen}
        onClose={() => setIsNicknameModalOpen(false)}
        onSaveNickname={handleSaveNickname}
      />

      {/* Floating Ping Alert Toast */}
      {activePingToast && (
        <PingToast
          senderNick={activePingToast.senderNick}
          senderIp={activePingToast.senderIp}
          onDismiss={() => setActivePingToast(null)}
        />
      )}
    </div>
  );
}

export default App;
