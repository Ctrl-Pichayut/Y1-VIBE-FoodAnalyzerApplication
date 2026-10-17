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
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radii, getHealthColor, fonts } from '../theme/tokens';
import { getHistory, deleteMeal, isLoggedIn } from '../services/api';
import AppModal, { ModalState } from '../components/AppModal';
import DishCorrectionModal from '../components/DishCorrectionModal';

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
        <Text style={styles.sectionKcalTotal}>{totalKcal} kcal</Text>
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
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No meals logged yet</Text>
        <Text style={styles.emptyBody}>
          Scan your first dish or search the food catalog to start tracking your daily nutrition.
        </Text>
        <View style={styles.emptyBtnRow}>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => navigation.navigate('ScanTab')}
            activeOpacity={0.8}
          >
            <Text style={styles.emptyBtnText}>Scan a Meal</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.emptySecondaryBtn}
            onPress={() => setManualLogOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.emptySecondaryBtnText}>Log Manually</Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [navigation]
  );

  // Render Footer Component
  const renderFooter = useMemo(
    () =>
      loadingMore ? (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.textPrimary} />
        </View>
      ) : (
        <View style={{ height: spacing.xxl }} />
      ),
    [loadingMore]
  );

  // --- Logged-out Screen ---
  if (!isUserLoggedIn) {
    return (
      <View style={styles.loggedOutCenter}>
        <Text style={styles.loggedOutTitle}>Meal History</Text>
        <Text style={styles.loggedOutBody}>
          Log in or create an account to view and manage your saved meals and nutritional logs.
        </Text>
        <TouchableOpacity
          style={styles.loggedOutBtn}
          onPress={() => navigation.navigate('Profile')}
          activeOpacity={0.8}
        >
          <Text style={styles.loggedOutBtnText}>Log In to Profile</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Loading Screen ---
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Action Bar */}
      <View style={styles.topActionBar}>
        <Text style={styles.hintBannerText}>
          Tap a meal to view or edit · Swipe left to delete
        </Text>
        <TouchableOpacity
          style={styles.manualAddPill}
          onPress={() => setManualLogOpen(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.manualAddPillText}>+ Log Food</Text>
        </TouchableOpacity>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.xxl }}
        stickySectionHeadersEnabled={false}
      />

      {/* Floating Undo Toast */}
      {toastMessage && (
        <View style={styles.toastFloating}>
          <Text style={styles.toastText}>{toastMessage}</Text>
          {undoSeconds > 0 && (
            <TouchableOpacity style={styles.toastUndoBtn} onPress={handleUndoDelete}>
              <Text style={styles.toastUndoText}>Undo ({undoSeconds}s)</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

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
    <TouchableOpacity style={styles.deleteAction} onPress={onDelete} activeOpacity={0.8}>
      <Text style={styles.deleteActionText}>Delete</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable renderRightActions={renderRightActions}>
      <TouchableOpacity
        style={styles.card}
        onPress={onOpen}
        onLongPress={onDelete}
        activeOpacity={0.7}
      >
        <View style={styles.mealHeader}>
          <View style={styles.mealTimeRow}>
            <Text style={styles.mealTime}>{time}</Text>
            {meal.meal_type && (
              <View style={styles.mealTypeBadge}>
                <Text style={styles.mealTypeBadgeText}>{formatMealType(meal.meal_type)}</Text>
              </View>
            )}
          </View>
          <Text style={styles.mealCal}>{totalCal} kcal</Text>
        </View>

        {foods.slice(0, 3).map((f: any, i: number) => (
          <View key={i} style={styles.mealFoodRow}>
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
      </TouchableOpacity>
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
  topActionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hintBannerText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    flex: 1,
  },
  manualAddPill: {
    backgroundColor: colors.textPrimary,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginLeft: spacing.sm,
  },
  manualAddPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  sectionKcalTotal: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  mealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  mealTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  mealTime: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  mealTypeBadge: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  mealTypeBadgeText: {
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  mealCal: {
    fontSize: 16,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  mealFoodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  mealFoodName: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.textPrimary,
    flex: 1,
  },
  mealFoodScore: {
    fontSize: 15,
    fontFamily: fonts.display,
    marginLeft: spacing.sm,
  },
  moreText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 4,
  },
  deleteAction: {
    backgroundColor: colors.limit,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginBottom: spacing.sm,
    borderRadius: radii.card,
    marginLeft: spacing.xs,
  },
  deleteActionText: {
    color: '#FFFFFF',
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
  },
  footerLoader: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: fonts.display,
    color: colors.textPrimary,
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
    backgroundColor: colors.textPrimary,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
  },
  emptyBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
  },
  emptySecondaryBtn: {
    borderWidth: 1,
    borderColor: colors.textPrimary,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
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
    marginBottom: spacing.sm,
  },
  loggedOutBody: {
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  loggedOutBtn: {
    backgroundColor: colors.textPrimary,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.button,
  },
  loggedOutBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
  },

  // Floating Toast
  toastFloating: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.textPrimary,
    borderRadius: radii.card,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: fonts.bodyMedium,
  },
  toastUndoBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.button,
  },
  toastUndoText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
  },
});
