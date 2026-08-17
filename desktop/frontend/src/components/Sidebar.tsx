import React, { useState } from 'react';
import packageJson from '../../package.json';
import { Peer, LastMessageInfo } from '../types';
import { Users, Bell, Search, Hash, Wifi } from 'lucide-react';

interface SidebarProps {
  myPeer: Peer;
  isHost: boolean;
  serverAddr: string;
  peers: Peer[];
  selectedTargetId: string; // "" for public channel, or peerId/hostname for DM
  unreadCounts: Record<string, number>;
  lastMessages: Record<string, LastMessageInfo>;
  onSelectTarget: (targetId: string, targetHostname?: string) => void;
  onSendPing: (targetId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  myPeer,
  isHost,
  serverAddr,
  peers,
  selectedTargetId,
  unreadCounts,
  lastMessages,
  onSelectTarget,
  onSendPing,
}) => {
  const [search, setSearch] = useState('');

  // Filter out self and match search
  const activePeers = peers.filter(p => p.hostname !== myPeer.hostname && p.id !== myPeer.id);
  const filteredPeers = activePeers.filter(p =>
    p.nickname.toLowerCase().includes(search.toLowerCase()) ||
    p.ip.includes(search) ||
    p.hostname.toLowerCase().includes(search.toLowerCase())
  );

  // Sort peers: online first, then unread messages, then by most recent message, then alphabetically
  const sortedPeers = [...filteredPeers].sort((a, b) => {
    const isOnlineA = a.isOnline !== false ? 1 : 0;
    const isOnlineB = b.isOnline !== false ? 1 : 0;
    if (isOnlineA !== isOnlineB) {
      return isOnlineB - isOnlineA;
    }

    const keyA = a.hostname || a.id;
    const keyB = b.hostname || b.id;
    const unreadA = unreadCounts[keyA] || unreadCounts[a.id] || 0;
    const unreadB = unreadCounts[keyB] || unreadCounts[b.id] || 0;
    if (unreadA !== unreadB) {
      return unreadB - unreadA;
    }
    const timeA = lastMessages[keyA]?.timestamp || lastMessages[a.id]?.timestamp || 0;
    const timeB = lastMessages[keyB]?.timestamp || lastMessages[b.id]?.timestamp || 0;
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    return a.nickname.localeCompare(b.nickname);
  });

  const generalUnread = unreadCounts[''] || 0;
  const generalLastMsg = lastMessages[''];

  const formatRelativeTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const now = Date.now();
    const diffSec = Math.floor((now - timestamp) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h`;
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const onlineCount = peers.filter(p => p.isOnline !== false && p.id !== myPeer.id && p.hostname !== myPeer.hostname).length;

  return (
    <aside className="w-80 h-full flex flex-col glass-panel border-r border-slate-800 select-none">
      {/* App Branding & Network Node Badge */}
      <div className="p-3.5 border-b border-slate-800/80 bg-slate-900/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl overflow-hidden border border-indigo-500/30 shadow-md shadow-indigo-500/20 shrink-0 bg-slate-900 flex items-center justify-center">
              <img src="/icon.png" alt="TakLan Logo" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-slate-100 text-sm tracking-wide whitespace-nowrap">
                  TakLan
                </h1>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-medium border border-indigo-500/30 shrink-0">
                  v{packageJson.version}
                </span>
              </div>
              <div className="text-[11px] font-mono text-cyan-400 flex items-center gap-1 mt-0.5 whitespace-nowrap">
                <Wifi className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="truncate">{serverAddr}</span>
              </div>
            </div>
          </div>

          <div className="shrink-0">
            <span
              className={`text-[10px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap flex items-center gap-1.5 shadow-sm ${isHost
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-800/80 text-slate-300 border-slate-700'
                }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${isHost ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
              <span>{isHost ? '👑 Host' : 'Client'}</span>
            </span>
          </div>
        </div>
      </div>

      {/* User Profile Card */}
      <div className="p-3.5 mx-3 my-3 rounded-xl bg-slate-900/60 border border-slate-800 shadow-inner">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white shadow">
                {myPeer.nickname.charAt(0).toUpperCase()}
              </div>
              <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-slate-900" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="font-semibold text-sm text-slate-100 truncate max-w-[130px]">
                  {myPeer.nickname}
                </h3>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${isHost ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                  {isHost ? '👑 Host' : 'Client'}
                </span>
              </div>
              <div className="text-xs text-slate-400 font-mono flex items-center gap-1">
                <span className="text-cyan-400">{myPeer.ip}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Channels Section */}
      <div className="px-3 mb-2">
        <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase px-2 mb-1">
          Channels
        </div>
        <button
          onClick={() => onSelectTarget('', '')}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${selectedTargetId === ''
            ? 'bg-indigo-600/90 text-white shadow-md shadow-indigo-600/20'
            : generalUnread > 0
              ? 'bg-gradient-to-r from-indigo-950/90 to-slate-900/90 text-indigo-100 border-2 border-indigo-500/70 shadow-lg shadow-indigo-500/20 animate-pulse-subtle ring-1 ring-indigo-500/40'
              : 'text-slate-300 hover:bg-slate-800/60'
            }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative shrink-0">
              <Hash className={`w-4 h-4 ${generalUnread > 0 && selectedTargetId !== '' ? 'text-indigo-300 animate-bounce' : 'text-indigo-400'}`} />
              {generalUnread > 0 && selectedTargetId !== '' && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-indigo-400 animate-ping" />
              )}
            </div>
            <div className="min-w-0 text-left">
              <div className="flex items-center gap-1.5">
                <span className={`font-semibold ${generalUnread > 0 && selectedTargetId !== '' ? 'text-white' : ''}`}>
                  General LAN Chat
                </span>
              </div>
              {generalLastMsg && (
                <p className={`text-[10px] truncate max-w-[140px] ${generalUnread > 0 && selectedTargetId !== '' ? 'text-indigo-200 font-medium' : 'text-slate-400'}`}>
                  {generalLastMsg.senderNick}: {generalLastMsg.content.replace(/\s+/g, ' ')}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {generalUnread > 0 && selectedTargetId !== '' ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md shadow-indigo-500/40 animate-pulse">
                {generalUnread > 99 ? '99+' : generalUnread}
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-900/50 text-indigo-200 font-mono">
                {onlineCount} online
              </span>
            )}
          </div>
        </button>
      </div>

      {/* Peer List Header & Search */}
      <div className="px-3 pt-2 pb-1 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-2 mb-2">
          <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-indigo-400" />
            <span>Devices ({activePeers.length})</span>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative mb-2">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search nickname, hostname or IP..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg glass-input text-slate-200 placeholder-slate-500 focus:outline-none"
          />
        </div>

        {/* Peer List */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {sortedPeers.length === 0 ? (
            <div className="py-8 px-4 text-center text-xs text-slate-400 font-medium bg-slate-900/40 rounded-xl border border-slate-800/80 my-2">
              {search ? (
                'No clients match search'
              ) : isHost ? (
                <div className="space-y-1">
                  <p className="text-emerald-400 font-semibold flex items-center justify-center gap-1">
                    <span>👑</span> You are the LAN Host
                  </p>
                  <p className="text-[11px] text-slate-400">Waiting for other desktop or Android devices to connect...</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-indigo-400 font-semibold">📡 Connected to Host Server</p>
                  <p className="text-[11px] text-slate-400">Waiting for other peers to join LAN...</p>
                </div>
              )}
            </div>
          ) : (
            sortedPeers.map(peer => {
              const peerKey = peer.hostname || peer.id;
              const isSelected = selectedTargetId === peer.id || selectedTargetId === peer.hostname;
              const unreadCount = unreadCounts[peerKey] || unreadCounts[peer.id] || 0;
              const lastMsg = lastMessages[peerKey] || lastMessages[peer.id];
              const isOnline = peer.isOnline !== false;

              return (
                <div
                  key={peer.id || peer.hostname}
                  onClick={() => onSelectTarget(peer.id, peer.hostname)}
                  className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all ${isSelected
                    ? 'bg-slate-800/90 text-white border border-indigo-500/40 shadow-lg shadow-indigo-500/10'
                    : unreadCount > 0
                      ? 'bg-gradient-to-r from-indigo-950/90 to-slate-900/90 border-2 border-indigo-500/70 text-slate-100 shadow-md shadow-indigo-500/20 ring-1 ring-indigo-500/40'
                      : !isOnline
                        ? 'opacity-65 hover:opacity-100 hover:bg-slate-900/50 text-slate-400'
                        : 'hover:bg-slate-800/40 text-slate-300'
                    }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {/* Avatar with Status & Unread Pulse Dot */}
                    <div className="relative shrink-0">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isSelected
                        ? 'bg-indigo-600 text-white'
                        : unreadCount > 0
                          ? 'bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/40'
                          : !isOnline
                            ? 'bg-slate-800 text-slate-400 border border-slate-700'
                            : 'bg-slate-700 text-slate-200'
                        }`}>
                        {peer.nickname.charAt(0).toUpperCase()}
                      </div>
                      {unreadCount > 0 ? (
                        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-indigo-500 border-2 border-slate-900 animate-pulse" />
                      ) : isOnline ? (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-slate-900" />
                      ) : (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-slate-600 border-2 border-slate-900" />
                      )}
                    </div>

                    {/* Peer Info & Last Message Snippet */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className={`text-xs truncate max-w-[110px] ${unreadCount > 0 ? 'font-bold text-white' : 'font-medium'
                            }`}>
                            {peer.nickname}
                          </span>
                          {peer.isHost && (
                            <span className="text-[9px] px-1 rounded bg-indigo-500/20 text-indigo-300 shrink-0">
                              Host
                            </span>
                          )}
                          {!isOnline && (
                            <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-500 border border-slate-700/60 shrink-0">
                              Offline
                            </span>
                          )}
                        </div>

                        {lastMsg?.timestamp && (
                          <span className={`text-[9px] font-mono shrink-0 ${unreadCount > 0 ? 'text-indigo-300 font-semibold' : 'text-slate-500'
                            }`}>
                            {formatRelativeTime(lastMsg.timestamp)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        {lastMsg ? (
                          <p className={`text-[10px] truncate max-w-[130px] ${unreadCount > 0 ? 'text-indigo-200 font-semibold' : 'text-slate-400'
                            }`}>
                            {lastMsg.content.replace(/\s+/g, ' ')}
                          </p>
                        ) : (
                          <div className="text-[10px] font-mono text-cyan-400/90 flex items-center gap-1">
                            <span>{peer.hostname || peer.ip}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Area: Unread Counter Badge OR Ping Button */}
                  <div className="flex items-center gap-1.5 ml-2 shrink-0">
                    {unreadCount > 0 ? (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md shadow-indigo-500/30 animate-bounce">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    ) : isOnline ? (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onSendPing(peer.id);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 transition-colors opacity-80 group-hover:opacity-100"
                        title={`Ping ${peer.nickname}`}
                      >
                        <Bell className="w-3.5 h-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Global Ping Button Footer */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
        <button
          onClick={() => onSendPing('')}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-all shadow-sm"
        >
          <Bell className="w-4 h-4 text-amber-400 animate-bounce" />
          Broadcast Ping Buzz (Alert LAN)
        </button>
      </div>
    </aside>
  );
};
