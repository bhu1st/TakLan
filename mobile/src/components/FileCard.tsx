import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { FileOffer, FileProgress } from '@/types/network';

interface FileCardProps {
  offer: FileOffer;
  progress?: FileProgress;
  isMe: boolean;
  onAccept?: (transferId: string) => void;
  onReject?: (transferId: string) => void;
  onOpenFile?: (savePath: string) => void;
}

export const FileCard: React.FC<FileCardProps> = ({
  offer,
  progress,
  isMe,
  onAccept,
  onReject,
  onOpenFile,
}) => {
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const status = progress?.status || (offer as any).status || 'pending';
  const pct = Math.round(progress?.progress || 0);
  const targetSavePath = progress?.savePath || offer.savePath || offer.fileName;

  return (
    <View style={[styles.card, isMe ? styles.myCard : styles.peerCard]}>
      <View style={styles.headerRow}>
        <Text style={styles.iconText}>📁</Text>
        <View style={styles.headerInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {offer.fileName}
          </Text>
          <Text style={styles.fileSize}>{formatSize(offer.fileSize)}</Text>
        </View>
      </View>

      <Text style={styles.senderInfo}>
        {isMe ? 'Offered by You' : `Offered by ${offer.senderNick} (${offer.senderIp})`}
      </Text>

      {status === 'pending' && !isMe && (
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={styles.rejectBtn}
            onPress={() => onReject?.(offer.transferId)}
          >
            <Text style={styles.rejectBtnText}>Decline</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.acceptBtn}
            onPress={() => onAccept?.(offer.transferId)}
          >
            <Text style={styles.acceptBtnText}>Accept File</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'transferring' && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.progressText}>Transferring... {pct}%</Text>
        </View>
      )}

      {status === 'completed' && (
        <View style={styles.completedRow}>
          <View style={styles.statusBadgeCompleted}>
            <Text style={styles.statusCompletedText}>✓ Transfer Completed</Text>
          </View>
          {onOpenFile && targetSavePath ? (
            <TouchableOpacity
              style={styles.openBtn}
              onPress={() => onOpenFile(targetSavePath)}
            >
              <Text style={styles.openBtnText}>Open File</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {status === 'rejected' && (
        <View style={styles.statusBadgeRejected}>
          <Text style={styles.statusRejectedText}>✕ Transfer Declined</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginVertical: 6,
    marginHorizontal: 12,
    padding: 12,
    borderRadius: 14,
    maxWidth: '85%',
  },
  myCard: {
    alignSelf: 'flex-end',
    backgroundColor: '#3730A3',
    borderWidth: 1,
    borderColor: '#4F46E5',
  },
  peerCard: {
    alignSelf: 'flex-start',
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  iconText: {
    fontSize: 22,
    marginRight: 10,
  },
  headerInfo: {
    flex: 1,
  },
  fileName: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: 'bold',
  },
  fileSize: {
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 1,
  },
  senderInfo: {
    color: '#CBD5E1',
    fontSize: 10,
    marginBottom: 8,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  rejectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  rejectBtnText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '600',
  },
  acceptBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#10B981',
  },
  acceptBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  progressContainer: {
    marginTop: 6,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10B981',
  },
  progressText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    gap: 8,
  },
  statusBadgeCompleted: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 6,
  },
  statusCompletedText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: 'bold',
  },
  openBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#10B981',
    borderRadius: 6,
  },
  openBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  statusBadgeRejected: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  statusRejectedText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: 'bold',
  },
});
