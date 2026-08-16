import React, { useState } from 'react';
import { Peer } from '../types';
import { Users, Bell, Edit3, Server, Shield, Search, Hash, Wifi, Radio } from 'lucide-react';

interface SidebarProps {
  myPeer: Peer;
  isHost: boolean;
  serverAddr: string;
  peers: Peer[];
  selectedTargetId: string; // "" for public channel, or peerId for DM
  onSelectTarget: (targetId: string) => void;
  onOpenNicknameModal: () => void;
  onSendPing: (targetId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  myPeer,
  isHost,
  serverAddr,
  peers,
  selectedTargetId,
  onSelectTarget,
  onOpenNicknameModal,
  onSendPing,
}) => {
  const [search, setSearch] = useState('');

  // Filter out self and match search
  const activePeers = peers.filter(p => p.id !== myPeer.id);
  const filteredPeers = activePeers.filter(p =>
    p.nickname.toLowerCase().includes(search.toLowerCase()) ||
    p.ip.includes(search) ||
    p.hostname.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className="w-80 h-full flex flex-col glass-panel border-r border-slate-800 select-none">
      {/* App Branding & Network Node Badge */}
      <div className="p-4 border-b border-slate-800/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl overflow-hidden border border-indigo-500/30 shadow-md shadow-indigo-500/20 shrink-0 bg-slate-900 flex items-center justify-center">
              <img src="/icon.png" alt="LAN Messenger Logo" className="w-full h-full object-cover" />
            </div>
            <div>

              <h1 className="font-bold text-slate-100 text-base tracking-wide flex items-center gap-1.5">
                LAN Messenger
              </h1>
              <span className="text-[10px] font-mono text-cyan-400 flex items-center gap-1">
                <Wifi className="w-3 h-3 text-cyan-400" />
                {serverAddr}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end">
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isHost
                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
            >
              {isHost ? 'Host Server' : 'Peer Client'}
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
                <h3 className="font-semibold text-sm text-slate-100 truncate max-w-[120px]">
                  {myPeer.nickname}
                </h3>
                {isHost && (
                  <span title="Server Host Node">
                    <Server className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  </span>
                )}

              </div>
              <div className="text-xs text-slate-400 font-mono flex items-center gap-1">
                <span className="text-cyan-400">{myPeer.ip}</span>
              </div>
            </div>
          </div>

          <button
            onClick={onOpenNicknameModal}
            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
            title="Edit Network Nickname"
          >
            <Edit3 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Channels Section */}
      <div className="px-3 mb-2">
        <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase px-2 mb-1">
          Channels
        </div>
        <button
          onClick={() => onSelectTarget('')}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${selectedTargetId === ''
              ? 'bg-indigo-600/90 text-white shadow-md shadow-indigo-600/20'
              : 'text-slate-300 hover:bg-slate-800/60'
            }`}
        >
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4 text-indigo-300" />
            <span>General LAN Chat</span>
          </div>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-900/50 text-indigo-200">
            {peers.length} online
          </span>
        </button>
      </div>

      {/* Peer List Header & Search */}
      <div className="px-3 pt-2 pb-1 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-2 mb-2">
          <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-indigo-400" />
            <span>Connected Devices ({activePeers.length})</span>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative mb-2">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search nickname or IP..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg glass-input text-slate-200 placeholder-slate-500 focus:outline-none"
          />
        </div>

        {/* Peer List */}
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {filteredPeers.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 font-medium">
              {search ? 'No clients match search' : 'Waiting for peers to join LAN...'}
            </div>
          ) : (
            filteredPeers.map(peer => {
              const isSelected = selectedTargetId === peer.id;
              return (
                <div
                  key={peer.id}
                  onClick={() => onSelectTarget(peer.id)}
                  className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all ${isSelected
                      ? 'bg-slate-800/90 text-white border border-indigo-500/30'
                      : 'hover:bg-slate-800/40 text-slate-300'
                    }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-200">
                        {peer.nickname.charAt(0).toUpperCase()}
                      </div>
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-slate-900" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-xs truncate max-w-[110px]">
                          {peer.nickname}
                        </span>
                        {peer.isHost && (
                          <span className="text-[9px] px-1 rounded bg-indigo-500/20 text-indigo-300">
                            Host
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-cyan-400/90 flex items-center gap-1">
                        <span>{peer.ip}</span>
                      </div>
                    </div>
                  </div>

                  {/* Ping User Button */}
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
