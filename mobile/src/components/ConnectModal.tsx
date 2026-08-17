import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface ConnectModalProps {
  visible: boolean;
  defaultIp?: string;
  onClose: () => void;
  onConnect: (serverIp: string, port: number) => void;
}

export const ConnectModal: React.FC<ConnectModalProps> = ({
  visible,
  defaultIp,
  onClose,
  onConnect,
}) => {
  const [ip, setIp] = useState(defaultIp || '192.168.254.9');
  const [port, setPort] = useState('25252');

  useEffect(() => {
    if (defaultIp) {
      setIp(defaultIp);
    }
  }, [defaultIp]);

  const handleConnect = () => {
    if (ip.trim()) {
      onConnect(ip.trim(), parseInt(port) || 25252);
      onClose();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <SafeAreaView style={styles.overlay}>
        <View style={styles.modalContent}>
          <Text style={styles.title}>Connect to LAN Host</Text>
          <Text style={styles.subtitle}>Enter IPv4 address of Desktop TakLan host</Text>

          <Text style={styles.label}>Host Server IP</Text>
          <TextInput
            style={styles.input}
            value={ip}
            onChangeText={setIp}
            placeholder="192.168.x.x"
            placeholderTextColor="#64748B"
            keyboardType="numeric"
          />

          <Text style={styles.label}>TCP Port</Text>
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={setPort}
            placeholder="25252"
            placeholderTextColor="#64748B"
            keyboardType="numeric"
          />

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.connectBtn} onPress={handleConnect}>
              <Text style={styles.connectBtnText}>Connect LAN</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: '#CBD5E1',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#F8FAFC',
    fontSize: 13,
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  cancelBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  connectBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#6366F1',
  },
  connectBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
