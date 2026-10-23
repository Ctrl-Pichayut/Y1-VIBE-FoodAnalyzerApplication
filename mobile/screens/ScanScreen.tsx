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
 *  - Full-bleed camera with corner-bracket frame and animated scan line while analyzing.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet,
  ActivityIndicator, Image, LayoutChangeEvent,
  Linking, Animated, Easing,
} from 'react-native';
import { CameraView, useCameraPermissions, FlashMode } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radii, fonts, shadows } from '../theme/tokens';
import { analyzeImage } from '../services/api';
import AppModal, { ModalState } from '../components/AppModal';
import { FadeInView, IconBubble, IconName, PressableScale } from '../components/ui';

const SCAN_FRAME_SIZE = 280;
const MAX_IMAGE_DIMENSION = 1024;
const PREVIEW_SIZE = 200;

type AnalysisStage = 'upload' | 'detecting' | 'nutrition';

interface StepItemProps {
  label: string;
  icon: IconName;
  status: 'done' | 'active' | 'pending';
}

function ProgressStep({ label, icon, status }: StepItemProps) {
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
          <Ionicons name="checkmark" size={16} color={colors.textOnDark} />
        ) : status === 'active' ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Ionicons name={icon} size={15} color={colors.textTertiary} />
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

/** Four L-shaped corners that gently "breathe" to invite framing the plate. */
function ScanFrame({ style }: { style: any }) {
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.scanFrame,
        style,
        { transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }] },
      ]}
    >
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />
    </Animated.View>
  );
}

/** Light sweep that moves over the preview image while analysis runs. */
function ScanLine() {
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.scanLine,
        {
          transform: [
            { translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, PREVIEW_SIZE - 3] }) },
          ],
        },
      ]}
    />
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

const FLASH_ICONS: Record<string, IconName> = {
  off: 'flash-off',
  on: 'flash',
  auto: 'flash-outline',
};

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
        top: (cameraLayout.height - SCAN_FRAME_SIZE) / 2 - spacing.xl,
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
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  } else if (!permission.granted) {
    const canAskAgain = permission.canAskAgain;
    content = (
      <View style={styles.center}>
        <FadeInView style={{ alignItems: 'center' }}>
          <IconBubble name="camera" size={84} />
          <Text style={styles.permTitle}>Camera access</Text>
          <Text style={styles.permBody}>
            Allow camera access to scan your food and get an instant nutrition breakdown.
          </Text>
          <PressableScale
            style={styles.btnPrimary}
            onPress={canAskAgain ? requestPermission : () => Linking.openSettings()}
          >
            <Ionicons
              name={canAskAgain ? 'camera-outline' : 'settings-outline'}
              size={18}
              color={colors.textOnDark}
            />
            <Text style={styles.btnPrimaryText}>
              {canAskAgain ? 'Allow Camera' : 'Open Settings'}
            </Text>
          </PressableScale>
          <PressableScale style={styles.permGalleryBtn} onPress={handlePickImage}>
            <Text style={styles.permGalleryText}>Choose from gallery instead</Text>
          </PressableScale>
        </FadeInView>
      </View>
    );
  } else if (analyzing && preview) {
    content = (
      <View style={styles.analyzingContainer}>
        <FadeInView style={{ alignItems: 'center', width: '100%' }}>
          <View style={styles.previewWrapper}>
            <Image source={{ uri: preview }} style={styles.previewImage} />
            <View style={styles.previewOverlay} />
            <ScanLine />
          </View>

          <Text style={styles.analyzingHeading}>Analyzing your food</Text>
          <Text style={styles.analyzingSub}>This usually takes a few seconds</Text>

          <View style={styles.stepList}>
            <ProgressStep
              icon="cloud-upload-outline"
              label={
                uploadProgress < 100
                  ? `Uploading photo (${uploadProgress}%)`
                  : 'Photo uploaded'
              }
              status={analysisStage === 'upload' ? 'active' : 'done'}
            />
            <ProgressStep
              icon="scan-outline"
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
              icon="nutrition-outline"
              label="Looking up nutrition"
              status={analysisStage === 'nutrition' ? 'active' : 'pending'}
            />
          </View>

          <PressableScale style={styles.cancelBtn} onPress={handleCancel}>
            <Ionicons name="close" size={18} color={colors.textPrimary} />
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </PressableScale>
        </FadeInView>
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

          {scanFrameStyle && <ScanFrame style={scanFrameStyle} />}

          <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
            <View style={styles.titlePill}>
              <Ionicons name="scan" size={15} color={colors.textOnDark} />
              <Text style={styles.titlePillText}>Scan food</Text>
            </View>
            <PressableScale
              style={[styles.flashBtn, flash !== 'off' && styles.flashBtnActive]}
              onPress={toggleFlash}
              scaleTo={0.9}
              accessibilityRole="button"
              accessibilityLabel={`Camera flash mode: currently ${flash}`}
            >
              <Ionicons
                name={FLASH_ICONS[flash] ?? 'flash-off'}
                size={18}
                color={flash !== 'off' ? colors.ink : colors.textOnDark}
              />
              <Text style={[styles.flashBtnText, flash !== 'off' && { color: colors.ink }]}>
                {flash.charAt(0).toUpperCase() + flash.slice(1)}
              </Text>
            </PressableScale>
          </View>

          <View style={styles.bottomSection}>
            <View style={styles.hintContainer}>
              <Ionicons name="restaurant-outline" size={14} color="rgba(255,255,255,0.9)" />
              <Text style={styles.hintText}>Fit the whole plate inside the frame</Text>
            </View>

            <View style={styles.controls}>
              <ControlButton
                icon="images-outline"
                label="Gallery"
                onPress={handlePickImage}
                accessibilityLabel="Choose food image from gallery"
              />

              <PressableScale
                style={styles.captureBtn}
                onPress={handleCapture}
                scaleTo={0.88}
                accessibilityRole="button"
                accessibilityLabel="Capture food photo"
              >
                <View style={styles.captureBtnInner} />
              </PressableScale>

              <ControlButton
                icon="camera-reverse-outline"
                label="Flip"
                onPress={toggleCameraFacing}
                accessibilityLabel="Flip camera to front or back"
              />
            </View>
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

function ControlButton({
  icon,
  label,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.controlCol}>
      <PressableScale
        style={styles.controlBtn}
        onPress={onPress}
        scaleTo={0.9}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <Ionicons name={icon} size={24} color={colors.textOnDark} />
      </PressableScale>
      <Text style={styles.controlLabel}>{label}</Text>
    </View>
  );
}

const CORNER = 34;
const CORNER_W = 4;

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
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  titlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
  },
  titlePillText: {
    color: colors.textOnDark,
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
  },
  flashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
  },
  flashBtnActive: {
    backgroundColor: '#FFE58A',
  },
  flashBtnText: {
    color: colors.textOnDark,
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
  },
  scanFrame: {
    position: 'absolute',
    width: SCAN_FRAME_SIZE,
    height: SCAN_FRAME_SIZE,
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: '#FFFFFF',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_W,
    borderLeftWidth: CORNER_W,
    borderTopLeftRadius: 22,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_W,
    borderRightWidth: CORNER_W,
    borderTopRightRadius: 22,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_W,
    borderLeftWidth: CORNER_W,
    borderBottomLeftRadius: 22,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_W,
    borderRightWidth: CORNER_W,
    borderBottomRightRadius: 22,
  },
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: spacing.lg,
  },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: radii.pill,
  },
  hintText: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  controlCol: {
    alignItems: 'center',
    width: 72,
  },
  controlBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlLabel: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    marginTop: 6,
  },
  captureBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  captureBtnInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
  },
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.ink,
    borderRadius: radii.button,
    paddingVertical: 15,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  btnPrimaryText: {
    color: colors.textOnDark,
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
  },
  permTitle: {
    fontSize: 24,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  permBody: {
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  permGalleryBtn: {
    marginTop: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  permGalleryText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.accent,
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
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: 28,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: spacing.lg,
    backgroundColor: colors.surfaceMuted,
    ...shadows.raised,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(22, 38, 28, 0.25)',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 3,
    backgroundColor: '#B9F0B9',
    shadowColor: '#B9F0B9',
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  analyzingHeading: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.textPrimary,
  },
  analyzingSub: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  stepList: {
    width: '100%',
    maxWidth: 300,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
    ...shadows.card,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.xs + 3,
  },
  stepIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  stepIconWrapDone: {
    backgroundColor: colors.accent,
  },
  stepIconWrapActive: {
    backgroundColor: colors.accentSoft,
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
    color: colors.textTertiary,
  },
  cancelBtn: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 140,
    ...shadows.card,
  },
  cancelBtnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
});
