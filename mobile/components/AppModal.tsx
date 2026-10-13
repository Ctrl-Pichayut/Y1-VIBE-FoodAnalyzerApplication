/**
 * AppModal — themed replacement for Alert.alert().
 *
 * Matches the app's minimalist design system (tokens.ts): black/white buttons,
 * thin borders, no system-blue defaults. Two shapes:
 *
 *   • Acknowledge  — a single primary button (e.g. "OK", "Got it").
 *   • Confirm      — a secondary "Cancel" + a primary action, plus an optional
 *                    `destructive` flag that renders the action button in the
 *                    error red (for destructive actions like delete).
 *
 * Usage:
 *   const [modal, setModal] = useState<ModalState>(null);
 *   ...
 *   setModal({ title: 'Error', message: e.message });                 // OK
 *   setModal({ title: 'Delete meal', message: 'Remove it?',           // confirm
 *              confirm: true, destructive: true,
 *              onConfirm: () => doDelete() });
 *   ...
 *   <AppModal state={modal} onClose={() => setModal(null)} />
 */
import React from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import { colors, spacing, radii, fonts } from '../theme/tokens';

export interface ModalState {
  title: string;
  message?: string;
  /** Show a confirm/cancel pair instead of a single acknowledge button. */
  confirm?: boolean;
  /** Label for the primary action button (defaults contextually). */
  okLabel?: string;
  cancelLabel?: string;
  /** Render the action button in error red (e.g. delete). */
  destructive?: boolean;
  onConfirm?: () => void;
}

interface Props {
  state: ModalState | null;
  onClose: () => void;
}

export default function AppModal({ state, onClose }: Props) {
  const visible = state !== null;

  const handleConfirm = () => {
    const fn = state?.onConfirm;
    onClose();
    if (fn) fn();
  };

  // Default button labels depend on the dialog shape.
  const okLabel = state?.okLabel ?? (state?.confirm ? 'Confirm' : 'OK');
  const cancelLabel = state?.cancelLabel ?? 'Cancel';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback onPress={undefined}>
            <View style={styles.dialog}>
              <Text style={styles.title}>{state?.title}</Text>
              {state?.message ? (
                <Text style={styles.message}>{state.message}</Text>
              ) : null}

              <View style={[
                styles.actions,
                state?.confirm ? styles.actionsRow : styles.actionsStack,
              ]}>
                {state?.confirm ? (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnSecondary, styles.btnFlex]}
                    onPress={onClose}
                  >
                    <Text style={styles.btnSecondaryText}>{cancelLabel}</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    state?.confirm ? styles.btnFlex : null,
                    state?.destructive ? styles.btnDestructive : null,
                  ]}
                  onPress={handleConfirm}
                >
                  <Text style={styles.btnPrimaryText}>{okLabel}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  dialog: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  actions: {
    width: '100%',
  },
  // Single-button dialogs stack vertically (full-width button).
  // alignSelf: 'stretch' makes the lone button fill the dialog width.
  actionsStack: {
    flexDirection: 'column',
    alignSelf: 'stretch',
  },
  // Confirm dialogs put cancel + action side by side.
  // flex: 1 lives here (not on the buttons) so the two buttons split the
  // row width 50/50 — and the single-button case isn't affected.
  actionsRow: {
    flexDirection: 'row-reverse', // primary action on the right
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  btn: {
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  // Applied only in confirm (row) mode so the two buttons split the width.
  btnFlex: {
    flex: 1,
  },
  // Filled black primary (matches app's buttonPrimary token)
  btnPrimary: {
    backgroundColor: colors.textPrimary,
  },
  btnPrimaryText: {
    color: colors.surface,
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
  },
  // Outlined secondary (matches app's buttonSecondary token)
  btnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: {
    color: colors.textPrimary,
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
  },
  // Destructive variant — same shape, error red
  btnDestructive: {
    backgroundColor: colors.error,
  },
});
