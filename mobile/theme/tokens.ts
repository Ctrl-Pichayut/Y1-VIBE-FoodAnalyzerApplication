/**
 * Design tokens — soft, calm UI system.
 * Warm off-white canvas, white surfaces lifted by soft shadows (not hard
 * borders), generous radii, and bold Space Grotesk numbers as hierarchy.
 * Icons come from Ionicons (@expo/vector-icons).
 */
import { StyleSheet, Platform } from 'react-native';

export const colors = {
  background: '#F5F4EF',
  surface: '#FFFFFF',
  surfaceMuted: '#F0EFE9',
  textPrimary: '#121714',
  textSecondary: '#6A6F6B',
  textTertiary: '#A0A49F',
  textOnDark: '#FFFFFF',
  ink: '#16261C', // deep green-black for hero / primary surfaces
  accent: '#2C5F2E',
  accentBright: '#3E8E43',
  accentSoft: '#E5EFE2',
  border: '#E9E7E0',
  borderStrong: '#D9D7CF',
  error: '#C62828',
  errorSoft: '#FBEAEA',
  excellent: '#2C5F2E',
  moderate: '#D9940F',
  moderateSoft: '#FCF1DA',
  limit: '#C62828',
  limitSoft: '#FBEAEA',
  overlay: 'rgba(10, 16, 12, 0.45)',
};

/** Distinct, non-judgemental colors for macro breakdowns. */
export const macroColors = {
  protein: '#2C5F2E',
  carbs: '#D9940F',
  fat: '#D0613A',
};

export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
};

export const typography = StyleSheet.create({
  display: {
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 38,
  },
  h1: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 30,
  },
  h2: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 24,
  },
  number: {
    fontFamily: fonts.display,
    fontSize: 28,
  },
  numberLg: {
    fontFamily: fonts.display,
    fontSize: 48,
    lineHeight: 52,
  },
  numberSm: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 24,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
  },
  bodyMedium: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    lineHeight: 21,
  },
  bodySemiBold: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 21,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
  },
  captionMedium: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
  },
  button: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
  },
});

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radii = {
  sm: 8,
  card: 20,
  button: 14,
  input: 12,
  pill: 999,
};

/**
 * Soft elevation. iOS uses a tinted, diffuse shadow; Android uses elevation.
 */
export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: '#1B2A20',
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
    },
    default: { elevation: 2, shadowColor: '#1B2A20' },
  }) as object,
  raised: Platform.select({
    ios: {
      shadowColor: '#1B2A20',
      shadowOpacity: 0.14,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
    default: { elevation: 8, shadowColor: '#1B2A20' },
  }) as object,
  bar: Platform.select({
    ios: {
      shadowColor: '#1B2A20',
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: -4 },
    },
    default: { elevation: 12, shadowColor: '#1B2A20' },
  }) as object,
};

export function getHealthColor(label: string): string {
  switch (label) {
    case 'Excellent': return colors.excellent;
    case 'Moderate': return colors.moderate;
    case 'Limit': return colors.limit;
    default: return colors.textSecondary;
  }
}

/** Pale background tint matching getHealthColor(). */
export function getHealthSoftColor(label: string): string {
  switch (label) {
    case 'Excellent': return colors.accentSoft;
    case 'Moderate': return colors.moderateSoft;
    case 'Limit': return colors.limitSoft;
    default: return colors.surfaceMuted;
  }
}

export const globalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  buttonPrimary: {
    backgroundColor: colors.ink,
    borderRadius: radii.button,
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: spacing.sm,
  },
  buttonPrimaryText: {
    color: colors.textOnDark,
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: spacing.sm,
  },
  buttonSecondaryText: {
    color: colors.textPrimary,
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: radii.input,
    padding: spacing.md,
    fontSize: 16,
    fontFamily: fonts.body,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
});
