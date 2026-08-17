import React, { useState, useRef, useEffect } from 'react';
import { Peer, ChatMessage, FileOffer, FileProgress } from '../types';
import { FileCard } from './FileCard';
import { Send, Paperclip, Bell, Hash, User, Sparkles, WifiOff, RefreshCw, ArrowUp } from 'lucide-react';

interface TimelineItem {
  id: string;
  type: 'chat' | 'file' | 'ping';
  timestamp: number;
  chat?: ChatMessage;
  fileOffer?: FileOffer;
  pingSenderNick?: string;
  pingSenderIp?: string;
}

interface ChatAreaProps {
  myPeer: Peer;
  selectedTargetId: string;
  targetPeer?: Peer;
  messages: ChatMessage[];
  fileOffers: FileOffer[];
  fileProgresses: Record<string, FileProgress>;
  pings: Array<{ id: string; senderNick: string; senderIp: string; timestamp: number; targetId: string }>;
  onSendMessage: (text: string) => void;
  onSendFile: () => void;
  onSendPing: () => void;
  onAcceptFile: (transferId: string) => void;
  onRejectFile: (transferId: string) => void;
  onOpenFile?: (filePath: string) => void;
  onLoadOlder?: () => void;
  hasMoreHistory?: boolean;
  isLoadingOlder?: boolean;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  myPeer,
  selectedTargetId,
  targetPeer,
  messages,
  fileOffers,
  fileProgresses,
  pings,
  onSendMessage,
  onSendFile,
  onSendPing,
  onAcceptFile,
  onRejectFile,
  onOpenFile,
  onLoadOlder,
  hasMoreHistory,
  isLoadingOlder,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevScrollHeightRef = useRef<number>(0);

  // Filter items for currently selected channel/DM
  const isPublic = selectedTargetId === '';
  const isOfflinePeer = !isPublic && targetPeer && targetPeer.isOnline === false;

  // Combine and sort chat, file offers, and pings by timestamp
  const timelineItems: TimelineItem[] = [];

  // 1. Add Chat Messages
  messages.forEach(msg => {
    if (isPublic && (!msg.targetId || msg.targetId === '' || msg.targetId === 'general')) {
      timelineItems.push({ id: msg.id, type: 'chat', timestamp: msg.timestamp, chat: msg });
    } else if (!isPublic && (
      // Sent by me to target
      ((msg.senderId === myPeer.id || (Boolean(myPeer.hostname) && msg.senderHostname === myPeer.hostname)) &&
        (msg.targetId === selectedTargetId || (Boolean(targetPeer?.hostname) && msg.targetHostname === targetPeer?.hostname) || (Boolean(msg.targetHostname) && msg.targetHostname === selectedTargetId))) ||
      // Received from target to me
      ((msg.senderId === selectedTargetId || (Boolean(targetPeer?.hostname) && msg.senderHostname === targetPeer?.hostname) || (Boolean(msg.senderHostname) && msg.senderHostname === selectedTargetId)) &&
        (msg.targetId === myPeer.id || (Boolean(myPeer.hostname) && msg.targetHostname === myPeer.hostname) || !msg.targetId || msg.targetId === ''))
    )) {
      timelineItems.push({ id: msg.id, type: 'chat', timestamp: msg.timestamp, chat: msg });
    }
  });

  // 2. Add File Offers
  fileOffers.forEach(offer => {
    const isOfferPublic = !offer.targetId || offer.targetId === '' || offer.targetId === 'general';
    if (isPublic && isOfferPublic) {
      timelineItems.push({ id: offer.transferId, type: 'file', timestamp: offer.timestamp, fileOffer: offer });
    } else if (!isPublic && (
      // Sent by me to target peer
      ((offer.senderId === myPeer.id || (Boolean(myPeer.hostname) && offer.senderHostname === myPeer.hostname)) &&
        (offer.targetId === selectedTargetId || (Boolean(targetPeer?.hostname) && offer.targetHostname === targetPeer?.hostname) || (Boolean(offer.targetHostname) && offer.targetHostname === selectedTargetId))) ||
      // Received from target peer to me
      ((offer.senderId === selectedTargetId || (Boolean(targetPeer?.hostname) && offer.senderHostname === targetPeer?.hostname) || (Boolean(offer.senderHostname) && offer.senderHostname === selectedTargetId)) &&
        (offer.targetId === myPeer.id || (Boolean(myPeer.hostname) && offer.targetHostname === myPeer.hostname) || !offer.targetId || offer.targetId === ''))
    )) {
      timelineItems.push({ id: offer.transferId, type: 'file', timestamp: offer.timestamp, fileOffer: offer });
    }
  });

  // 3. Add Pings
  pings.forEach(p => {
    if (isPublic && p.targetId === '') {
      timelineItems.push({ id: p.id, type: 'ping', timestamp: p.timestamp, pingSenderNick: p.senderNick, pingSenderIp: p.senderIp });
    } else if (!isPublic && (p.targetId === myPeer.id || p.targetId === selectedTargetId)) {
      timelineItems.push({ id: p.id, type: 'ping', timestamp: p.timestamp, pingSenderNick: p.senderNick, pingSenderIp: p.senderIp });
    }
  });

  // Sort timeline chronologically
  timelineItems.sort((a, b) => a.timestamp - b.timestamp);

  // Handle scroll to top for cursor pagination
  const handleScroll = () => {
    if (containerRef.current) {
      if (containerRef.current.scrollTop < 25 && hasMoreHistory && !isLoadingOlder && onLoadOlder) {
        prevScrollHeightRef.current = containerRef.current.scrollHeight;
        onLoadOlder();
      }
    }
  };

  // Maintain scroll position when older history is prepended
  useEffect(() => {
    if (prevScrollHeightRef.current > 0 && containerRef.current) {
      const newScrollHeight = containerRef.current.scrollHeight;
      containerRef.current.scrollTop = newScrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = 0;
    } else if (timelineItems.length > 0 && prevScrollHeightRef.current === 0) {
      // Auto-scroll to bottom only if not loading older history
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [timelineItems.length]);

  // Auto-expand textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputText]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isOfflinePeer) return;
    onSendMessage(inputText);
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputText.trim() && !isOfflinePeer) {
        onSendMessage(inputText);
        setInputText('');
      }
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderMessageContent = (content: string) => {
    const isMultiLine = content.includes('\n');
    const isAsciiArt = isMultiLine || /[\/\\|_\-+=#@*~^`]{3,}/.test(content);

    if (isAsciiArt) {
      return (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-tight font-normal select-text overflow-x-auto m-0">
          {content}
        </pre>
      );
    }

    return (
      <p className="whitespace-pre-wrap break-words text-sm font-normal select-text m-0">
        {content}
      </p>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950/60 relative select-none">
      {/* Top Header Bar */}
      <header className="px-6 py-4 border-b border-slate-800/80 glass-card flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            {isPublic ? <Hash className="w-5 h-5" /> : <User className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="font-semibold text-slate-100 flex items-center gap-2 text-base">
              <span>{isPublic ? 'General Channel' : (targetPeer?.nickname || selectedTargetId)}</span>
              {isPublic ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-normal border border-indigo-500/30">
                  Public Broadcast
                </span>
              ) : (
                <span className={`text-xs px-2 py-0.5 rounded-full font-normal border ${isOfflinePeer ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'}`}>
                  {isOfflinePeer ? 'Offline Peer' : 'Direct Message'}
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              {isPublic ? 'All TakLan peers on local subnet' : `Host: ${targetPeer?.hostname || selectedTargetId} • IP: ${targetPeer?.ip || 'Offline'}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSendPing}
            disabled={Boolean(isOfflinePeer)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 text-amber-300 border border-amber-500/30 text-xs font-medium transition-colors"
            title={isOfflinePeer ? "Peer is offline" : "Ping User"}
          >
            <Bell className="w-4 h-4 text-amber-400" />
            Ping Alert
          </button>
        </div>
      </header>

      {/* Offline Peer Warning Banner */}
      {isOfflinePeer && (
        <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs flex items-center gap-2 font-medium">
          <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            This peer ({targetPeer?.nickname}) is currently offline. You can view previous message history, but new messages cannot be sent over LAN until the peer reconnects.
          </span>
        </div>
      )}

      {/* Messages Timeline Stream */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-6 space-y-4"
      >
        {/* Load Older Messages Button / Indicator */}
        {hasMoreHistory && (
          <div className="flex justify-center my-2">
            <button
              onClick={() => {
                if (containerRef.current) {
                  prevScrollHeightRef.current = containerRef.current.scrollHeight;
                }
                onLoadOlder?.();
              }}
              disabled={isLoadingOlder}
              className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/90 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold shadow-md transition-all disabled:opacity-50"
            >
              {isLoadingOlder ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  <span>Loading older history...</span>
                </>
              ) : (
                <>
                  <ArrowUp className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Load Older Messages</span>
                </>
              )}
            </button>
          </div>
        )}

        {timelineItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
            <Sparkles className="w-10 h-10 text-indigo-500/40 mb-2" />
            <p className="text-sm font-medium text-slate-400">No messages yet in this conversation</p>
            <p className="text-xs text-slate-600 mt-1">Send a message, ping a user, or share a file across LAN!</p>
          </div>
        ) : (
          timelineItems.map(item => {
            if (item.type === 'chat' && item.chat) {
              const isMe = item.chat.senderId === myPeer.id || item.chat.senderHostname === myPeer.hostname;
              return (
                <div
                  key={item.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-300">{item.chat.senderNick}</span>
                    <span className="font-mono text-cyan-400/80">({item.chat.senderHostname || item.chat.senderIp})</span>
                    <span>•</span>
                    <span>{formatTime(item.timestamp)}</span>
                  </div>

                  <div
                    className={`max-w-2xl px-4 py-2.5 rounded-2xl ${isMe
                      ? 'bg-indigo-600 text-white rounded-br-none shadow-md shadow-indigo-600/20'
                      : 'glass-card text-slate-100 rounded-bl-none border border-slate-700/60'
                      }`}
                  >
                    {renderMessageContent(item.chat.content)}
                  </div>
                </div>
              );
            }

            if (item.type === 'file' && item.fileOffer) {
              return (
                <div key={item.id} className="flex flex-col items-center my-2">
                  <FileCard
                    offer={item.fileOffer}
                    progress={fileProgresses[item.fileOffer.transferId]}
                    myPeer={myPeer}
                    onAccept={onAcceptFile}
                    onReject={onRejectFile}
                    onOpenFile={onOpenFile}
                  />
                </div>
              );
            }

            if (item.type === 'ping') {
              return (
                <div key={item.id} className="flex justify-center my-2">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold shadow-md animate-shake">
                    <Bell className="w-4 h-4 text-amber-400 animate-bounce" />
                    <span>🔔 {item.pingSenderNick} ({item.pingSenderIp}) sent a LAN Ping Alert!</span>
                    <span className="text-[10px] text-amber-400/70 font-mono">[{formatTime(item.timestamp)}]</span>
                  </div>
                </div>
              );
            }

            return null;
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input Footer */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-900/40">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <button
            type="button"
            onClick={onSendFile}
            disabled={Boolean(isOfflinePeer)}
            className="p-2.5 rounded-xl glass-input text-slate-400 hover:text-indigo-400 hover:border-indigo-500/40 disabled:opacity-40 transition-colors mb-0.5"
            title={isOfflinePeer ? "Peer is offline" : "Attach & Send File"}
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            disabled={Boolean(isOfflinePeer)}
            placeholder={
              isOfflinePeer
                ? "Peer is offline. Messages can only be sent when peer is online over LAN."
                : isPublic
                  ? "Broadcast message... (Enter to send, Shift+Enter for new line)"
                  : `Direct message to ${targetPeer?.nickname || 'Peer'}... (Enter to send, Shift+Enter for new line)`
            }
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 px-4 py-2.5 text-xs font-mono rounded-xl glass-input text-slate-100 placeholder-slate-500 focus:outline-none resize-none max-h-40 overflow-y-auto leading-relaxed disabled:opacity-50 disabled:bg-slate-900/60"
          />

          <button
            type="submit"
            disabled={!inputText.trim() || Boolean(isOfflinePeer)}
            className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium transition-all shadow-md shadow-indigo-600/20 mb-0.5"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
};
