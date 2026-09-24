/**
 * HistoryScreen — Paginated meal journal with daily summary at top.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Swipeable } from 'react-native-gesture-handler';
import { colors, spacing, radii, getHealthColor } from '../theme/tokens';
import { getHistory, getDailySummary, deleteMeal } from '../services/api';
import AppModal, { ModalState } from '../components/AppModal';

export default function HistoryScreen({ navigation }: any) {
  const [meals, setMeals] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [modal, setModal] = useState<ModalState | null>(null);

  const fetchData = async (p = 1, refresh = false) => {
    try {
      const [historyRes, summaryRes] = await Promise.all([
        getHistory(p),
        getDailySummary(),
      ]);
      if (refresh || p === 1) {
        setMeals(historyRes.meals);
      } else {
        setMeals(prev => [...prev, ...historyRes.meals]);
      }
      setSummary(summaryRes);
      setHasMore(p < historyRes.total_pages);
      setPage(p);
    } catch (e: any) {
      if (!refresh) setModal({ title: 'Error', message: e.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchData(1, true);
  }, []));

  const onRefresh = () => { setRefreshing(true); fetchData(1, true); };
  const onLoadMore = () => { if (hasMore) fetchData(page + 1); };

  const handleDelete = (id: number) => {
    setModal({
      title: 'Delete meal',
      message: 'Remove this meal from history?',
      confirm: true,
      destructive: true,
      okLabel: 'Delete',
      onConfirm: async () => {
        try {
          await deleteMeal(id);
          fetchData(1, true);
        } catch (e: any) {
          setModal({ title: 'Error', message: e.message });
        }
      },
    });
  };

  let content;
  if (loading) {
    content = <View style={styles.center}><ActivityIndicator size="large" /></View>;
  } else {
    content = (
      <View style={styles.container}>
        <FlatList
          data={meals}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ padding: spacing.md }}
          ListHeaderComponent={() => (
            <View>
              <Text style={styles.title}>Today</Text>
              {summary && <DailySummaryCard summary={summary} />}
              <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Meal history</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <MealCard meal={item} onOpen={() => navigation.navigate('MealDetail', { meal: item })} onDelete={() => handleDelete(item.id)} />
          )}
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No meals yet</Text>
              <Text style={styles.emptyBody}>Scan your first meal to get started</Text>
            </View>
          )}
        />
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

function DailySummaryCard({ summary }: { summary: any }) {
  const t = summary.totals || {};
  const targets = summary.targets || {};
  const progress = summary.progress || {};

  return (
    <View style={styles.card}>
      <View style={styles.summaryRow}>
        <SummaryItem label="Calories" value={Math.round(t.calories || 0)} target={targets.calories} progress={progress.calories} />
        <SummaryItem label="Protein" value={Math.round(t.protein || 0)} target={targets.protein} unit="g" progress={progress.protein} />
        <SummaryItem label="Carbs" value={Math.round(t.carbs || 0)} target={targets.carbs} unit="g" progress={progress.carbs} />
        <SummaryItem label="Fat" value={Math.round(t.fat || 0)} target={targets.fat} unit="g" progress={progress.fat} />
      </View>
      <Text style={styles.mealsCount}>{summary.meals_count} meal{summary.meals_count !== 1 ? 's' : ''} logged today</Text>
    </View>
  );
}

function SummaryItem({ label, value, target, unit, progress }: any) {
  const pct = progress || 0;
  const color = pct > 100 ? colors.error : pct > 80 ? colors.moderate : colors.textPrimary;
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryTarget}>/ {target}{unit || ''}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function MealCard({ meal, onOpen, onDelete }: { meal: any; onOpen: () => void; onDelete: () => void }) {
  const foods = meal.foods_json || [];
  const time = new Date(meal.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = new Date(meal.timestamp).toLocaleDateString();
  const totalCal = meal.totals_json?.calories ? Math.round(meal.totals_json.calories) : 0;

  const renderRightActions = () => (
    <TouchableOpacity style={styles.deleteAction} onPress={onDelete}>
      <Text style={styles.deleteActionText}>Delete</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable renderRightActions={renderRightActions}>
      <TouchableOpacity style={styles.card} onPress={onOpen} activeOpacity={0.7}>
        <View style={styles.mealHeader}>
          <View>
            <Text style={styles.mealTime}>{time}</Text>
            <Text style={styles.mealDate}>{date}</Text>
          </View>
          <Text style={styles.mealCal}>{totalCal} kcal</Text>
        </View>
        {foods.map((f: any, i: number) => (
          <View key={i} style={styles.mealFoodRow}>
            <Text style={styles.mealFoodName}>{f.name}</Text>
            <Text style={[styles.mealFoodScore, { color: getHealthColor(f.health_label) }]}>
              {f.health_score}
            </Text>
          </View>
        ))}
        <Text style={styles.tapHint}>Tap to view details · Swipe left to delete</Text>
      </TouchableOpacity>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { fontSize: 32, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  sectionLabel: {
    fontSize: 13, fontWeight: '600', color: colors.textSecondary,
    letterSpacing: 0.3, marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.card,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryItem: { alignItems: 'center', flex: 1 },
  summaryValue: { fontSize: 24, fontWeight: '700' },
  summaryTarget: { fontSize: 11, color: colors.textSecondary },
  summaryLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  mealsCount: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md },
  mealHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  mealTime: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  mealDate: { fontSize: 12, color: colors.textSecondary },
  mealCal: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  mealFoodRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border,
  },
  mealFoodName: { fontSize: 14, color: colors.textPrimary },
  mealFoodScore: { fontSize: 16, fontWeight: '700' },
  tapHint: { fontSize: 11, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  emptyBody: { fontSize: 15, color: colors.textSecondary, marginTop: spacing.sm },
  deleteAction: {
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: radii.card,
    marginBottom: spacing.md,
  },
  deleteActionText: { color: '#fff', fontWeight: '600' },
});
