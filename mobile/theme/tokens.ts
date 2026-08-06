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
    fontSize: 16,
    fontWeight: '600' as const,
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
    fontSize: 16,
    fontWeight: '600' as const,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    padding: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
});
