import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { ChatMessage } from '@/types/network';

interface MessageBubbleProps {
  chat: ChatMessage;
  isMe: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ chat, isMe }) => {
  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Only classify as ASCII art if it contains dense symbol patterns
  const isAsciiArt = /[\/\\|_\-+=#@*~^`]{5,}/.test(chat.content);

  return (
    <View style={[styles.wrapper, isMe ? styles.alignRight : styles.alignLeft]}>
      <View style={styles.headerRow}>
        <Text style={styles.senderNick}>{chat.senderNick}</Text>
        <Text style={styles.senderIp}>({chat.senderIp})</Text>
        <Text style={styles.dot}>•</Text>
        <Text style={styles.timeText}>{formatTime(chat.timestamp)}</Text>
      </View>

      <View
        style={[
          styles.bubble,
          isMe ? styles.myBubble : styles.peerBubble,
        ]}
      >
        {isAsciiArt ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.asciiScroll}>
            <Text style={styles.asciiContent}>{chat.content}</Text>
          </ScrollView>
        ) : (
          <Text style={[styles.textContent, isMe ? styles.myText : styles.peerText]}>
            {chat.content}
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginVertical: 4,
    marginHorizontal: 12,
    maxWidth: '82%',
  },
  alignLeft: {
    alignSelf: 'flex-start',
  },
  alignRight: {
    alignSelf: 'flex-end',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  senderNick: {
    fontSize: 11,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  senderIp: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#38BDF8',
  },
  dot: {
    fontSize: 10,
    color: '#64748B',
  },
  timeText: {
    fontSize: 10,
    color: '#64748B',
  },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    alignSelf: 'flex-start',
  },
  myBubble: {
    backgroundColor: '#4F46E5',
    borderBottomRightRadius: 2,
    alignSelf: 'flex-end',
  },
  peerBubble: {
    backgroundColor: '#1E293B',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: '#334155',
    alignSelf: 'flex-start',
  },
  textContent: {
    fontSize: 14,
    lineHeight: 20,
  },
  asciiScroll: {
    flexGrow: 0,
  },
  asciiContent: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#F8FAFC',
    lineHeight: 15,
  },
  myText: {
    color: '#FFFFFF',
  },
  peerText: {
    color: '#F1F5F9',
  },
});
