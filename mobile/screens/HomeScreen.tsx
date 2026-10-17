/**
 * HomeScreen — Dashboard landing page.
 *
 * Features:
 *   • Skeleton loading placeholders with Animated opacity pulse.
 *   • Hero "Calories remaining" card (target − eaten) with Space Grotesk 48 number.
 *   • Today's Macros (Protein, Carbs, Fat) + Daily Guardrails (Fiber, Sugar, Sodium).
 *   • Quick Scan Card with both "Open Camera" and "Search & Log Manually" (Part 4.1).
 *   • 7-day chart with local-timezone YYYY-MM-DD weekday parsing (Part 1.6).
 *   • Tappable Recent Meals with meal category badges.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  Animated,
} from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radii, getHealthColor, fonts } from '../theme/tokens';
import * as api from '../services/api';
import DishCorrectionModal from '../components/DishCorrectionModal';

function formatLocalWeekday(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    const localDate = new Date(parts[0], parts[1] - 1, parts[2]);
    return localDate.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(dateStr).toLocaleDateString(undefined, { weekday: 'short' });
}

function formatMealTypeBadge(mealType?: string): string {
  if (!mealType) return 'Meal';
  return mealType.charAt(0).toUpperCase() + mealType.slice(1);
}

export default function HomeScreen({ navigation }: any) {
  const [summary, setSummary] = useState<any>(null);
  const [recentMeals, setRecentMeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState<any>(null);
  const [manualLogModalOpen, setManualLogModalOpen] = useState(false);

  const loadData = async (isRefresh = false) => {
    try {
      const [summaryRes, historyRes, reportRes] = await Promise.all([
        api.getDailySummary().catch(() => null),
        api.getHistory(1, 3).catch(() => null),
        api.getWeeklyReport().catch(() => null),
      ]);
      if (summaryRes) {
        setSummary(summaryRes);
        setLoggedIn(true);
      } else {
        setLoggedIn(api.isLoggedIn());
      }
      if (historyRes) {
        setRecentMeals(historyRes.meals || []);
      }
      if (reportRes) {
        setWeeklyReport(reportRes);
      }
    } catch {
      setLoggedIn(api.isLoggedIn());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const handleManualDishSelected = (dishDetail: any) => {
    setManualLogModalOpen(false);
    const manualFood = {
      ...dishDetail,
      serving_estimate_g: 250,
      confidence: 1.0,
      source: 'nutrition_db',
      verified: true,
    };
    navigation.navigate('ScanTab', {
      screen: 'Result',
      params: {
        result: {
          foods: [manualFood],
        },
      },
    });
  };

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateFormatted = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  if (loading) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
        <View style={styles.skeletonHeader}>
          <SkeletonPulse style={{ width: 120, height: 16, marginBottom: 8, borderRadius: 4 }} />
          <SkeletonPulse style={{ width: 220, height: 32, marginBottom: 24, borderRadius: 6 }} />
        </View>
        <SkeletonCard height={140} />
        <SkeletonCard height={160} />
        <SkeletonCard height={120} />
      </ScrollView>
    );
  }

  // Calculate calories remaining
  const eatenCalories = Math.round(summary?.totals?.calories || 0);
  const targetCalories = summary?.targets?.calories || 2000;
  const remainingCalories = targetCalories - eatenCalories;
  const isOverTarget = remainingCalories < 0;

  // Chart data calculation
  const chartDays = weeklyReport?.daily_data || [];
  const chartValues = chartDays.map((d: any) => d.totals?.calories || 0);
  const hasChartData = chartValues.some((v: number) => v > 0);

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData(true);
            }}
          />
        }
      >
        {/* 1. Greeting & Date Header */}
        <View style={styles.headerBlock}>
          <Text style={styles.appTitle}>Food Intelligence</Text>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.dateText}>{dateFormatted}</Text>
        </View>

        {/* 2. Hero Calories Remaining Card (if logged in) */}
        {loggedIn && summary && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Calories Remaining</Text>
            <View style={styles.calorieHeroRow}>
              <Text
                style={[
                  styles.calorieHeroNumber,
                  isOverTarget && { color: colors.limit },
                ]}
                maxFontSizeMultiplier={1.3}
              >
                {Math.abs(remainingCalories)}
              </Text>
              <View style={styles.calorieHeroSub}>
                <Text style={[styles.calorieHeroCaption, isOverTarget && { color: colors.limit }]}>
                  {isOverTarget
                    ? `kcal over goal (${targetCalories})`
                    : `kcal left of ${targetCalories}`}
                </Text>
                <Text style={styles.calorieEatenCaption}>
                  {eatenCalories} kcal eaten today
                </Text>
              </View>
            </View>

            {/* Thin full-width calorie progress bar */}
            <View style={styles.calorieProgressBg}>
              <View
                style={[
                  styles.calorieProgressFill,
                  {
                    width: `${Math.min(100, Math.round((eatenCalories / targetCalories) * 100))}%`,
                    backgroundColor: isOverTarget
                      ? colors.limit
                      : eatenCalories / targetCalories > 0.9
                      ? colors.moderate
                      : colors.accent,
                  },
                ]}
              />
            </View>
          </View>
        )}

        {/* 3. Daily Macros & Guardrails Card (if logged in) */}
        {loggedIn && summary && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Today's Macros</Text>
            <View style={styles.macroProgressGrid}>
              <ProgressItem
                label="Protein"
                current={Math.round(summary.totals?.protein || 0)}
                target={summary.targets?.protein || 50}
                unit="g"
                type="protein"
              />
              <ProgressItem
                label="Carbs"
                current={Math.round(summary.totals?.carbs || 0)}
                target={summary.targets?.carbs || 300}
                unit="g"
                type="carbs"
              />
              <ProgressItem
                label="Fat"
                current={Math.round(summary.totals?.fat || 0)}
                target={summary.targets?.fat || 65}
                unit="g"
                type="fat"
              />
            </View>

            {/* Micronutrients / Guardrails Row (Fiber, Sugar, Sodium) */}
            <View style={styles.microSummaryRow}>
              <View style={styles.microSummaryItem}>
                <Text style={styles.microSummaryLabel}>Fiber</Text>
                <Text style={styles.microSummaryValue}>
                  {Math.round(summary.totals?.fiber || 0)} / {summary.targets?.fiber || 28}g
                </Text>
              </View>
              <View style={styles.microSummaryItem}>
                <Text style={styles.microSummaryLabel}>Sugar</Text>
                <Text
                  style={[
                    styles.microSummaryValue,
                    (summary.totals?.sugar || 0) > (summary.targets?.sugar || 50) && {
                      color: colors.limit,
                    },
                  ]}
                >
                  {Math.round(summary.totals?.sugar || 0)} / {summary.targets?.sugar || 50}g
                </Text>
              </View>
              <View style={styles.microSummaryItem}>
                <Text style={styles.microSummaryLabel}>Sodium</Text>
                <Text
                  style={[
                    styles.microSummaryValue,
                    (summary.totals?.sodium_mg || 0) > (summary.targets?.sodium_mg || 2300) && {
                      color: colors.limit,
                    },
                  ]}
                >
                  {Math.round(summary.totals?.sodium_mg || 0)} / {summary.targets?.sodium_mg || 2300}mg
                </Text>
              </View>
            </View>

            <Text style={styles.mealsToday}>
              {summary.meals_count || 0} meal{(summary.meals_count || 0) !== 1 ? 's' : ''} logged today
            </Text>
          </View>
        )}

        {/* 4. Quick Scan & Manual Log Card */}
        <View style={styles.scanCard}>
          <Text style={styles.scanCardTitle}>Log a Meal</Text>
          <Text style={styles.scanCardBody}>
            Take a photo to detect dishes with AI, or search our verified food catalog to log manually.
          </Text>
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={() => navigation.navigate('ScanTab')}
            activeOpacity={0.85}
          >
            <Text style={styles.scanBtnText}>Open Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.manualLogBtn}
            onPress={() => setManualLogModalOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.manualLogBtnText}>Search & Log Manually</Text>
          </TouchableOpacity>
        </View>

        {/* Not Logged In Promo Card */}
        {!loggedIn && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Track Your Nutrition</Text>
            <Text style={styles.cardBody}>
              Create an account or log in to save your meals, configure personalized TDEE targets, and review your weekly trend.
            </Text>
            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={() => navigation.navigate('Profile')}
              activeOpacity={0.7}
            >
              <Text style={styles.outlineBtnText}>Get Started / Log In</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 5. 7-Day Calorie Trend Chart (Logged in) */}
        {loggedIn && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>7-Day Calorie Trend</Text>
            {hasChartData ? (
              <BarChart
                data={{
                  labels: chartDays.map((d: any) => formatLocalWeekday(d.date)),
                  datasets: [{ data: chartValues }],
                }}
                width={Dimensions.get('window').width - spacing.md * 4}
                height={200}
                yAxisLabel=""
                yAxisSuffix=""
                chartConfig={{
                  backgroundColor: colors.surface,
                  backgroundGradientFrom: colors.surface,
                  backgroundGradientTo: colors.surface,
                  decimalPlaces: 0,
                  color: (opacity = 1) => `rgba(13, 13, 13, ${opacity})`,
                  labelColor: () => colors.textSecondary,
                  barPercentage: 0.5,
                  propsForLabels: {
                    fontFamily: fonts.body,
                    fontSize: 10,
                  },
                }}
                style={{ marginVertical: 8, borderRadius: radii.card, marginLeft: -12 }}
                showValuesOnTopOfBars
              />
            ) : (
              <View style={styles.chartEmptyBox}>
                <Text style={styles.chartEmptyText}>
                  No calorie data recorded this week yet.
                </Text>
                <Text style={styles.chartEmptySub}>
                  Scan or log meals to build your weekly nutrition trend.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* 6. Recent Meals */}
        {recentMeals.length > 0 && (
          <View style={{ marginTop: spacing.xs }}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Recent Meals</Text>
              <TouchableOpacity onPress={() => navigation.navigate('History')} activeOpacity={0.7}>
                <Text style={styles.seeAll}>See All</Text>
              </TouchableOpacity>
            </View>
            {recentMeals.map((meal: any) => (
              <RecentMealCard
                key={meal.id}
                meal={meal}
                onPress={() =>
                  navigation.navigate('History', {
                    screen: 'MealDetail',
                    params: { meal },
                  })
                }
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Manual Food Search Modal */}
      <DishCorrectionModal
        visible={manualLogModalOpen}
        title="Log Food Manually"
        subtitle="Select a dish to customize portion & log"
        onSelect={handleManualDishSelected}
        onClose={() => setManualLogModalOpen(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Macro Progress Item Component
// ---------------------------------------------------------------------------
interface ProgressItemProps {
  label: string;
  current: number;
  target: number;
  unit: string;
  type: 'protein' | 'carbs' | 'fat';
}

function ProgressItem({ label, current, target, unit, type }: ProgressItemProps) {
  const ratio = target > 0 ? current / target : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const isOver = current > target;

  let barColor = colors.accent;
  if (type !== 'protein') {
    if (ratio > 1.1) {
      barColor = colors.limit;
    } else if (ratio > 1.0) {
      barColor = colors.moderate;
    } else {
      barColor = colors.accent;
    }
  }

  return (
    <View style={styles.progressItem}>
      <Text style={styles.progressValue}>{current}</Text>
      <Text style={styles.progressTarget}>
        / {target} {unit}
      </Text>

      {/* Progress Bar */}
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>

      <Text style={styles.progressLabel}>
        {label} {isOver && <Text style={{ color: barColor }}>({pct}%)</Text>}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Recent Meal Card Component
// ---------------------------------------------------------------------------
function RecentMealCard({ meal, onPress }: { meal: any; onPress: () => void }) {
  const foods = meal.foods_json || [];
  const time = new Date(meal.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const totalCal = meal.totals_json?.calories ? Math.round(meal.totals_json.calories) : 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.mealHeader}>
        <View style={styles.mealTimeRow}>
          <Text style={styles.mealTime}>{time}</Text>
          {meal.meal_type && (
            <View style={styles.mealTypeBadge}>
              <Text style={styles.mealTypeBadgeText}>{formatMealTypeBadge(meal.meal_type)}</Text>
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
        <Text style={styles.moreText}>+{foods.length - 3} more items</Text>
      )}
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Skeleton Pulse Placeholder Components
// ---------------------------------------------------------------------------
function SkeletonPulse({ style }: { style: any }) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.75, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[{ backgroundColor: colors.border }, style, { opacity }]} />;
}

function SkeletonCard({ height = 120 }: { height?: number }) {
  return (
    <View style={[styles.card, { height, justifyContent: 'space-around' }]}>
      <SkeletonPulse style={{ width: 100, height: 14, borderRadius: 4 }} />
      <SkeletonPulse style={{ width: '80%', height: 24, borderRadius: 6 }} />
      <SkeletonPulse style={{ width: '50%', height: 12, borderRadius: 4 }} />
    </View>
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
  headerBlock: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  appTitle: {
    fontSize: 28,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  greeting: {
    fontSize: 16,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dateText: {
    fontSize: 13,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  skeletonHeader: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },

  // Scan Card
  scanCard: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  scanCardTitle: {
    fontSize: 22,
    fontFamily: fonts.display,
    color: '#FFFFFF',
    marginBottom: spacing.xs,
  },
  scanCardBody: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  scanBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.button,
    paddingVertical: 12,
    alignItems: 'center',
  },
  scanBtnText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  manualLogBtn: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: radii.button,
    paddingVertical: 11,
    alignItems: 'center',
  },
  manualLogBtnText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: '#FFFFFF',
  },

  // Generic Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  cardBody: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: colors.textPrimary,
    borderRadius: radii.button,
    paddingVertical: 12,
    alignItems: 'center',
  },
  outlineBtnText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },

  // Hero Calorie Block
  sectionLabel: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  calorieHeroRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginVertical: spacing.xs,
  },
  calorieHeroNumber: {
    fontSize: 48,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    lineHeight: 52,
    marginRight: spacing.md,
  },
  calorieHeroSub: {
    flex: 1,
  },
  calorieHeroCaption: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  calorieEatenCaption: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  calorieProgressBg: {
    width: '100%',
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  calorieProgressFill: {
    height: '100%',
    borderRadius: 3,
  },

  // Macro Progress Grid
  macroProgressGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  progressItem: {
    alignItems: 'center',
    flex: 1,
  },
  progressValue: {
    fontSize: 22,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  progressTarget: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  progressBarBg: {
    width: '85%',
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginVertical: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    borderRadius: 2,
  },
  progressLabel: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  microSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  microSummaryItem: {
    alignItems: 'center',
  },
  microSummaryLabel: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  microSummaryValue: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
    marginTop: 2,
  },
  mealsToday: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs + 2,
  },

  // Chart Empty State
  chartEmptyBox: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  chartEmptyText: {
    fontSize: 14,
    fontFamily: fonts.bodyMedium,
    color: colors.textPrimary,
  },
  chartEmptySub: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 4,
  },

  // Section Header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  seeAll: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },

  // Meal Cards
  mealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  mealTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  mealTime: {
    fontSize: 15,
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
    paddingVertical: 4,
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
});
