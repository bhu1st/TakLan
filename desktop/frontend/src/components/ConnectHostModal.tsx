import React, { useState, useEffect } from 'react';
import { X, Server, RefreshCw, AlertCircle } from 'lucide-react';

interface ConnectHostModalProps {
  visible: boolean;
  defaultHost?: string;
  onClose: () => void;
  onConnect: (hostAddr: string) => Promise<void>;
  onRescan: () => Promise<void>;
}

export const ConnectHostModal: React.FC<ConnectHostModalProps> = ({
  visible,
  defaultHost,
  onClose,
  onConnect,
  onRescan,
}) => {
  const [hostInput, setHostInput] = useState(defaultHost || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (visible) {
      setErrorMsg('');
      if (defaultHost && !hostInput) {
        setHostInput(defaultHost);
      }
    }
  }, [visible, defaultHost]);

  if (!visible) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = hostInput.trim();
    if (!trimmed) {
      setErrorMsg('Please enter the host IP address (e.g. 192.168.1.10)');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');
    try {
      await onConnect(trimmed);
      onClose();
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'Failed to connect to host server');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRescan = async () => {
    setIsSubmitting(true);
    setErrorMsg('');
    try {
      await onRescan();
      onClose();
    } catch (err: any) {
      setErrorMsg(typeof err === 'string' ? err : err?.message || 'LAN scan failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl glass-panel border border-slate-700/80 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <Server className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">Connect to LAN Host</h2>
              <p className="text-[11px] text-slate-400">Join another TakLan host by IP address</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Host IPv4 Address (optional :Port)
            </label>
            <input
              type="text"
              value={hostInput}
              onChange={e => setHostInput(e.target.value)}
              placeholder="e.g. 192.168.1.10 or 192.168.1.10:25252"
              autoFocus
              disabled={isSubmitting}
              className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm font-mono text-slate-100 placeholder-slate-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              Default TCP port is <span className="font-mono text-cyan-400">25252</span>. Check the host PC's sidebar for its IP.
            </p>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleRescan}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
              <span>Rescan LAN</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-3.5 py-2 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

