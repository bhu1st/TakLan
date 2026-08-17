import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Peer } from '@/types/network';
import packageJson from '../../package.json';

interface NetworkHeaderProps {
  myPeer: Peer;
  serverAddr: string;
  isConnected: boolean;
  onOpenConnectModal: () => void;
}

export const NetworkHeader: React.FC<NetworkHeaderProps> = ({
  myPeer,
  serverAddr,
  isConnected,
  onOpenConnectModal,
}) => {
  return (
    <View style={styles.container}>
      {/* Top Branding & Connection Status Row */}
      <View style={styles.topRow}>
        <View style={styles.brandContainer}>
          <Image
            source={require('../../assets/images/icon.png')}
            style={styles.appIcon}
          />
          <Text style={styles.title}>TakLan</Text>
          <View style={styles.versionBadge}>
            <Text style={styles.versionText}>v{packageJson.version}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.statusBadge} onPress={onOpenConnectModal}>
          <View style={[styles.statusDot, { backgroundColor: isConnected ? '#10B981' : '#EF4444' }]} />
          <Text style={styles.statusText}>
            {isConnected ? serverAddr : 'Disconnected'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Sub Row: Compact User Badge */}
      <View style={styles.userRow}>
        <View style={styles.userPill}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{myPeer.nickname ? myPeer.nickname.charAt(0).toUpperCase() : 'A'}</Text>
          </View>
          <Text style={styles.nickname}>{myPeer.nickname}</Text>
          <Text style={styles.dot}>•</Text>
          <Text style={styles.ipText}>{myPeer.ip}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: '#090D16',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  appIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  versionBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  versionText: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: '#818CF8',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1E293B',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#38BDF8',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 6,
  },
  avatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 10,
  },
  nickname: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '600',
  },
  dot: {
    color: '#64748B',
    fontSize: 10,
  },
  ipText: {
    color: '#38BDF8',
    fontSize: 10,
    fontFamily: 'monospace',
  },
});
