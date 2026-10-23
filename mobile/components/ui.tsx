/**
 * Shared UI primitives — small animated building blocks used across screens.
 *
 *   • PressableScale — button/card wrapper that springs down slightly on press.
 *   • FadeInView     — fades + slides content up on mount (optional delay for staggering).
 *   • AnimatedBar    — progress bar whose fill eases to the target ratio.
 *   • IconBubble     — Ionicon inside a tinted circle.
 *   • Toast          — floating snackbar that slides in/out, with optional action.
 *
 * All animations use React Native's built-in Animated API (no extra native deps).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radii, shadows, spacing } from '../theme/tokens';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Icon for a meal category (breakfast / lunch / dinner / snack). */
export function mealTypeIcon(mealType?: string): IconName {
  switch (mealType) {
    case 'breakfast': return 'cafe-outline';
    case 'lunch': return 'restaurant-outline';
    case 'dinner': return 'moon-outline';
    case 'snack': return 'ice-cream-outline';
    default: return 'fast-food-outline';
  }
}

// ---------------------------------------------------------------------------
// PressableScale
// ---------------------------------------------------------------------------
interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Scale reached while pressed (default 0.97). */
  scaleTo?: number;
  /** Fade the control while `disabled` (default true). */
  dimWhenDisabled?: boolean;
  children?: React.ReactNode;
}

export function PressableScale({
  style,
  scaleTo = 0.97,
  dimWhenDisabled = true,
  children,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue: number) =>
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: toValue === 1 ? 6 : 0,
    }).start();

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        animateTo(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        animateTo(1);
        onPressOut?.(e);
      }}
      style={[
        style,
        { transform: [{ scale }] },
        disabled && dimWhenDisabled ? styles.disabled : null,
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

// ---------------------------------------------------------------------------
// FadeInView
// ---------------------------------------------------------------------------
export function FadeInView({
  delay = 0,
  offset = 14,
  style,
  onLayout,
  children,
}: {
  delay?: number;
  offset?: number;
  style?: StyleProp<ViewStyle>;
  onLayout?: ViewProps['onLayout'];
  children?: React.ReactNode;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 420,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, delay]);

  return (
    <Animated.View
      onLayout={onLayout}
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [offset, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// AnimatedBar
// ---------------------------------------------------------------------------
export function AnimatedBar({
  ratio,
  color,
  height = 6,
  trackColor = colors.surfaceMuted,
  style,
}: {
  /** 0..1 (values above 1 are clamped). */
  ratio: number;
  color: string;
  height?: number;
  trackColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const clamped = Math.max(0, Math.min(1, isFinite(ratio) ? ratio : 0));
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: clamped,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [anim, clamped]);

  return (
    <View
      style={[
        { height, borderRadius: height / 2, backgroundColor: trackColor, overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View
        style={{
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: color,
          width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// IconBubble
// ---------------------------------------------------------------------------
export function IconBubble({
  name,
  size = 40,
  color = colors.accent,
  background = colors.accentSoft,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  background?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Ionicons name={name} size={Math.round(size * 0.5)} color={color} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
export function Toast({
  message,
  icon = 'checkmark-circle',
  actionLabel,
  onAction,
  bottom = spacing.lg,
}: {
  message: string | null;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  bottom?: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  // Keep showing the last message while the exit animation runs.
  const [shown, setShown] = useState<string | null>(message);

  useEffect(() => {
    if (message) {
      setShown(message);
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 18,
        bounciness: 6,
      }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setShown(null);
      });
    }
  }, [message, anim]);

  if (!shown) return null;

  return (
    <Animated.View
      pointerEvents={message ? 'auto' : 'none'}
      style={[
        styles.toast,
        {
          bottom,
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
            { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={String(icon).startsWith('alert') ? '#F2A7A7' : '#9FD39F'}
      />
      <Text style={styles.toastText} numberOfLines={2}>
        {shown}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.toastAction, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <Text style={styles.toastActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.6,
  },
  toast: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.ink,
    borderRadius: radii.button + 2,
    paddingVertical: 13,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    ...shadows.raised,
  },
  toastText: {
    flex: 1,
    color: colors.textOnDark,
    fontSize: 14,
    fontFamily: fonts.bodyMedium,
  },
  toastAction: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
  },
  toastActionText: {
    color: colors.textOnDark,
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
  },
});
