import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Platform,
  ScrollView,
  StatusBar,
  Keyboard,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileCard } from '@/components/FileCard';
import { FileOffer, FileProgress, Peer, ChatMessage, LastMessageInfo, PingAlert } from '@/types/network';
import { networkService } from '@/services/network';
import { NetworkHeader } from '@/components/NetworkHeader';
import { MessageBubble } from '@/components/MessageBubble';
import { ConnectModal } from '@/components/ConnectModal';

export default function AppScreen() {
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  const [myPeer, setMyPeer] = useState<Peer>(networkService.getMyPeer());
  const [peers, setPeers] = useState<Peer[]>(networkService.getPeers());
  const [selectedTargetId, setSelectedTargetId] = useState<string>(''); // "" = General channel
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [fileOffers, setFileOffers] = useState<FileOffer[]>([]);
  const [fileProgresses, setFileProgresses] = useState<Record<string, FileProgress>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [lastMessages, setLastMessages] = useState<Record<string, LastMessageInfo>>({});

  // --- Pagination / History state ---
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [historyOffers, setHistoryOffers] = useState<FileOffer[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const oldestTimestampRef = useRef<number | undefined>(undefined);
  const selectedTargetIdRef = useRef<string>('');
  // ----------------------------------

  const [serverAddr, setServerAddr] = useState<string>(networkService.getServerAddr() || 'Offline');
  const [isConnected, setIsConnected] = useState<boolean>(networkService.getIsConnected());
  const [inputText, setInputText] = useState<string>('');
  const [pingAlert, setPingAlert] = useState<string | null>(null);

  const [isConnectModalVisible, setIsConnectModalVisible] = useState<boolean>(false);

  const flatListRef = useRef<FlatList>(null);


  useEffect(() => {
    selectedTargetIdRef.current = selectedTargetId;
    // Clear unread count for current active conversation
    setUnreadCounts((prev) => {
      if (!prev[selectedTargetId]) return prev;
      const next = { ...prev };
      delete next[selectedTargetId];
      return next;
    });

    // --- Load initial history from SQLite ---
    oldestTimestampRef.current = undefined;
    setHistoryMessages([]);
    setHistoryOffers([]);
    setHasMoreHistory(false);

    const loadInitialHistory = async () => {
      const [msgs, offers] = await Promise.all([
        networkService.getMessageHistory(selectedTargetId),
        networkService.getFileHistory(selectedTargetId),
      ]);
      setHistoryMessages(msgs);
      setHistoryOffers(offers);
      if (msgs.length > 0 || offers.length > 0) {
        const allTs = [
          ...(msgs.length > 0 ? [msgs[0].timestamp] : []),
          ...(offers.length > 0 ? [offers[0].timestamp] : []),
        ];
        oldestTimestampRef.current = Math.min(...allTs);
        setHasMoreHistory(msgs.length >= 100 || offers.length >= 100);
      }
    };
    loadInitialHistory();
  }, [selectedTargetId]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (isLoadingOlder || !hasMoreHistory) return;
    setIsLoadingOlder(true);
    const before = oldestTimestampRef.current;
    const [msgs, offers] = await Promise.all([
      networkService.getMessageHistory(selectedTargetId, before),
      networkService.getFileHistory(selectedTargetId, before),
    ]);
    if (msgs.length > 0 || offers.length > 0) {
      const allTs = [
        ...(msgs.length > 0 ? [msgs[0].timestamp] : []),
        ...(offers.length > 0 ? [offers[0].timestamp] : []),
      ];
      oldestTimestampRef.current = Math.min(...allTs);
      setHistoryMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        return [...msgs.filter((m) => !existingIds.has(m.id)), ...prev];
      });
      setHistoryOffers((prev) => {
        const existingIds = new Set(prev.map((o) => o.transferId));
        return [...offers.filter((o) => !existingIds.has(o.transferId)), ...prev];
      });
      setHasMoreHistory(msgs.length >= 100 || offers.length >= 100);
    } else {
      setHasMoreHistory(false);
    }
    setIsLoadingOlder(false);
  }, [isLoadingOlder, hasMoreHistory, selectedTargetId]);


  useEffect(() => {
    const handleConnectionStatus = (data: { connected: boolean; serverAddr?: string }) => {
      setIsConnected(data.connected);
      if (data.serverAddr) setServerAddr(data.serverAddr);
    };

    const handlePeersUpdated = (updatedPeers: Peer[]) => {
      setPeers(updatedPeers || []);
    };

    const handleNewMessage = (chatMsg: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === chatMsg.id)) {
          return prev;
        }
        return [...prev, chatMsg];
      });
      const currentPeer = networkService.getMyPeer();
      const isFromOtherUser = Boolean(chatMsg.senderId && chatMsg.senderId !== currentPeer.id);
      const chatKey = chatMsg.targetId === '' ? '' : chatMsg.senderId;

      setLastMessages((prev) => ({
        ...prev,
        [chatKey]: {
          content: chatMsg.content,
          timestamp: chatMsg.timestamp,
          senderNick: chatMsg.senderNick,
        },
      }));

      if (isFromOtherUser && selectedTargetIdRef.current !== chatKey) {
        setUnreadCounts((prev) => ({
          ...prev,
          [chatKey]: (prev[chatKey] || 0) + 1,
        }));
      }
    };

    const handleFileOffer = (offer: FileOffer) => {
      setFileOffers((prev) => [...prev, offer]);
    };

    const handleFileProgress = (prog: FileProgress) => {
      setFileProgresses((prev) => ({ ...prev, [prog.transferId]: prog }));
    };

    const handlePingReceived = (ping: PingAlert) => {
      setPingAlert(`🔔 ${ping.senderNick} (${ping.senderIp}) sent a LAN Ping Alert!`);
      setTimeout(() => setPingAlert(null), 4000);
    };

    const handlePeerInfoUpdated = (updatedPeer: Peer) => {
      setMyPeer({ ...updatedPeer });
    };

    networkService.on('connection-status', handleConnectionStatus);
    networkService.on('peer-info-updated', handlePeerInfoUpdated);
    networkService.on('peers-updated', handlePeersUpdated);
    networkService.on('new-message', handleNewMessage);
    networkService.on('file-offer', handleFileOffer);
    networkService.on('file-progress', handleFileProgress);
    networkService.on('ping-received', handlePingReceived);

    return () => {
      networkService.off('connection-status', handleConnectionStatus);
      networkService.off('peer-info-updated', handlePeerInfoUpdated);
      networkService.off('peers-updated', handlePeersUpdated);
      networkService.off('new-message', handleNewMessage);
      networkService.off('file-offer', handleFileOffer);
      networkService.off('file-progress', handleFileProgress);
      networkService.off('ping-received', handlePingReceived);
    };
  }, []);

  const activePeers = peers.filter((p) => p.id !== myPeer.id);

  // Filter messages for active channel/DM
  const isPublic = selectedTargetId === '';
  const filteredMessages = messages.filter((msg) => {
    if (isPublic && msg.targetId === '') return true;
    if (
      !isPublic &&
      ((msg.senderId === myPeer.id && msg.targetId === selectedTargetId) ||
        (msg.senderId === selectedTargetId && msg.targetId === myPeer.id))
    ) {
      return true;
    }
    return false;
  });

  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    networkService.sendChatMessage(selectedTargetId, inputText.trim());
    setInputText('');
  };

  const handleSendPing = (targetId: string = selectedTargetId) => {
    networkService.sendPing(targetId);
  };

  const handleSendFile = () => {
    networkService.pickAndSendFile(selectedTargetId);
  };

  const handleConnectServer = (serverIp: string, port: number) => {
    networkService.connect(serverIp, port);
  };

  interface TimelineItem {
    id: string;
    type: 'chat' | 'file';
    timestamp: number;
    chat?: ChatMessage;
    fileOffer?: FileOffer;
  }

  // Merge history + live items (deduped by id/transferId)
  const seenMsgIds = new Set<string>();
  const seenOfferIds = new Set<string>();
  const timelineItems: TimelineItem[] = [];

  // 1. History messages (older, from DB)
  historyMessages.forEach((msg) => {
    if (!seenMsgIds.has(msg.id)) {
      seenMsgIds.add(msg.id);
      timelineItems.push({ id: msg.id, type: 'chat', timestamp: msg.timestamp, chat: msg });
    }
  });

  // 2. History file offers (older, from DB)
  historyOffers.forEach((offer) => {
    if (!seenOfferIds.has(offer.transferId)) {
      seenOfferIds.add(offer.transferId);
      timelineItems.push({ id: offer.transferId, type: 'file', timestamp: offer.timestamp, fileOffer: offer });
    }
  });

  // 3. Live messages (in-memory, may overlap with history)
  filteredMessages.forEach((msg) => {
    if (!seenMsgIds.has(msg.id)) {
      seenMsgIds.add(msg.id);
      timelineItems.push({ id: msg.id, type: 'chat', timestamp: msg.timestamp, chat: msg });
    }
  });

  // 4. Live file offers
  fileOffers.forEach((offer) => {
    const includePublic = isPublic && offer.targetId === '';
    const includeDM = !isPublic &&
      ((offer.senderId === myPeer.id && offer.targetId === selectedTargetId) ||
       (offer.senderId === selectedTargetId && offer.targetId === myPeer.id));
    if ((includePublic || includeDM) && !seenOfferIds.has(offer.transferId)) {
      seenOfferIds.add(offer.transferId);
      timelineItems.push({ id: offer.transferId, type: 'file', timestamp: offer.timestamp, fileOffer: offer });
    }
  });

  timelineItems.sort((a, b) => a.timestamp - b.timestamp);

  const targetPeer = peers.find((p) => p.id === selectedTargetId);
  const generalUnread = unreadCounts[''] || 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* App Header */}
      <NetworkHeader
        myPeer={myPeer}
        serverAddr={serverAddr}
        isConnected={isConnected}
        onOpenConnectModal={() => setIsConnectModalVisible(true)}
      />

      {/* Ping Buzz Alert Toast */}
      {pingAlert && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>{pingAlert}</Text>
        </View>
      )}

      {/* Streamlined Channel Selector & Ping Bar */}
      <View style={styles.channelBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollBarContent}>
          <TouchableOpacity
            style={[
              styles.channelChip,
              isPublic && styles.activeChannelChip,
              generalUnread > 0 && !isPublic && styles.unreadChannelChip,
            ]}
            onPress={() => setSelectedTargetId('')}
          >
            <Text style={[
              styles.channelChipText,
              isPublic && styles.activeChannelText,
              generalUnread > 0 && !isPublic && styles.unreadChannelText
            ]}>
              # General Channel
            </Text>
            {generalUnread > 0 && !isPublic && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{generalUnread}</Text>
              </View>
            )}
          </TouchableOpacity>

          {activePeers.map((peer) => {
            const isSel = selectedTargetId === peer.id;
            const unread = unreadCounts[peer.id] || 0;
            return (
              <TouchableOpacity
                key={peer.id}
                style={[
                  styles.channelChip,
                  isSel && styles.activeChannelChip,
                  unread > 0 && !isSel && styles.unreadChannelChip,
                ]}
                onPress={() => setSelectedTargetId(peer.id)}
              >
                <Text style={[
                  styles.channelChipText,
                  isSel && styles.activeChannelText,
                  unread > 0 && !isSel && styles.unreadChannelText
                ]}>
                  @{peer.nickname}
                </Text>
                {unread > 0 && !isSel && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{unread}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity style={styles.pingAlertBtn} onPress={() => handleSendPing(selectedTargetId)}>
          <Text style={styles.pingAlertBtnText}>🔔 Ping</Text>
        </TouchableOpacity>
      </View>

      {/* Main Timeline & Input */}
      <View style={[styles.keyboardView, keyboardHeight > 0 && { marginBottom: keyboardHeight }]}>
        <View style={styles.chatContainer}>
          <FlatList
            ref={flatListRef}
            data={timelineItems}
            keyExtractor={(item, index) => item.id ? `${item.id}-${index}` : `item-${index}`}
            renderItem={({ item }) => {
              if (item.type === 'chat' && item.chat) {
                return <MessageBubble chat={item.chat} isMe={item.chat.senderId === myPeer.id} />;
              }
              if (item.type === 'file' && item.fileOffer) {
                return (
                  <FileCard
                    offer={item.fileOffer}
                    progress={fileProgresses[item.fileOffer.transferId]}
                    isMe={item.fileOffer.senderId === myPeer.id}
                    onAccept={(id) => networkService.acceptFileTransfer(id)}
                    onReject={(id) => networkService.rejectFileTransfer(id)}
                    onOpenFile={(savePath) => networkService.openFile(savePath)}
                  />
                );
              }
              return null;
            }}
            contentContainerStyle={styles.timelineList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
              if (e.nativeEvent.contentOffset.y < 80 && hasMoreHistory && !isLoadingOlder) {
                handleLoadOlderMessages();
              }
            }}
            scrollEventThrottle={200}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            ListHeaderComponent={
              hasMoreHistory ? (
                <TouchableOpacity
                  style={styles.loadOlderBtn}
                  onPress={handleLoadOlderMessages}
                  disabled={isLoadingOlder}
                >
                  {isLoadingOlder
                    ? <ActivityIndicator size="small" color="#6366f1" />
                    : <Text style={styles.loadOlderText}>⬆ Load older messages</Text>}
                </TouchableOpacity>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptySub}>
                  {isConnected
                    ? 'Type a message or ping a LAN device to get started!'
                    : 'Tap Disconnected at the top to enter Host Server IP!'}
                </Text>
              </View>
            }
          />
        </View>

        {/* Input Bar */}
        <View style={styles.inputBar}>
          <TouchableOpacity style={styles.attachBtn} onPress={handleSendFile}>
            <Text style={styles.attachBtnText}>📎</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder={
              isPublic
                ? 'Broadcast message to LAN...'
                : `Direct message to ${targetPeer?.nickname || 'Peer'}...`
            }
            placeholderTextColor="#64748B"
            multiline
          />

          <TouchableOpacity
            style={[styles.sendBtn, !inputText.trim() && styles.disabledSendBtn]}
            onPress={handleSendMessage}
            disabled={!inputText.trim()}
          >
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Modals */}
      <ConnectModal
        visible={isConnectModalVisible}
        defaultIp={myPeer.ip && myPeer.ip.includes('.') ? myPeer.ip.replace(/\.\d+$/, '.9') : undefined}
        onClose={() => setIsConnectModalVisible(false)}
        onConnect={handleConnectServer}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  loadOlderBtn: {
    alignSelf: 'center',
    marginVertical: 8,
    paddingVertical: 7,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.35)',
  },
  loadOlderText: {
    color: '#818cf8',
    fontSize: 12,
    fontWeight: '600',
  },
  toastContainer: {
    backgroundColor: 'rgba(217, 119, 6, 0.9)',
    padding: 10,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  channelBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0D1424',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  scrollBarContent: {
    paddingHorizontal: 4,
    gap: 6,
  },
  channelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
  },
  activeChannelChip: {
    backgroundColor: '#6366F1',
    borderColor: '#818CF8',
    elevation: 3,
  },
  unreadChannelChip: {
    backgroundColor: 'rgba(239, 68, 68, 0.22)',
    borderColor: '#F87171',
    borderWidth: 1.5,
  },
  channelChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  activeChannelText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  unreadChannelText: {
    color: '#FCA5A5',
    fontWeight: 'bold',
  },
  unreadBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  keyboardView: {
    flex: 1,
  },
  chatContainer: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  chatHeaderTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: 'bold',
  },
  pingAlertBtn: {
    backgroundColor: 'rgba(217, 119, 6, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.4)',
  },
  pingAlertBtnText: {
    color: '#FBBF24',
    fontSize: 11,
    fontWeight: 'bold',
  },
  timelineList: {
    paddingVertical: 12,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  emptySub: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    gap: 8,
  },
  attachBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachBtnText: {
    fontSize: 16,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 13,
    maxHeight: 100,
    fontFamily: 'monospace',
  },
  sendBtn: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledSendBtn: {
    opacity: 0.5,
  },
  sendBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
