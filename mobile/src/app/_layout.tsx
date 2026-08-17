import React, { useEffect, useState, useRef } from 'react';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar, View, Text, StyleSheet, Image, ActivityIndicator, Animated } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import packageJson from '../../package.json';

export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppIsReady(true);
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start(() => {
        setIsOverlayVisible(false);
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={DarkTheme}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <Stack screenOptions={{ headerShown: false }} />

        {/* Custom Redesigned Splash Screen Overlay */}
        {isOverlayVisible && (
          <Animated.View
            style={[styles.splashContainer, { opacity: fadeAnim }]}
            pointerEvents={appIsReady ? 'none' : 'auto'}
          >
            <View style={styles.splashContent}>
              <View style={styles.iconWrapper}>
                <Image
                  source={require('../../assets/images/icon.png')}
                  style={styles.logoImage}
                />
              </View>
              <Text style={styles.appTitle}>TakLan</Text>
              <View style={styles.versionBadge}>
                <Text style={styles.versionText}>v{packageJson.version}</Text>
              </View>
              <Text style={styles.subTitle}>Talk on your LAN - offline, fast, secure</Text>

              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#6366F1" />
                <Text style={styles.loadingText}>Initializing LAN Nodes...</Text>
              </View>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Secure • Offline • Fast</Text>
            </View>
          </Animated.View>
        )}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#090D16',
    zIndex: 99999,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 50,
  },
  splashContent: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  iconWrapper: {
    width: 86,
    height: 86,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(99, 102, 241, 0.4)',
    marginBottom: 16,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
    backgroundColor: '#0F172A',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  appTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  versionBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
    marginTop: 6,
    marginBottom: 8,
  },
  versionText: {
    color: '#818CF8',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  subTitle: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 40,
    backgroundColor: 'rgba(30, 41, 59, 0.4)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.6)',
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  footer: {
    alignItems: 'center',
  },
  footerText: {
    color: '#475569',
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
