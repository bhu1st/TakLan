import React, { useState, useRef, useEffect } from 'react';
import { Peer, ChatMessage, FileOffer, FileProgress } from '../types';
import { FileCard } from './FileCard';
import { Send, Paperclip, Bell, Hash, User, ShieldAlert, Sparkles } from 'lucide-react';

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
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Filter items for currently selected channel/DM
  const isPublic = selectedTargetId === '';

  // Combine and sort chat, file offers, and pings by timestamp
  const timelineItems: TimelineItem[] = [];

  // 1. Add Chat Messages
  messages.forEach(msg => {
    if (isPublic && msg.targetId === '') {
      timelineItems.push({ id: msg.id, type: 'chat', timestamp: msg.timestamp, chat: msg });
    } else if (!isPublic && (
      (msg.senderId === myPeer.id && msg.targetId === selectedTargetId) ||
      (msg.senderId === selectedTargetId && msg.targetId === myPeer.id)
    )) {
      timelineItems.push({ id: msg.id, type: 'chat', timestamp: msg.timestamp, chat: msg });
    }
  });

  // 2. Add File Offers
  fileOffers.forEach(offer => {
    if (isPublic && offer.targetId === '') {
      timelineItems.push({ id: offer.transferId, type: 'file', timestamp: offer.timestamp, fileOffer: offer });
    } else if (!isPublic && (
      (offer.senderId === myPeer.id && offer.targetId === selectedTargetId) ||
      (offer.senderId === selectedTargetId && offer.targetId === myPeer.id)
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

  // Auto-scroll to bottom on new content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputText.trim()) {
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
      <div className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
        {content}
      </div>
    );
  };

  return (
    <main className="flex-1 h-full flex flex-col glass-panel bg-slate-950/80 select-text">
      {/* Active Conversation Top Bar */}
      <header className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/40">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-slate-800 text-indigo-400 border border-slate-700">
            {isPublic ? <Hash className="w-5 h-5" /> : <User className="w-5 h-5 text-cyan-400" />}
          </div>
          <div>
            <h2 className="font-semibold text-base text-slate-100 flex items-center gap-2">
              {isPublic ? 'General LAN Channel' : targetPeer?.nickname || 'Direct Message'}
            </h2>
            <p className="text-xs text-slate-400 font-mono">
              {isPublic ? 'Broadcast chat for all connected LAN peers' : `Direct Chat with ${targetPeer?.ip || 'Peer'}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSendFile}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors border border-slate-700"
            title="Send File"
          >
            <Paperclip className="w-4 h-4 text-indigo-400" />
            Send File
          </button>
          <button
            onClick={onSendPing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-medium transition-colors"
            title="Ping User"
          >
            <Bell className="w-4 h-4 text-amber-400" />
            Ping Alert
          </button>
        </div>
      </header>

      {/* Messages Timeline Stream */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {timelineItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
            <Sparkles className="w-10 h-10 text-indigo-500/40 mb-2" />
            <p className="text-sm font-medium text-slate-400">No messages yet in this conversation</p>
            <p className="text-xs text-slate-600 mt-1">Send a message, ping a user, or share a file across LAN!</p>
          </div>
        ) : (
          timelineItems.map(item => {
            if (item.type === 'chat' && item.chat) {
              const isMe = item.chat.senderId === myPeer.id;
              return (
                <div
                  key={item.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-300">{item.chat.senderNick}</span>
                    <span className="font-mono text-cyan-400/80">({item.chat.senderIp})</span>
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
            className="p-2.5 rounded-xl glass-input text-slate-400 hover:text-indigo-400 hover:border-indigo-500/40 transition-colors mb-0.5"
            title="Attach & Send File"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={
              isPublic
                ? "Broadcast message... (Enter to send, Shift+Enter for new line)"
                : `Direct message to ${targetPeer?.nickname || 'Peer'}... (Enter to send, Shift+Enter for new line)`
            }
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 px-4 py-2.5 text-xs font-mono rounded-xl glass-input text-slate-100 placeholder-slate-500 focus:outline-none resize-none max-h-40 overflow-y-auto leading-relaxed"
          />

          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium transition-all shadow-md shadow-indigo-600/20 mb-0.5"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </main>
  );
};
