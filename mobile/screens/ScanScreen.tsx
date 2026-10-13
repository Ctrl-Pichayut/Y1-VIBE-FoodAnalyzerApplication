/**
 * ScanScreen — Camera capture + image picker for food analysis.
 * Phase 2:
 *  - Faster uploads via expo-image-manipulator (max 1024px, JPEG 0.7).
 *  - Staged progress ("Uploading photo %" → "Detecting dishes" → "Looking up nutrition").
 *  - Cancel button during analysis via AbortController.
 *  - Camera paused when tab is unfocused (useIsFocused).
 *  - Flash mode toggle ('off' | 'on' | 'auto') and framing hint.
 *  - Smart permission handling (Allow Camera vs Open Settings).
 *  - Haptics on shutter impact and analysis success.
 *  - Friendly error handling with retry confirm dialog.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image, LayoutChangeEvent,
  Linking,
} from 'react-native';
import { CameraView, useCameraPermissions, FlashMode } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radii, fonts } from '../theme/tokens';
import { analyzeImage } from '../services/api';
import AppModal, { ModalState } from '../components/AppModal';

const SCAN_FRAME_SIZE = 280;
const MAX_IMAGE_DIMENSION = 1024;

type AnalysisStage = 'upload' | 'detecting' | 'nutrition';

interface StepItemProps {
  label: string;
  status: 'done' | 'active' | 'pending';
}

function ProgressStep({ label, status }: StepItemProps) {
  return (
    <View style={styles.stepRow}>
      <View
        style={[
          styles.stepIconWrap,
          status === 'done' && styles.stepIconWrapDone,
          status === 'active' && styles.stepIconWrapActive,
        ]}
      >
        {status === 'done' ? (
          <Text style={styles.stepCheckmark}>✓</Text>
        ) : status === 'active' ? (
          <ActivityIndicator size="small" color={colors.textPrimary} />
        ) : (
          <View style={styles.stepDotPending} />
        )}
      </View>
      <Text
        style={[
          styles.stepLabel,
          status === 'active' && styles.stepLabelActive,
          status === 'pending' && styles.stepLabelPending,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * Compresses and resizes an image to max 1024px on long edge with 0.7 JPEG quality.
 */
async function optimizeImage(
  uri: string,
  width?: number,
  height?: number
): Promise<string> {
  try {
    const actions: ImageManipulator.Action[] = [];
    if (width && height) {
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        if (width >= height) {
          actions.push({ resize: { width: MAX_IMAGE_DIMENSION } });
        } else {
          actions.push({ resize: { height: MAX_IMAGE_DIMENSION } });
        }
      }
    } else {
      actions.push({ resize: { width: MAX_IMAGE_DIMENSION } });
    }

    const result = await ImageManipulator.manipulateAsync(
      uri,
      actions,
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch (err) {
    console.warn('[optimizeImage] Compression failed, falling back to original:', err);
    return uri;
  }
}

export default function ScanScreen({ navigation }: any) {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>('upload');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);

  const [cameraLayout, setCameraLayout] = useState({ width: 0, height: 0 });
  const [modal, setModal] = useState<ModalState | null>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<FlashMode>('off');

  const cameraRef = useRef<CameraView>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearAllTimers = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  useEffect(() => {
    return () => {
      clearAllTimers();
      abortControllerRef.current?.abort();
    };
  }, []);

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const toggleFlash = () => {
    setFlash(current => {
      if (current === 'off') return 'on';
      if (current === 'on') return 'auto';
      return 'off';
    });
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
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}

      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (photo?.uri) {
        setPreview(photo.uri);
        const optimized = await optimizeImage(photo.uri, photo.width, photo.height);
        await processImage(optimized);
      }
    } catch (e: any) {
      setModal({ title: 'Error', message: e.message || 'Failed to capture photo' });
    }
  };

  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        const asset = result.assets[0];
        setPreview(asset.uri);
        const optimized = await optimizeImage(asset.uri, asset.width, asset.height);
        await processImage(optimized);
      }
    } catch (e: any) {
      setModal({ title: 'Error', message: e.message || 'Failed to select image' });
    }
  };

  const handleCancel = () => {
    clearAllTimers();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setAnalyzing(false);
    setPreview(null);
  };

  const processImage = async (uri: string) => {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    clearAllTimers();
    setAnalyzing(true);
    setAnalysisStage('upload');
    setUploadProgress(25);

    // Guaranteed responsive stage transitions:
    // Upload animation finishes at 1.1s if network is fast
    const t1 = setTimeout(() => {
      setUploadProgress((prev) => Math.max(prev, 65));
    }, 300);

    const t2 = setTimeout(() => {
      setUploadProgress((prev) => Math.max(prev, 90));
    }, 700);

    const t3 = setTimeout(() => {
      setUploadProgress(100);
      setAnalysisStage('detecting');
    }, 1100);

    // Dish detection stage runs while backend runs YOLO/Gemini
    const t4 = setTimeout(() => {
      setAnalysisStage('nutrition');
    }, 4200);

    timersRef.current = [t1, t2, t3, t4];

    try {
      const data = await analyzeImage(uri, {
        signal: abortController.signal,
        onProgress: (pct) => {
          setUploadProgress((prev) => Math.max(prev, pct));
          if (pct >= 100) {
            setAnalysisStage((st) => (st === 'upload' ? 'detecting' : st));
          }
        },
      });

      clearAllTimers();
      setUploadProgress(100);
      setAnalysisStage('nutrition');
      abortControllerRef.current = null;
      setAnalyzing(false);
      setPreview(null);

      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}

      navigation.navigate('Result', { result: data, imageUri: uri });
    } catch (e: any) {
      clearAllTimers();
      abortControllerRef.current = null;
      setAnalyzing(false);

      // Cancelled by user — smoothly return to camera without showing error modal
      if (e.name === 'AbortError' || abortController.signal.aborted) {
        setPreview(null);
        return;
      }

      const isSlowOrColdStart = /network|timeout|server|warming|busy|slow|502|503/i.test(
        e.message || ''
      );

      setModal({
        title: isSlowOrColdStart ? 'Server Slow to Respond' : 'Analysis Failed',
        message: isSlowOrColdStart
          ? 'The AI server is taking longer than usual or waking up. Try again?'
          : (e.message || 'Could not analyze image. Please try again.'),
        confirm: true,
        okLabel: 'Retry',
        cancelLabel: 'Cancel',
        onConfirm: () => {
          processImage(uri);
        },
      });
    }
  };

  // --- Conditional content ---------------------------------------------------
  let content: React.ReactNode;
  if (!permission) {
    content = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.textPrimary} />
      </View>
    );
  } else if (!permission.granted) {
    const canAskAgain = permission.canAskAgain;
    content = (
      <View style={styles.center}>
        <Text style={styles.permTitle}>Camera Access</Text>
        <Text style={styles.permBody}>
          Grant camera permission to scan food items for nutritional analysis.
        </Text>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={canAskAgain ? requestPermission : () => Linking.openSettings()}
          activeOpacity={0.8}
        >
          <Text style={styles.btnPrimaryText}>
            {canAskAgain ? 'Allow Camera' : 'Open Settings'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  } else if (analyzing && preview) {
    content = (
      <View style={styles.analyzingContainer}>
        <View style={styles.previewWrapper}>
          <Image source={{ uri: preview }} style={styles.previewImage} />
          <View style={styles.previewOverlay} />
        </View>

        <Text style={styles.analyzingHeading}>Analyzing Food</Text>

        <View style={styles.stepList}>
          <ProgressStep
            label={
              uploadProgress < 100
                ? `Uploading photo (${uploadProgress}%)`
                : 'Photo uploaded'
            }
            status={analysisStage === 'upload' ? 'active' : 'done'}
          />
          <ProgressStep
            label="Detecting dishes"
            status={
              analysisStage === 'upload'
                ? 'pending'
                : analysisStage === 'detecting'
                ? 'active'
                : 'done'
            }
          />
          <ProgressStep
            label="Looking up nutrition"
            status={analysisStage === 'nutrition' ? 'active' : 'pending'}
          />
        </View>

        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={handleCancel}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    content = (
      <View style={styles.container}>
        <View style={styles.cameraArea} onLayout={handleCameraLayout}>
          {isFocused && (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              flash={flash}
              enableTorch={flash === 'on' && facing === 'back'}
            />
          )}

          {scanFrameStyle && (
            <View
              style={[styles.scanFrame, scanFrameStyle]}
              pointerEvents="none"
            />
          )}

          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.flashBtn}
              onPress={toggleFlash}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Camera flash mode: currently ${flash}`}
            >
              <Text style={styles.flashBtnText}>
                {`Flash: ${flash.charAt(0).toUpperCase() + flash.slice(1)}`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[
          styles.bottomSection,
          { paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.lg }
        ]}>
          <View style={styles.hintContainer}>
            <Text style={styles.hintText}>Fit the whole plate inside the frame</Text>
          </View>

          <View style={styles.controls}>
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={handlePickImage}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Choose food image from gallery"
            >
              <Text style={styles.btnSecondaryText} numberOfLines={1}>Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.captureBtn}
              onPress={handleCapture}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Capture food photo"
            >
              <View style={styles.captureBtnInner} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={toggleCameraFacing}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Flip camera to front or back"
            >
              <Text style={styles.btnSecondaryText} numberOfLines={1}>Flip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <>
      {content}
      <AppModal state={modal} onClose={() => setModal(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  cameraArea: {
    flex: 1,
    overflow: 'hidden',
  },
  topBar: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 10,
  },
  flashBtn: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  flashBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
  },
  scanFrame: {
    position: 'absolute',
    width: SCAN_FRAME_SIZE,
    height: SCAN_FRAME_SIZE,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    borderRadius: radii.card,
  },
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  hintContainer: {
    alignSelf: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 16,
  },
  hintText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontFamily: fonts.body,
    fontSize: 13,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureBtnInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
  },
  btnPrimary: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.button,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
  },
  btnSecondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: radii.button,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    minWidth: 86,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: {
    color: '#FFFFFF',
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    textAlign: 'center',
  },
  permTitle: {
    fontSize: 24,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  permBody: {
    fontSize: 16,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },

  // Analyzing state
  analyzingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  previewWrapper: {
    width: 160,
    height: 160,
    borderRadius: radii.card,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  analyzingHeading: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  stepList: {
    width: '100%',
    maxWidth: 290,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.xs + 2,
  },
  stepIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  stepIconWrapDone: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.textPrimary,
  },
  stepIconWrapActive: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  stepCheckmark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
  },
  stepDotPending: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  stepLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textPrimary,
  },
  stepLabelActive: {
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  stepLabelPending: {
    color: colors.textSecondary,
    opacity: 0.6,
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    minWidth: 140,
  },
  cancelBtnText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.textPrimary,
  },
});
