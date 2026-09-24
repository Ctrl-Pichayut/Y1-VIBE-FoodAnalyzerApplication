/**
 * ScanScreen — Camera capture + image picker for food analysis.
 * Phase 1 MVP: Camera → detect → navigate to ResultScreen.
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image, LayoutChangeEvent,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { colors, spacing, radii } from '../theme/tokens';
import { analyzeImage } from '../services/api';
import AppModal, { ModalState } from '../components/AppModal';

export default function ScanScreen({ navigation }: any) {
  const [permission, requestPermission] = useCameraPermissions();
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [cameraLayout, setCameraLayout] = useState({ width: 0, height: 0 });
  const [modal, setModal] = useState<ModalState | null>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const cameraRef = useRef<CameraView>(null);

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const handleCameraLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCameraLayout({ width, height });
  };

  const scanFrameStyle = cameraLayout.width > 0 && cameraLayout.height > 0
    ? {
        left: (cameraLayout.width - SCAN_FRAME_SIZE) / 2,
        top: (cameraLayout.height - SCAN_FRAME_SIZE) / 2,
      }
    : null;

  const handleCapture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (photo) {
        setPreview(photo.uri);
        await processImage(photo.uri);
      }
    } catch (e: any) {
      setModal({ title: 'Error', message: e.message || 'Failed to capture photo' });
    }
  };

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setPreview(uri);
      await processImage(uri);
    }
  };

  const processImage = async (uri: string) => {
    setAnalyzing(true);
    try {
      const data = await analyzeImage(uri);
      setAnalyzing(false);
      setPreview(null);
      navigation.navigate('Result', { result: data, imageUri: uri });
    } catch (e: any) {
      setAnalyzing(false);
      setPreview(null);
      setModal({ title: 'Analysis failed', message: e.message || 'Could not analyze image' });
    }
  };

  // --- Conditional content ---------------------------------------------------
  let content: React.ReactNode;
  if (!permission) {
    content = <View style={styles.center}><ActivityIndicator /></View>;
  } else if (!permission.granted) {
    content = (
      <View style={styles.center}>
        <Text style={styles.permTitle}>Camera Access</Text>
        <Text style={styles.permBody}>
          Grant camera permission to scan food items for nutritional analysis.
        </Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={requestPermission}>
          <Text style={styles.btnPrimaryText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (analyzing && preview) {
    content = (
      <View style={styles.center}>
        <Image source={{ uri: preview }} style={styles.previewImage} />
        <ActivityIndicator size="large" color={colors.textPrimary} style={{ marginTop: 24 }} />
        <Text style={styles.analyzingText}>Analyzing food...</Text>
        <Text style={styles.analyzingSub}>This may take up to 30 seconds{'\n'}while our AI identifies your dish</Text>
      </View>
    );
  } else {
    content = (
      <View style={styles.container}>
        <View style={styles.cameraArea} onLayout={handleCameraLayout}>
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />

          {scanFrameStyle && (
            <View
              style={[styles.scanFrame, scanFrameStyle]}
              pointerEvents="none"
            />
          )}
        </View>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.btnSecondary} onPress={handlePickImage}>
            <Text style={styles.btnSecondaryText}>Gallery</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.captureBtn} onPress={handleCapture}>
            <View style={styles.captureBtnInner} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.btnSecondary} onPress={toggleCameraFacing}>
            <Text style={styles.btnSecondaryText}>Flip</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Always mounted so the themed modal renders over any of the states above.
  return (
    <>
      {content}
      <AppModal state={modal} onClose={() => setModal(null)} />
    </>
  );
}

const SCAN_FRAME_SIZE = 280;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.background, padding: spacing.xl,
  },
  cameraArea: {
    flex: 1,
    overflow: 'hidden',
  },
  scanFrame: {
    position: 'absolute',
    width: SCAN_FRAME_SIZE,
    height: SCAN_FRAME_SIZE,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: radii.card,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  controlsSpacer: { width: 80 },
  captureBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
  },
  captureBtnInner: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#fff',
  },
  btnPrimary: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.button, paddingVertical: 14,
    paddingHorizontal: spacing.xl, marginTop: spacing.lg,
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radii.button, paddingVertical: 10,
    paddingHorizontal: spacing.md, width: 80, alignItems: 'center',
  },
  btnSecondaryText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  previewImage: { width: 200, height: 200, borderRadius: radii.card },
  analyzingText: {
    marginTop: spacing.md, fontSize: 16,
    color: colors.textSecondary, fontWeight: '500',
  },
  analyzingSub: {
    marginTop: spacing.xs, fontSize: 13,
    color: colors.textSecondary, textAlign: 'center',
    lineHeight: 18, opacity: 0.7,
  },
  permTitle: {
    fontSize: 24, fontWeight: '700',
    color: colors.textPrimary, marginBottom: spacing.sm,
  },
  permBody: {
    fontSize: 16, color: colors.textSecondary,
    textAlign: 'center', lineHeight: 24,
  },
});
