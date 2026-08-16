import React, { useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { playPingSound } from '../utils/audio';

interface PingToastProps {
  senderNick: string;
  senderIp: string;
  onDismiss: () => void;
}

export const PingToast: React.FC<PingToastProps> = ({ senderNick, senderIp, onDismiss }) => {
  useEffect(() => {
    // Trigger sound alert synth
    playPingSound();

    // Auto-dismiss after 6 seconds
    const timer = setTimeout(() => {
      onDismiss();
    }, 6000);

    return () => clearTimeout(timer);
  }, [senderNick, senderIp]);

  return (
    <div className="fixed top-6 right-6 z-50 flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-2xl shadow-amber-500/40 border border-amber-300/30 animate-shake">
      <div className="p-2 rounded-xl bg-white/20 backdrop-blur-md">
        <Bell className="w-6 h-6 animate-bounce" />
      </div>

      <div>
        <h4 className="font-bold text-sm">LAN Ping Alert!</h4>
        <p className="text-xs text-amber-100 font-medium">
          <strong>{senderNick}</strong> ({senderIp}) pinged you!
        </p>
      </div>

      <button
        onClick={onDismiss}
        className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors ml-2"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
