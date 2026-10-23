/**
 * HistoryScreen — Paginated meal journal grouped by day with SectionList.
 *
 * Features:
 *   • SectionList grouped by day ("Today", "Yesterday", "Mon, 12 Oct") with per-day total kcal.
 *   • Meal type badges (Breakfast, Lunch, Dinner, Snack) on each meal card.
 *   • "+ Log Manually" action button in top bar & empty state (Part 4.1).
 *   • Swipeable delete + onLongPress confirmation AppModal.
 *   • Optimistic delete with 5-second Undo toast.
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radii, getHealthColor, fonts, shadows } from '../theme/tokens';
import { getHistory, deleteMeal, isLoggedIn } from '../services/api';
import AppModal, { ModalState } from '../components/AppModal';
import DishCorrectionModal from '../components/DishCorrectionModal';
import { FadeInView, IconBubble, PressableScale, Toast, mealTypeIcon } from '../components/ui';

interface MealSection {
  title: string;
  totalKcal: number;
  data: any[];
}

function formatMealType(mealType?: string): string {
  if (!mealType) return 'Meal';
  return mealType.charAt(0).toUpperCase() + mealType.slice(1);
}

export default function HistoryScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [meals, setMeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(false);
  const [manualLogOpen, setManualLogOpen] = useState(false);

  // Undo toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(0);
  const pendingDeleteRef = useRef<{
    id: number;
    item: any;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  // Undo countdown
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (undoSeconds > 0) {
      interval = setInterval(() => {
        setUndoSeconds((s) => {
          if (s <= 1) {
            setToastMessage(null);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [undoSeconds]);

  const fetchData = async (p = 1, isRefresh = false) => {
    if (!isLoggedIn()) {
      setIsUserLoggedIn(false);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setIsUserLoggedIn(true);

    try {
      const historyRes = await getHistory(p);
      if (isRefresh || p === 1) {
        setMeals(historyRes.meals || []);
      } else {
        setMeals((prev) => [...prev, ...(historyRes.meals || [])]);
      }
      setHasMore(p < historyRes.total_pages);
      setPage(p);
    } catch (e: any) {
      if (!isRefresh && p === 1) {
        setModal({ title: 'Error', message: e.message || 'Failed to load history' });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn()) {
        setIsUserLoggedIn(false);
        setLoading(false);
      } else {
        setIsUserLoggedIn(true);
        fetchData(1, true);
      }
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchData(1, true);
  };

  const onLoadMore = () => {
    if (!loadingMore && hasMore && !loading && !refreshing) {
      setLoadingMore(true);
      fetchData(page + 1);
    }
  };

  const handleManualDishSelected = (dishDetail: any) => {
    setManualLogOpen(false);
    const manualFood = {
      ...dishDetail,
      serving_estimate_g: 250,
      confidence: 1.0,
      source: 'nutrition_db',
      verified: true,
    };
    navigation.navigate('MealDetail', {
      result: {
        foods: [manualFood],
      },
    });
  };

  // Group meals by day into sections
  const sections: MealSection[] = useMemo(() => {
    const groups: Record<string, { title: string; totalKcal: number; data: any[] }> = {};
    const todayStr = new Date().toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    meals.forEach((meal) => {
      const mealDate = new Date(meal.timestamp);
      const dateKey = mealDate.toDateString();
      let title = '';
      if (dateKey === todayStr) {
        title = 'Today';
      } else if (dateKey === yesterdayStr) {
        title = 'Yesterday';
      } else {
        title = mealDate.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
      }

      if (!groups[dateKey]) {
        groups[dateKey] = { title, totalKcal: 0, data: [] };
      }
      const cal = meal.totals_json?.calories ? Math.round(meal.totals_json.calories) : 0;
      groups[dateKey].totalKcal += cal;
      groups[dateKey].data.push(meal);
    });

    return Object.values(groups);
  }, [meals]);

  // Optimistic delete with Undo window
  const handleDeleteConfirm = (meal: any) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    setModal({
      title: 'Delete Meal',
      message: 'Are you sure you want to remove this meal from your history?',
      confirm: true,
      destructive: true,
      okLabel: 'Delete',
      cancelLabel: 'Cancel',
      onConfirm: () => {
        executeDeleteOptimistic(meal);
      },
    });
  };

  const executeDeleteOptimistic = (meal: any) => {
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timer);
      deleteMeal(pendingDeleteRef.current.id).catch(() => {});
      pendingDeleteRef.current = null;
    }

    setMeals((prev) => prev.filter((m) => m.id !== meal.id));

    const timer = setTimeout(async () => {
      try {
        await deleteMeal(meal.id);
      } catch (err: any) {
        console.warn('Failed to delete meal on server:', err);
      }
      pendingDeleteRef.current = null;
    }, 5000);

    pendingDeleteRef.current = { id: meal.id, item: meal, timer };
    setUndoSeconds(5);
    setToastMessage('Meal deleted');
  };

  const handleUndoDelete = () => {
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timer);
      const restored = pendingDeleteRef.current.item;
      setMeals((prev) =>
        [restored, ...prev].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
      );
      pendingDeleteRef.current = null;
      setUndoSeconds(0);
      setToastMessage('Meal restored');
      setTimeout(() => setToastMessage(null), 2000);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    }
  };

  // Render Section Header
  const renderSectionHeader = useCallback(
    ({ section: { title, totalKcal } }: { section: MealSection }) => (
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionKcalPill}>
          <Ionicons name="flame-outline" size={12} color={colors.textSecondary} />
          <Text style={styles.sectionKcalTotal}>{totalKcal} kcal</Text>
        </View>
      </View>
    ),
    []
  );

  // Render Meal Item
  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <MealCard
        meal={item}
        onOpen={() => navigation.navigate('MealDetail', { meal: item })}
        onDelete={() => handleDeleteConfirm(item)}
      />
    ),
    [navigation]
  );

  // Render Empty Component
  const renderEmpty = useMemo(
    () => (
      <FadeInView style={styles.emptyContainer}>
        <IconBubble name="journal-outline" size={72} />
        <Text style={styles.emptyTitle}>No meals logged yet</Text>
        <Text style={styles.emptyBody}>
          Scan your first dish or search the food catalog to start tracking your daily nutrition.
        </Text>
        <View style={styles.emptyBtnRow}>
          <PressableScale
            style={styles.emptyBtn}
            onPress={() => navigation.navigate('ScanTab')}
          >
            <Ionicons name="camera" size={17} color={colors.textOnDark} />
            <Text style={styles.emptyBtnText}>Scan a meal</Text>
          </PressableScale>
          <PressableScale
            style={styles.emptySecondaryBtn}
            onPress={() => setManualLogOpen(true)}
          >
            <Ionicons name="search" size={16} color={colors.textPrimary} />
            <Text style={styles.emptySecondaryBtnText}>Search</Text>
          </PressableScale>
        </View>
      </FadeInView>
    ),
    [navigation]
  );

  // Render Footer Component
  const renderFooter = useMemo(
    () =>
      loadingMore ? (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : (
        <View style={{ height: spacing.xxl }} />
      ),
    [loadingMore]
  );

  // --- Logged-out Screen ---
  if (!isUserLoggedIn) {
    return (
      <View style={[styles.loggedOutCenter, { paddingTop: insets.top }]}>
        <FadeInView style={{ alignItems: 'center' }}>
          <IconBubble name="time-outline" size={80} />
          <Text style={styles.loggedOutTitle}>Meal history</Text>
          <Text style={styles.loggedOutBody}>
            Log in or create an account to view and manage your saved meals and nutritional logs.
          </Text>
          <PressableScale
            style={styles.loggedOutBtn}
            onPress={() => navigation.navigate('Profile')}
          >
            <Ionicons name="log-in-outline" size={18} color={colors.textOnDark} />
            <Text style={styles.loggedOutBtnText}>Log in</Text>
          </PressableScale>
        </FadeInView>
      </View>
    );
  }

  // --- Loading Screen ---
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>History</Text>
          <Text style={styles.hintBannerText}>Tap to view or edit · swipe left to delete</Text>
        </View>
        <PressableScale
          style={styles.manualAddPill}
          onPress={() => setManualLogOpen(true)}
          accessibilityLabel="Log food manually"
        >
          <Ionicons name="add" size={18} color={colors.textOnDark} />
          <Text style={styles.manualAddPillText}>Log food</Text>
        </PressableScale>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.xxl }}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
      />

      {/* Floating Undo Toast */}
      <Toast
        message={toastMessage}
        icon={undoSeconds > 0 ? 'trash-outline' : 'checkmark-circle'}
        actionLabel={undoSeconds > 0 ? `Undo (${undoSeconds}s)` : undefined}
        onAction={undoSeconds > 0 ? handleUndoDelete : undefined}
      />

      <DishCorrectionModal
        visible={manualLogOpen}
        title="Log Food Manually"
        subtitle="Select a dish to customize portion & save"
        onSelect={handleManualDishSelected}
        onClose={() => setManualLogOpen(false)}
      />

      <AppModal state={modal} onClose={() => setModal(null)} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Swipeable Meal Card
// ---------------------------------------------------------------------------
function MealCard({
  meal,
  onOpen,
  onDelete,
}: {
  meal: any;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const foods = meal.foods_json || [];
  const time = new Date(meal.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const totalCal = meal.totals_json?.calories ? Math.round(meal.totals_json.calories) : 0;

  const renderRightActions = () => (
    <Pressable
      style={({ pressed }) => [styles.deleteAction, pressed && { opacity: 0.85 }]}
      onPress={onDelete}
      accessibilityRole="button"
      accessibilityLabel="Delete meal"
    >
      <Ionicons name="trash-outline" size={22} color={colors.textOnDark} />
      <Text style={styles.deleteActionText}>Delete</Text>
    </Pressable>
  );

  return (
    <Swipeable renderRightActions={renderRightActions} overshootRight={false} friction={1.6}>
      <PressableScale
        style={styles.card}
        onPress={onOpen}
        onLongPress={onDelete}
        scaleTo={0.98}
      >
        <View style={styles.mealHeader}>
          <IconBubble name={mealTypeIcon(meal.meal_type)} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.mealType}>{formatMealType(meal.meal_type)}</Text>
            <Text style={styles.mealTime}>{time}</Text>
          </View>
          <Text style={styles.mealCal}>
            {totalCal}
            <Text style={styles.mealCalUnit}> kcal</Text>
          </Text>
        </View>

        {foods.slice(0, 3).map((f: any, i: number) => (
          <View key={i} style={styles.mealFoodRow}>
            <View style={[styles.mealFoodDot, { backgroundColor: getHealthColor(f.health_label) }]} />
            <Text style={styles.mealFoodName} numberOfLines={1}>
              {f.name}
            </Text>
            <Text style={[styles.mealFoodScore, { color: getHealthColor(f.health_label) }]}>
              {f.health_score}
            </Text>
          </View>
        ))}

        {foods.length > 3 && (
          <Text style={styles.moreText}>+{foods.length - 3} more dishes</Text>
        )}
      </PressableScale>
    </Swipeable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  headerTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  hintBannerText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  manualAddPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.ink,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 16,
    borderRadius: radii.pill,
    marginLeft: spacing.sm,
  },
  manualAddPillText: {
    color: colors.textOnDark,
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  sectionKcalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  sectionKcalTotal: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.sm + 4,
    ...shadows.card,
  },
  mealHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  mealType: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  mealTime: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 1,
  },
  mealCal: {
    fontSize: 18,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  mealCalUnit: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  mealFoodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm + 2,
    marginTop: 4,
    backgroundColor: colors.background,
    borderRadius: radii.sm + 2,
  },
  mealFoodDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  mealFoodName: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.textPrimary,
    flex: 1,
  },
  mealFoodScore: {
    fontSize: 14,
    fontFamily: fonts.display,
    marginLeft: spacing.sm,
  },
  moreText: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
    marginTop: 6,
    marginLeft: 2,
  },
  deleteAction: {
    backgroundColor: colors.limit,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    width: 88,
    marginBottom: spacing.sm + 4,
    borderRadius: radii.card,
    marginLeft: spacing.sm,
  },
  deleteActionText: {
    color: colors.textOnDark,
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
  },
  footerLoader: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  emptyBtnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.ink,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
  },
  emptyBtnText: {
    color: colors.textOnDark,
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
  },
  emptySecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    ...shadows.card,
  },
  emptySecondaryBtnText: {
    color: colors.textPrimary,
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
  },

  // Logged-out State
  loggedOutCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  loggedOutTitle: {
    fontSize: 24,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  loggedOutBody: {
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
    maxWidth: 320,
  },
  loggedOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.ink,
    paddingVertical: 15,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.button,
  },
  loggedOutBtnText: {
    color: colors.textOnDark,
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
  },
});
