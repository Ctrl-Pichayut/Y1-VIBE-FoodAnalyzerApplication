/**
 * Design tokens — minimalist UI system per spec.
 * No icons. No gradients. No shadows. Bold numbers as visual hierarchy.
 */
import { StyleSheet } from 'react-native';

export const colors = {
  background: '#FAFAF9',
  surface: '#FFFFFF',
  textPrimary: '#0D0D0D',
  textSecondary: '#6B6B6B',
  accent: '#2C5F2E',
  border: '#EBEBEB',
  error: '#C62828',
  excellent: '#2C5F2E',
  moderate: '#E8A317',
  limit: '#C62828',
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
  card: 12,
  button: 8,
  input: 8,
};

export function getHealthColor(label: string): string {
  switch (label) {
    case 'Excellent': return colors.excellent;
    case 'Moderate': return colors.moderate;
    case 'Limit': return colors.limit;
    default: return colors.textSecondary;
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
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  buttonPrimary: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.button,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    alignItems: 'center' as const,
  },
  buttonPrimaryText: {
    color: colors.surface,
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    alignItems: 'center' as const,
  },
  buttonSecondaryText: {
    color: colors.textPrimary,
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    padding: spacing.md,
    fontSize: 16,
    fontFamily: fonts.body,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
});
