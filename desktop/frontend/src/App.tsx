import React, { useEffect, useState, useRef } from 'react';
import packageJson from '../package.json';
import { Peer, ChatMessage, FileOffer, FileProgress, InitialState, LastMessageInfo } from './types';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { PingToast } from './components/PingToast';
import { playPrivateMessageAlert } from './utils/notification';
import {
  GetInitialState,
  GetMessageHistory,
  GetFileOffersHistory,
  OpenFile,
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
  const [serverAddr, setServerAddr] = useState('Connecting...');
  const [peers, setPeers] = useState<Peer[]>([]);

  const [selectedTargetId, setSelectedTargetId] = useState<string>(''); // "" for general channel
  const [selectedTargetHostname, setSelectedTargetHostname] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [fileOffers, setFileOffers] = useState<FileOffer[]>([]);
  const [fileProgresses, setFileProgresses] = useState<Record<string, FileProgress>>({});
  const [pings, setPings] = useState<Array<{ id: string; senderNick: string; senderIp: string; timestamp: number; targetId: string }>>([]);

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [lastMessages, setLastMessages] = useState<Record<string, LastMessageInfo>>({});

  const [activePingToast, setActivePingToast] = useState<{ senderNick: string; senderIp: string } | null>(null);

  const myPeerRef = useRef(myPeer);
  useEffect(() => {
    myPeerRef.current = myPeer;
  }, [myPeer]);

  const selectedTargetIdRef = useRef(selectedTargetId);
  const selectedTargetHostnameRef = useRef(selectedTargetHostname);
  useEffect(() => {
    selectedTargetIdRef.current = selectedTargetId;
    selectedTargetHostnameRef.current = selectedTargetHostname;

    const key = selectedTargetHostname || selectedTargetId;
    setUnreadCounts(prev => {
      if (!prev[key] && !prev[selectedTargetId]) return prev;
      const next = { ...prev };
      delete next[key];
      delete next[selectedTargetId];
      return next;
    });
  }, [selectedTargetId, selectedTargetHostname]);

  // Reset title on window focus
  useEffect(() => {
    document.title = `TakLan v${packageJson.version}`;
    const handleFocus = () => {
      document.title = `TakLan v${packageJson.version}`;
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Listen for window minimize to hide to system tray
  useEffect(() => {
    const handleMinimizeCheck = async () => {
      try {
        if ((window as any).runtime && (window as any).runtime.WindowIsMinimised) {
          const isMinimised = await (window as any).runtime.WindowIsMinimised();
          if (isMinimised && (window as any).runtime.WindowHide) {
            (window as any).runtime.WindowHide();
          }
        }
      } catch (e) {
        // ignore
      }
    };

    window.addEventListener('resize', handleMinimizeCheck);
    return () => {
      window.removeEventListener('resize', handleMinimizeCheck);
    };
  }, []);

  const [hasMoreHistory, setHasMoreHistory] = useState<boolean>(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);

  // Load message and file transfer history from SQLite DB with cursor pagination (latest 100 items)
  useEffect(() => {
    setMessages([]);
    setFileOffers([]);
    setHasMoreHistory(false);

    Promise.all([
      GetMessageHistory(selectedTargetHostname, selectedTargetId, 0, 100),
      GetFileOffersHistory(selectedTargetHostname, selectedTargetId, 0, 100),
    ])
      .then(([msgHistory, fileHistory]: [any[], any[]]) => {
        let msgCount = 0;
        let fileCount = 0;

        if (Array.isArray(msgHistory)) {
          msgCount = msgHistory.length;
          const formattedHistory: ChatMessage[] = msgHistory.map(item => ({
            id: item.id,
            senderId: item.senderId,
            senderHostname: item.senderHostname,
            senderNick: item.senderNick,
            senderIp: item.senderIp,
            targetId: item.targetHostname ? item.targetHostname : '',
            targetHostname: item.targetHostname,
            content: item.content,
            timestamp: item.timestamp,
          }));

          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newItems = formattedHistory.filter(m => !existingIds.has(m.id));
            return [...prev, ...newItems].sort((a, b) => a.timestamp - b.timestamp);
          });
        }

        if (Array.isArray(fileHistory)) {
          fileCount = fileHistory.length;
          const loadedOffers: FileOffer[] = fileHistory.map(item => ({
            transferId: item.transferId,
            senderId: item.senderId,
            senderHostname: item.senderHostname,
            senderNick: item.senderNick,
            senderIp: item.senderIp,
            targetId: item.targetHostname || '',
            targetHostname: item.targetHostname,
            fileName: item.fileName,
            fileSize: item.fileSize,
            savePath: item.savePath,
            timestamp: item.timestamp,
          }));

          setFileOffers(prev => {
            const existingIds = new Set(prev.map(o => o.transferId));
            const itemsToAdd = loadedOffers.filter(o => !existingIds.has(o.transferId));
            return [...prev, ...itemsToAdd];
          });

          fileHistory.forEach(item => {
            if (item.status) {
              setFileProgresses(prev => ({
                ...prev,
                [item.transferId]: {
                  transferId: item.transferId,
                  status: item.status,
                  progress: item.status === 'completed' ? 100 : 0,
                  savePath: item.savePath,
                }
              }));
            }
          });
        }

        if (msgCount >= 100 || fileCount >= 100) {
          setHasMoreHistory(true);
        }
      })
      .catch(err => {
        console.warn("Failed to load initial history from DB:", err);
      });
  }, [selectedTargetHostname, selectedTargetId]);

  const handleLoadOlderMessages = () => {
    if (isLoadingOlder || !hasMoreHistory) return;
    setIsLoadingOlder(true);

    const earliestMsg = messages.length > 0 ? Math.min(...messages.map(m => m.timestamp)) : 0;
    const earliestFile = fileOffers.length > 0 ? Math.min(...fileOffers.map(o => o.timestamp)) : 0;

    let beforeTimestamp = 0;
    if (earliestMsg > 0 && earliestFile > 0) {
      beforeTimestamp = Math.min(earliestMsg, earliestFile);
    } else if (earliestMsg > 0) {
      beforeTimestamp = earliestMsg;
    } else {
      beforeTimestamp = earliestFile;
    }

    if (beforeTimestamp <= 0) {
      setIsLoadingOlder(false);
      setHasMoreHistory(false);
      return;
    }

    Promise.all([
      GetMessageHistory(selectedTargetHostname, selectedTargetId, beforeTimestamp, 100),
      GetFileOffersHistory(selectedTargetHostname, selectedTargetId, beforeTimestamp, 100),
    ])
      .then(([olderMsgs, olderFiles]: [any[], any[]]) => {
        let msgCount = 0;
        let fileCount = 0;

        if (Array.isArray(olderMsgs)) {
          msgCount = olderMsgs.length;
          const formattedOlder: ChatMessage[] = olderMsgs.map(item => ({
            id: item.id,
            senderId: item.senderId,
            senderHostname: item.senderHostname,
            senderNick: item.senderNick,
            senderIp: item.senderIp,
            targetId: item.targetHostname ? item.targetHostname : '',
            targetHostname: item.targetHostname,
            content: item.content,
            timestamp: item.timestamp,
          }));

          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newItems = formattedOlder.filter(m => !existingIds.has(m.id));
            return [...newItems, ...prev].sort((a, b) => a.timestamp - b.timestamp);
          });
        }

        if (Array.isArray(olderFiles)) {
          fileCount = olderFiles.length;
          const loadedOffers: FileOffer[] = olderFiles.map(item => ({
            transferId: item.transferId,
            senderId: item.senderId,
            senderHostname: item.senderHostname,
            senderNick: item.senderNick,
            senderIp: item.senderIp,
            targetId: item.targetHostname || '',
            targetHostname: item.targetHostname,
            fileName: item.fileName,
            fileSize: item.fileSize,
            savePath: item.savePath,
            timestamp: item.timestamp,
          }));

          setFileOffers(prev => {
            const existingIds = new Set(prev.map(o => o.transferId));
            const itemsToAdd = loadedOffers.filter(o => !existingIds.has(o.transferId));
            return [...itemsToAdd, ...prev];
          });

          olderFiles.forEach(item => {
            if (item.status) {
              setFileProgresses(prev => ({
                ...prev,
                [item.transferId]: {
                  transferId: item.transferId,
                  status: item.status,
                  progress: item.status === 'completed' ? 100 : 0,
                  savePath: item.savePath,
                }
              }));
            }
          });
        }

        if (msgCount < 100 && fileCount < 100) {
          setHasMoreHistory(false);
        }
      })
      .catch(err => {
        console.warn("Failed to load older history batch:", err);
      })
      .finally(() => {
        setIsLoadingOlder(false);
      });
  };

  // Fetch initial connection state from Go Wails backend
  useEffect(() => {
    GetInitialState()
      .then((state: InitialState) => {
        if (state) {
          setIsHost(state.isHost);
          if (state.myPeer) setMyPeer({ ...state.myPeer, isHost: state.isHost });
          if (state.serverAddr) setServerAddr(state.serverAddr);
          if (state.peers) setPeers(state.peers);
        }
      })
      .catch(err => {
        console.warn("GetInitialState failed or running in browser mode:", err);
      });

    const handleStateUpdate = (state: InitialState) => {
      if (state) {
        setIsHost(state.isHost);
        if (state.myPeer) setMyPeer({ ...state.myPeer, isHost: state.isHost });
        if (state.serverAddr) setServerAddr(state.serverAddr);
        if (state.peers) setPeers(state.peers);
      }
    };

    EventsOn('initial-state-updated', handleStateUpdate);

    // Register Wails Real-Time Event Listeners
    EventsOn('peers-updated', (updatedPeers: Peer[]) => {
      setPeers(updatedPeers || []);
    });

    EventsOn('new-message', async (chatMsg: ChatMessage) => {
      setMessages(prev => {
        if (prev.some(m => m.id === chatMsg.id)) {
          return prev;
        }
        return [...prev, chatMsg];
      });

      const currentMyPeer = myPeerRef.current;
      const isFromOtherUser = Boolean(chatMsg.senderId && chatMsg.senderId !== currentMyPeer.id);
      const chatKey = chatMsg.targetHostname ? (chatMsg.senderHostname === currentMyPeer.hostname ? chatMsg.targetHostname : chatMsg.senderHostname) : (chatMsg.targetId === '' ? '' : chatMsg.senderId);

      // Track last message per target conversation
      setLastMessages(prev => ({
        ...prev,
        [chatKey || '']: {
          content: chatMsg.content,
          timestamp: chatMsg.timestamp,
          senderNick: chatMsg.senderNick,
        },
      }));

      if (isFromOtherUser) {
        const isCurrentChat = selectedTargetHostnameRef.current === chatKey || selectedTargetIdRef.current === chatKey;

        // Play audio chime for any incoming message from another peer
        playPrivateMessageAlert();

        if (!isCurrentChat) {
          setUnreadCounts(prev => ({
            ...prev,
            [chatKey || '']: (prev[chatKey || ''] || 0) + 1,
          }));
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
          document.title = `💬 (${chatMsg.senderNick}) TakLan v${packageJson.version}`;
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
      setFileProgresses(prev => {
        const existing = prev[progress.transferId];
        return {
          ...prev,
          [progress.transferId]: {
            ...existing,
            ...progress,
            savePath: progress.savePath || existing?.savePath,
          },
        };
      });
    });

    EventsOn('file-response', (resp: { transferId: string; accepted: boolean; savePath?: string }) => {
      setFileProgresses(prev => {
        const existing = prev[resp.transferId];
        return {
          ...prev,
          [resp.transferId]: {
            ...existing,
            transferId: resp.transferId,
            status: resp.accepted ? 'transferring' : 'rejected',
            progress: existing?.progress || 0,
            savePath: resp.savePath || existing?.savePath,
          },
        };
      });
    });
  }, []);

  // Handlers
  const handleSelectTarget = (targetId: string, targetHostname?: string) => {
    setSelectedTargetId(targetId);
    setSelectedTargetHostname(targetHostname || '');
    const key = targetHostname || targetId;
    setUnreadCounts(prev => {
      if (!prev[key] && !prev[targetId]) return prev;
      const next = { ...prev };
      delete next[key];
      delete next[targetId];
      return next;
    });
  };

  const handleSendMessage = (content: string) => {
    SendChatMessage(selectedTargetId, selectedTargetHostname, content).catch(err => {
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

  const targetPeer = peers.find(p => p.id === selectedTargetId || (selectedTargetHostname && p.hostname === selectedTargetHostname));

  const handleOpenFile = (filePath: string) => {
    if (filePath) {
      OpenFile(filePath).catch(err => {
        console.warn("Failed to open file:", err);
      });
    }
  };

  return (
    <div className="w-screen h-screen flex bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <Sidebar
        myPeer={myPeer}
        isHost={isHost}
        serverAddr={serverAddr}
        peers={peers}
        selectedTargetId={selectedTargetHostname || selectedTargetId}
        unreadCounts={unreadCounts}
        lastMessages={lastMessages}
        onSelectTarget={handleSelectTarget}
        onSendPing={handleSendPing}
      />

      {/* Main Chat Area */}
      <ChatArea
        myPeer={myPeer}
        selectedTargetId={selectedTargetHostname || selectedTargetId}
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
        onOpenFile={handleOpenFile}
        onLoadOlder={handleLoadOlderMessages}
        hasMoreHistory={hasMoreHistory}
        isLoadingOlder={isLoadingOlder}
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
