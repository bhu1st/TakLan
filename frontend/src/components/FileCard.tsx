import React from 'react';
import { FileText, Download, XCircle, CheckCircle, HardDrive, AlertCircle, RefreshCw } from 'lucide-react';
import { FileOffer, FileProgress, Peer } from '../types';

interface FileCardProps {
  offer: FileOffer;
  progress?: FileProgress;
  myPeer: Peer;
  onAccept: (transferId: string) => void;
  onReject: (transferId: string) => void;
}

export const FileCard: React.FC<FileCardProps> = ({
  offer,
  progress,
  myPeer,
  onAccept,
  onReject,
}) => {
  const isSender = offer.senderId === myPeer.id;
  const status = progress?.status || 'offered';
  const percentage = Math.round(progress?.progress || 0);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="my-2 p-3.5 rounded-xl glass-card border border-indigo-500/20 max-w-md shadow-lg transition-all duration-200 hover:border-indigo-500/40">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
          <FileText className="w-6 h-6" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-100 truncate" title={offer.fileName}>
              {offer.fileName}
            </h4>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              {formatSize(offer.fileSize)}
            </span>
          </div>

          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
            {isSender ? (
              <span>Sending file to channel/peer</span>
            ) : (
              <span>From <strong className="text-slate-200">{offer.senderNick}</strong> ({offer.senderIp})</span>
            )}
          </p>
        </div>
      </div>

      {/* Progress or Actions */}
      <div className="mt-3 pt-2.5 border-t border-slate-700/50">
        {status === 'offered' && !isSender && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onAccept(offer.transferId)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              Accept & Save...
            </button>
            <button
              onClick={() => onReject(offer.transferId)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 text-xs font-medium transition-colors border border-slate-700"
            >
              Decline
            </button>
          </div>
        )}

        {status === 'offered' && isSender && (
          <div className="flex items-center gap-2 text-xs text-amber-400/90 font-medium">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Waiting for recipient to accept...
          </div>
        )}

        {status === 'transferring' && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-medium text-slate-300">
              <span className="flex items-center gap-1">
                <HardDrive className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                {isSender ? 'Uploading...' : 'Downloading...'}
              </span>
              <span className="font-mono text-indigo-400">{percentage}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
              <div
                className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-2 rounded-full transition-all duration-150"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        )}

        {status === 'completed' && (
          <div className="flex items-center justify-between text-xs text-emerald-400 font-medium">
            <span className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              Transfer Complete
            </span>
            {progress?.savePath && (
              <span className="text-[11px] font-mono text-slate-400 truncate max-w-[200px]" title={progress.savePath}>
                {progress.savePath}
              </span>
            )}
          </div>
        )}

        {(status === 'rejected' || status === 'failed') && (
          <div className="flex items-center gap-1.5 text-xs text-red-400 font-medium">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            {status === 'rejected' ? 'Transfer declined by recipient' : (progress?.error || 'Transfer failed')}
          </div>
        )}
      </div>
    </div>
  );
};
