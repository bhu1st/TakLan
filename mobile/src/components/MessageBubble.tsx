import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  PanResponder,
  Linking,
} from 'react-native';
import { ChatMessage } from '@/types/network';

interface MessageBubbleProps {
  chat: ChatMessage;
  isMe: boolean;
  onReply?: (chat: ChatMessage) => void;
}

const URL_REGEX = /(https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+)/gi;

export const MessageBubble: React.FC<MessageBubbleProps> = ({ chat, isMe, onReply }) => {
  const panX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return (
          gestureState.dx > 12 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.3
        );
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx > 0) {
          const clampedX = Math.min(gestureState.dx * 0.75, 65);
          panX.setValue(clampedX);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx >= 40 && onReply) {
          onReply(chat);
        }
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 6,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleOpenLink = (rawUrl: string) => {
    let fullUrl = rawUrl;
    if (!/^https?:\/\//i.test(fullUrl)) {
      fullUrl = 'https://' + fullUrl;
    }
    Linking.openURL(fullUrl).catch((err) => {
      console.warn('Failed to open link:', err);
    });
  };

  const renderLinkifiedText = (text: string, baseStyle: any) => {
    const parts = text.split(URL_REGEX);
    return parts.map((part, index) => {
      if (part.match(URL_REGEX)) {
        return (
          <Text
            key={index}
            selectable={true}
            style={[baseStyle, styles.linkText]}
            onPress={() => handleOpenLink(part)}
          >
            {part}
          </Text>
        );
      }
      return (
        <Text key={index} selectable={true} style={baseStyle}>
          {part}
        </Text>
      );
    });
  };

  // Only classify as ASCII art if it contains dense symbol patterns
  const isAsciiArt = /[\/\\|_\-+=#@*~^`]{5,}/.test(chat.content);

  const replyOpacity = panX.interpolate({
    inputRange: [0, 20, 45],
    outputRange: [0, 0.5, 1],
    extrapolate: 'clamp',
  });

  const replyScale = panX.interpolate({
    inputRange: [0, 25, 45],
    outputRange: [0.6, 0.8, 1.1],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.outerContainer}>
      {/* Swipe Reply Icon Indicator revealed on swipe right */}
      <Animated.View
        style={[
          styles.swipeReplyIconContainer,
          {
            opacity: replyOpacity,
            transform: [{ scale: replyScale }],
          },
        ]}
      >
        <View style={styles.replyIconBadge}>
          <Text style={styles.replyIconSymbol}>↩</Text>
        </View>
      </Animated.View>

      <Animated.View
        style={[
          styles.wrapper,
          isMe ? styles.alignRight : styles.alignLeft,
          { transform: [{ translateX: panX }] },
        ]}
        {...panResponder.panHandlers}
      >
        <View style={styles.headerRow}>
          <Text selectable={false} style={styles.senderNick}>
            {chat.senderNick}
          </Text>
          <Text selectable={false} style={styles.senderIp}>
            ({chat.senderHostname || chat.senderIp})
          </Text>
          <Text selectable={false} style={styles.dot}>
            •
          </Text>
          <Text selectable={false} style={styles.timeText}>
            {formatTime(chat.timestamp)}
          </Text>
        </View>

        <View
          style={[
            styles.bubble,
            isMe ? styles.myBubble : styles.peerBubble,
          ]}
        >
          {/* Quoted Replied Message Header */}
          {chat.replyTo && (
            <View
              style={[
                styles.replyQuoteBox,
                isMe ? styles.myReplyQuoteBox : styles.peerReplyQuoteBox,
              ]}
            >
              <View style={styles.replyQuoteHeader}>
                <Text style={styles.replyQuoteArrow}>↩</Text>
                <Text style={styles.replyQuoteSender} numberOfLines={1}>
                  {chat.replyTo.senderNick}
                </Text>
              </View>
              <Text
                style={styles.replyQuoteText}
                numberOfLines={2}
                ellipsizeMode="tail"
                selectable={true}
              >
                {chat.replyTo.content}
              </Text>
            </View>
          )}

          {isAsciiArt ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.asciiScroll}
            >
              <Text selectable={true} style={styles.asciiContent}>
                {chat.content}
              </Text>
            </ScrollView>
          ) : (
            <Text selectable={true} style={[styles.textContent, isMe ? styles.myText : styles.peerText]}>
              {renderLinkifiedText(chat.content, isMe ? styles.myText : styles.peerText)}
            </Text>
          )}
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    position: 'relative',
    justifyContent: 'center',
    marginVertical: 4,
  },
  swipeReplyIconContainer: {
    position: 'absolute',
    left: 14,
    zIndex: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#818CF8',
    elevation: 3,
  },
  replyIconSymbol: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  wrapper: {
    marginHorizontal: 12,
    maxWidth: '84%',
    zIndex: 1,
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
    marginBottom: 3,
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
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 16,
    alignSelf: 'flex-start',
  },
  myBubble: {
    backgroundColor: '#4F46E5',
    borderBottomRightRadius: 2,
    alignSelf: 'flex-end',
    elevation: 2,
  },
  peerBubble: {
    backgroundColor: '#1E293B',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: '#334155',
    alignSelf: 'flex-start',
    elevation: 2,
  },
  replyQuoteBox: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    marginBottom: 7,
    borderLeftWidth: 3,
  },
  myReplyQuoteBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    borderLeftColor: '#A5B4FC',
  },
  peerReplyQuoteBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderLeftColor: '#38BDF8',
  },
  replyQuoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 1,
  },
  replyQuoteArrow: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: 'bold',
  },
  replyQuoteSender: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#E0E7FF',
  },
  replyQuoteText: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#CBD5E1',
    opacity: 0.9,
    lineHeight: 15,
  },
  textContent: {
    fontSize: 14,
    lineHeight: 20,
  },
  linkText: {
    color: '#38BDF8',
    textDecorationLine: 'underline',
    fontWeight: '600',
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
