import React, { useState, useEffect } from 'react';
import { User, X, Check, Wifi, Laptop } from 'lucide-react';
import { Peer } from '../types';

interface NicknameModalProps {
  myPeer: Peer;
  isOpen: boolean;
  onClose: () => void;
  onSaveNickname: (newNick: string) => void;
}

export const NicknameModal: React.FC<NicknameModalProps> = ({
  myPeer,
  isOpen,
  onClose,
  onSaveNickname,
}) => {
  const [nickname, setNickname] = useState(myPeer.nickname);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setNickname(myPeer.nickname);
      setError('');
    }
  }, [isOpen, myPeer.nickname]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError('Nickname cannot be empty');
      return;
    }
    onSaveNickname(trimmed);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md p-6 rounded-2xl glass-panel border border-slate-700/80 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-base">Network Identity</h3>
              <p className="text-xs text-slate-400">Set nickname visible to all LAN peers</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Box */}
        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1.5 font-mono text-slate-300">
          <div className="flex justify-between">
            <span className="text-slate-500 flex items-center gap-1">
              <Wifi className="w-3.5 h-3.5 text-cyan-400" /> LAN IPv4:
            </span>
            <span className="text-cyan-400 font-semibold">{myPeer.ip}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 flex items-center gap-1">
              <Laptop className="w-3.5 h-3.5 text-indigo-400" /> Hostname:
            </span>
            <span className="text-slate-200">{myPeer.hostname}</span>
          </div>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Display Nickname
            </label>
            <input
              type="text"
              value={nickname}
              onChange={e => {
                setNickname(e.target.value);
                setError('');
              }}
              placeholder="Enter nickname..."
              className="w-full px-4 py-2.5 text-sm rounded-xl glass-input text-slate-100 focus:outline-none"
              autoFocus
            />
            {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors border border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-md shadow-indigo-600/20"
            >
              <Check className="w-4 h-4" />
              Save & Broadcast
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
