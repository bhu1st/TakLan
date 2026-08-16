import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Peer, LastMessageInfo } from '../types/network';

interface PeerItemProps {
  peer: Peer;
  isSelected: boolean;
  unreadCount: number;
  lastMessage?: LastMessageInfo;
  onSelect: () => void;
  onPing: () => void;
}

export const PeerItem: React.FC<PeerItemProps> = ({
  peer,
  isSelected,
  unreadCount,
  lastMessage,
  onSelect,
  onPing,
}) => {
  const formatTime = (ts?: number) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isSelected && styles.selectedCard,
        unreadCount > 0 && !isSelected && styles.unreadCard,
      ]}
      onPress={onSelect}
    >
      <View style={styles.avatarContainer}>
        <View
          style={[
            styles.avatar,
            isSelected
              ? styles.selectedAvatar
              : unreadCount > 0
              ? styles.unreadAvatar
              : styles.defaultAvatar,
          ]}
        >
          <Text style={styles.avatarText}>{peer.nickname.charAt(0).toUpperCase()}</Text>
        </View>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: unreadCount > 0 ? '#818CF8' : '#10B981' },
          ]}
        />
      </View>

      <View style={styles.infoContainer}>
        <View style={styles.nameRow}>
          <Text style={[styles.nickname, unreadCount > 0 && styles.boldText]}>
            {peer.nickname}
          </Text>
          {peer.isHost && <Text style={styles.hostBadge}>Host</Text>}
          {lastMessage?.timestamp ? (
            <Text style={styles.timeText}>{formatTime(lastMessage.timestamp)}</Text>
          ) : null}
        </View>

        <Text style={styles.previewText} numberOfLines={1}>
          {lastMessage
            ? lastMessage.content.replace(/\s+/g, ' ')
            : peer.ip}
        </Text>
      </View>

      {unreadCount > 0 ? (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.pingBtn} onPress={onPing}>
          <Text style={styles.pingBtnText}>🔔</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.4)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selectedCard: {
    backgroundColor: '#1E293B',
    borderColor: 'rgba(99, 102, 241, 0.4)',
  },
  unreadCard: {
    backgroundColor: 'rgba(49, 46, 129, 0.5)',
    borderColor: 'rgba(99, 102, 241, 0.6)',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultAvatar: {
    backgroundColor: '#334155',
  },
  selectedAvatar: {
    backgroundColor: '#4F46E5',
  },
  unreadAvatar: {
    backgroundColor: '#6366F1',
  },
  avatarText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
    fontSize: 15,
  },
  statusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#0F172A',
  },
  infoContainer: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nickname: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '500',
  },
  boldText: {
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  hostBadge: {
    fontSize: 9,
    color: '#A5B4FC',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 6,
  },
  timeText: {
    fontSize: 10,
    color: '#64748B',
    fontFamily: 'monospace',
  },
  previewText: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  unreadBadge: {
    backgroundColor: '#6366F1',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  pingBtn: {
    padding: 6,
    marginLeft: 4,
  },
  pingBtnText: {
    fontSize: 14,
  },
});
