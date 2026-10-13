/**
 * AdminScreen — Review Gemini-estimated dishes and promote good ones to the
 * verified nutrition database.
 *
 * Each row is a dish that Gemini estimated nutrition for (source="gemini",
 * captured automatically on scan). Tapping a card expands editable nutrition
 * fields pre-filled with Gemini's values; the admin corrects if needed and
 * taps Promote (→ future scans treat it as verified) or Reject.
 *
 * Modeled on HistoryScreen's pagination + AppModal patterns.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radii, fonts } from '../theme/tokens';
import { getReviewQueue, getReviewStats, submitReview } from '../services/api';
import AppModal, { ModalState } from '../components/AppModal';

interface ReviewItem {
  id: number;
  dish_name: string;
  per_100g: any;
  allergens: string[];
  status: string;
  created_at: string;
}

export default function AdminScreen() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [stats, setStats] = useState<{ pending: number; promoted: number; rejected: number }>(
    { pending: 0, promoted: 0, rejected: 0 }
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const fetchData = async (p = 1, refresh = false) => {
    try {
      const [queueRes, statsRes] = await Promise.all([
        getReviewQueue(p),
        getReviewStats().catch(() => null),
      ]);
      if (refresh || p === 1) {
        setItems(queueRes.items);
      } else {
        setItems(prev => [...prev, ...queueRes.items]);
      }
      if (statsRes) setStats(statsRes);
      setHasMore(p < queueRes.total_pages);
      setPage(p);
    } catch (e: any) {
      setModal({ title: 'Error', message: e.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => {
    setLoading(true);
    setExpandedId(null);
    fetchData(1, true);
  }, []));

  const onRefresh = () => { setRefreshing(true); fetchData(1, true); };
  const onLoadMore = () => { if (hasMore) fetchData(page + 1); };

  const handlePromote = (item: ReviewItem, edited: any, editedAllergens: string) => {
    setModal({
      title: 'Promote dish',
      message: `Add "${item.dish_name}" to the verified nutrition database? Future scans will use this data instead of asking Gemini.`,
      confirm: true,
      okLabel: 'Promote',
      onConfirm: async () => {
        try {
          const allergens = editedAllergens
            ? editedAllergens.split(',').map(s => s.trim()).filter(Boolean)
            : [];
          await submitReview(item.id, {
            action: 'promote',
            per_100g: edited,
            allergens,
          });
          // Remove from the pending list + update stats
          setItems(prev => prev.filter(i => i.id !== item.id));
          setStats(s => ({ ...s, pending: s.pending - 1, promoted: s.promoted + 1 }));
          setExpandedId(null);
          showToast(`Promoted "${item.dish_name}"`);
        } catch (e: any) {
          setModal({ title: 'Error', message: e.message });
        }
      },
    });
  };

  const handleReject = (item: ReviewItem) => {
    setModal({
      title: 'Reject dish',
      message: `Discard Gemini's estimate for "${item.dish_name}"? It won't be promoted, but future scans may re-capture it.`,
      confirm: true,
      destructive: true,
      okLabel: 'Reject',
      onConfirm: async () => {
        try {
          await submitReview(item.id, { action: 'reject' });
          setItems(prev => prev.filter(i => i.id !== item.id));
          setStats(s => ({ ...s, pending: s.pending - 1, rejected: s.rejected + 1 }));
          setExpandedId(null);
          showToast(`Rejected "${item.dish_name}"`);
        } catch (e: any) {
          setModal({ title: 'Error', message: e.message });
        }
      },
    });
  };

  if (loading) {
    return (
      <>
        <View style={styles.center}><ActivityIndicator size="large" /></View>
        <AppModal state={modal} onClose={() => setModal(null)} />
      </>
    );
  }

  return (
    <>
      <View style={styles.container}>
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
          ListHeaderComponent={() => (
            <View>
              <Text style={styles.title}>Review queue</Text>
              <View style={styles.statsRow}>
                <StatPill label="Pending" value={stats.pending} active />
                <StatPill label="Promoted" value={stats.promoted} />
                <StatPill label="Rejected" value={stats.rejected} />
              </View>
            </View>
          )}
          renderItem={({ item }) => (
            <ReviewCard
              item={item}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onPromote={handlePromote}
              onReject={handleReject}
            />
          )}
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No dishes to review</Text>
              <Text style={styles.emptyBody}>
                Scan food to populate the queue. Dishes that Gemini estimates
                nutrition for will appear here automatically.
              </Text>
            </View>
          )}
        />
      </View>
      <AppModal state={modal} onClose={() => setModal(null)} />
      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </>
  );
}

function StatPill({ label, value, active }: { label: string; value: number; active?: boolean }) {
  return (
    <View style={[styles.statPill, active && styles.statPillActive]}>
      <Text style={[styles.statValue, active && styles.statValueActive]}>{value}</Text>
      <Text style={[styles.statLabel, active && styles.statLabelActive]}>{label}</Text>
    </View>
  );
}

function ReviewCard({ item, expanded, onToggle, onPromote, onReject }: {
  item: ReviewItem;
  expanded: boolean;
  onToggle: () => void;
  onPromote: (item: ReviewItem, edited: any, allergens: string) => void;
  onReject: (item: ReviewItem) => void;
}) {
  // Local editable copy of the nutrition values
  const [edited, setEdited] = useState<any>({ ...item.per_100g });
  const [allergens, setAllergens] = useState<string>((item.allergens || []).join(', '));

  const p = item.per_100g || {};
  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dishName}>{item.dish_name}</Text>
            <Text style={styles.tag}>Gemini estimate · tap to review</Text>
          </View>
          <Text style={styles.chevron}>{expanded ? '−' : '+'}</Text>
        </View>
      </TouchableOpacity>

      {!expanded && (
        // Collapsed: compact macro summary
        <View style={styles.macroRow}>
          <MiniMacro label="Cal" value={p.calories} />
          <MiniMacro label="Protein" value={p.protein} />
          <MiniMacro label="Carbs" value={p.carbs} />
          <MiniMacro label="Fat" value={p.fat} />
        </View>
      )}

      {expanded && (
        <View style={styles.editSection}>
          <Text style={styles.fieldLabel}>Nutrition (per 100g) — edit if needed</Text>
          <View style={styles.fieldGrid}>
            <NumberField label="Calories" value={edited.calories}
              onChange={(v) => setEdited({ ...edited, calories: v })} />
            <NumberField label="Protein (g)" value={edited.protein}
              onChange={(v) => setEdited({ ...edited, protein: v })} />
            <NumberField label="Fat (g)" value={edited.fat}
              onChange={(v) => setEdited({ ...edited, fat: v })} />
            <NumberField label="Carbs (g)" value={edited.carbs}
              onChange={(v) => setEdited({ ...edited, carbs: v })} />
            <NumberField label="Fiber (g)" value={edited.fiber}
              onChange={(v) => setEdited({ ...edited, fiber: v })} />
            <NumberField label="Sugar (g)" value={edited.sugar}
              onChange={(v) => setEdited({ ...edited, sugar: v })} />
            <NumberField label="Sodium (mg)" value={edited.sodium_mg}
              onChange={(v) => setEdited({ ...edited, sodium_mg: v })} />
            <NumberField label="Sat fat (g)" value={edited.saturated_fat_g}
              onChange={(v) => setEdited({ ...edited, saturated_fat_g: v })} />
          </View>

          <Text style={styles.fieldLabel}>Allergens (comma-separated)</Text>
          <TextInput
            style={styles.input}
            value={allergens}
            onChangeText={setAllergens}
            placeholder="e.g. peanuts, shellfish"
            placeholderTextColor={colors.textSecondary}
          />

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={() => onReject(item)}
            >
              <Text style={styles.btnSecondaryText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => onPromote(item, edited, allergens)}
            >
              <Text style={styles.btnPrimaryText}>Promote</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

function MiniMacro({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.miniMacro}>
      <Text style={styles.miniValue}>{Math.round(value || 0)}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.numberField}>
      <Text style={styles.numberLabel}>{label}</Text>
      <TextInput
        style={styles.numberInput}
        value={String(value ?? 0)}
        onChangeText={(t) => onChange(parseFloat(t) || 0)}
        keyboardType="numeric"
        placeholderTextColor={colors.textSecondary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },

  title: { fontSize: 32, fontFamily: fonts.display, color: colors.textPrimary, marginBottom: spacing.md },

  // Stats row
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statPill: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radii.card,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center',
  },
  statPillActive: { borderColor: colors.textPrimary, borderWidth: 2 },
  statValue: { fontSize: 24, fontFamily: fonts.display, color: colors.textPrimary },
  statValueActive: { color: colors.textPrimary },
  statLabel: { fontSize: 12, fontFamily: fonts.bodyMedium, color: colors.textSecondary, marginTop: 2 },
  statLabelActive: { color: colors.textPrimary, fontFamily: fonts.bodySemiBold },

  // Card
  card: {
    backgroundColor: colors.surface, borderRadius: radii.card,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dishName: { fontSize: 18, fontFamily: fonts.display, color: colors.textPrimary },
  tag: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 2 },
  chevron: { fontSize: 24, fontFamily: fonts.body, color: colors.textSecondary },

  // Collapsed macros
  macroRow: { flexDirection: 'row', marginTop: spacing.sm },
  miniMacro: { flex: 1, alignItems: 'center' },
  miniValue: { fontSize: 16, fontFamily: fonts.display, color: colors.textPrimary },
  miniLabel: { fontSize: 11, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 2 },

  // Expanded editor
  editSection: { marginTop: spacing.md },
  fieldLabel: { fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  numberField: { width: '47%' },
  numberLabel: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginBottom: 2 },
  numberInput: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.input, padding: spacing.sm, fontSize: 15,
    fontFamily: fonts.body, color: colors.textPrimary,
  },
  input: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.input, padding: spacing.sm, fontSize: 15,
    fontFamily: fonts.body, color: colors.textPrimary,
  },

  // Actions
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: { flex: 1, borderRadius: radii.button, paddingVertical: 14, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.textPrimary },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontFamily: fonts.bodySemiBold },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnSecondaryText: { color: colors.error, fontSize: 15, fontFamily: fonts.bodySemiBold },

  // Empty
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyTitle: { fontSize: 20, fontFamily: fonts.display, color: colors.textPrimary },
  emptyBody: { fontSize: 15, fontFamily: fonts.body, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center', lineHeight: 21 },

  // Toast
  toast: {
    position: 'absolute', bottom: spacing.lg, left: spacing.md, right: spacing.md,
    backgroundColor: colors.textPrimary, borderRadius: radii.button,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md,
  },
  toastText: { color: '#fff', fontSize: 14, fontFamily: fonts.bodySemiBold, textAlign: 'center' },
});
