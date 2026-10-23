/**
 * HomeScreen — Dashboard landing page.
 *
 * Features:
 *   • Skeleton loading placeholders with Animated opacity pulse.
 *   • Hero calorie ring (target − eaten) with animated sweep.
 *   • Today's Macros (Protein, Carbs, Fat) with animated bars + Daily Guardrails (Fiber, Sugar, Sodium).
 *   • Quick Scan Card with both "Scan food" and "Search" manual logging (Part 4.1).
 *   • 7-day bar chart with local-timezone YYYY-MM-DD weekday parsing (Part 1.6); today highlighted.
 *   • Tappable Recent Meals with meal category icons.
 *   • Staggered fade-in of sections.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Animated,
  Easing,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  spacing,
  radii,
  fonts,
  shadows,
  macroColors,
} from '../theme/tokens';
import * as api from '../services/api';
import DishCorrectionModal from '../components/DishCorrectionModal';
import CalorieRing from '../components/CalorieRing';
import {
  AnimatedBar,
  FadeInView,
  IconBubble,
  IconName,
  PressableScale,
  mealTypeIcon,
} from '../components/ui';

function formatLocalWeekday(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    const localDate = new Date(parts[0], parts[1] - 1, parts[2]);
    return localDate.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(dateStr).toLocaleDateString(undefined, { weekday: 'short' });
}

function isLocalToday(dateStr: string): boolean {
  const parts = (dateStr || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  const now = new Date();
  return (
    parts[0] === now.getFullYear() && parts[1] === now.getMonth() + 1 && parts[2] === now.getDate()
  );
}

function formatMealTypeBadge(mealType?: string): string {
  if (!mealType) return 'Meal';
  return mealType.charAt(0).toUpperCase() + mealType.slice(1);
}

export default function HomeScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
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

  const contentPadding = {
    paddingHorizontal: spacing.md,
    paddingTop: insets.top + spacing.md,
    paddingBottom: spacing.xxl,
  };

  if (loading) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={contentPadding}>
        <View style={styles.skeletonHeader}>
          <SkeletonPulse style={{ width: 120, height: 14, marginBottom: 10, borderRadius: 6 }} />
          <SkeletonPulse style={{ width: 220, height: 30, marginBottom: 24, borderRadius: 8 }} />
        </View>
        <SkeletonCard height={190} />
        <SkeletonCard height={150} />
        <SkeletonCard height={120} />
      </ScrollView>
    );
  }

  // Calculate calories remaining
  const eatenCalories = Math.round(summary?.totals?.calories || 0);
  const targetCalories = summary?.targets?.calories || 2000;
  const remainingCalories = targetCalories - eatenCalories;
  const isOverTarget = remainingCalories < 0;
  const calorieRatio = targetCalories > 0 ? eatenCalories / targetCalories : 0;
  const ringColor = isOverTarget
    ? colors.limit
    : calorieRatio > 0.9
    ? colors.moderate
    : colors.accent;

  // Chart data calculation
  const chartDays = weeklyReport?.daily_data || [];
  const chartValues: number[] = chartDays.map((d: any) => Math.round(d.totals?.calories || 0));
  const hasChartData = chartValues.some((v: number) => v > 0);

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={contentPadding}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressViewOffset={insets.top}
            onRefresh={() => {
              setRefreshing(true);
              loadData(true);
            }}
          />
        }
      >
        {/* 1. Greeting & Date Header */}
        <FadeInView style={styles.headerBlock}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateText}>{dateFormatted}</Text>
            <Text style={styles.greeting}>{greeting}</Text>
          </View>
          <PressableScale
            style={styles.avatarBtn}
            onPress={() => navigation.navigate('Profile')}
            scaleTo={0.9}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
          >
            <Ionicons name="person" size={20} color={colors.accent} />
          </PressableScale>
        </FadeInView>

        {/* 2. Hero Calories Remaining Card (if logged in) */}
        {loggedIn && summary && (
          <FadeInView delay={60} style={styles.card}>
            <View style={styles.heroRow}>
              <CalorieRing ratio={calorieRatio} color={ringColor} size={150} strokeWidth={13}>
                <Text
                  style={[styles.ringNumber, isOverTarget && { color: colors.limit }]}
                  maxFontSizeMultiplier={1.2}
                >
                  {Math.abs(remainingCalories)}
                </Text>
                <Text style={styles.ringCaption}>{isOverTarget ? 'kcal over' : 'kcal left'}</Text>
              </CalorieRing>

              <View style={styles.heroStats}>
                <HeroStat icon="flag-outline" label="Daily goal" value={`${targetCalories}`} />
                <HeroStat icon="restaurant-outline" label="Eaten" value={`${eatenCalories}`} />
                <HeroStat
                  icon="fast-food-outline"
                  label="Meals today"
                  value={`${summary.meals_count || 0}`}
                  unit=""
                />
              </View>
            </View>
          </FadeInView>
        )}

        {/* 3. Daily Macros & Guardrails Card (if logged in) */}
        {loggedIn && summary && (
          <FadeInView delay={120} style={styles.card}>
            <Text style={styles.sectionLabel}>Today's macros</Text>
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

            {/* Micronutrients / Guardrails Row (Fiber, Sugar, Sodium) */}
            <View style={styles.microSummaryRow}>
              <MicroTile
                label="Fiber"
                value={Math.round(summary.totals?.fiber || 0)}
                target={summary.targets?.fiber || 28}
                unit="g"
              />
              <MicroTile
                label="Sugar"
                value={Math.round(summary.totals?.sugar || 0)}
                target={summary.targets?.sugar || 50}
                unit="g"
                warnWhenOver
              />
              <MicroTile
                label="Sodium"
                value={Math.round(summary.totals?.sodium_mg || 0)}
                target={summary.targets?.sodium_mg || 2300}
                unit="mg"
                warnWhenOver
              />
            </View>
          </FadeInView>
        )}

        {/* 4. Quick Scan & Manual Log Card */}
        <FadeInView delay={180} style={styles.scanCard}>
          <View style={styles.scanCardDecor} pointerEvents="none" />
          <View style={styles.scanCardTop}>
            <IconBubble name="sparkles" size={44} color="#BFE3BF" background="rgba(255,255,255,0.1)" />
            <View style={{ flex: 1 }}>
              <Text style={styles.scanCardTitle}>Log a meal</Text>
              <Text style={styles.scanCardBody}>
                Snap a photo for AI detection, or search the verified catalog.
              </Text>
            </View>
          </View>
          <View style={styles.scanBtnRow}>
            <PressableScale
              style={styles.scanBtn}
              onPress={() => navigation.navigate('ScanTab')}
            >
              <Ionicons name="camera" size={18} color={colors.ink} />
              <Text style={styles.scanBtnText}>Scan food</Text>
            </PressableScale>
            <PressableScale
              style={styles.manualLogBtn}
              onPress={() => setManualLogModalOpen(true)}
            >
              <Ionicons name="search" size={17} color={colors.textOnDark} />
              <Text style={styles.manualLogBtnText}>Search</Text>
            </PressableScale>
          </View>
        </FadeInView>

        {/* Not Logged In Promo Card */}
        {!loggedIn && (
          <FadeInView delay={240} style={styles.card}>
            <View style={styles.promoRow}>
              <IconBubble name="stats-chart" size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Track your nutrition</Text>
                <Text style={styles.cardBody}>
                  Create an account to save meals, get personalized daily targets, and see your
                  weekly trend.
                </Text>
              </View>
            </View>
            <PressableScale
              style={styles.outlineBtn}
              onPress={() => navigation.navigate('Profile')}
            >
              <Text style={styles.outlineBtnText}>Get started</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.textOnDark} />
            </PressableScale>
          </FadeInView>
        )}

        {/* 5. 7-Day Calorie Trend Chart (Logged in) */}
        {loggedIn && (
          <FadeInView delay={240} style={styles.card}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Last 7 days</Text>
              {hasChartData && (
                <Text style={styles.chartTargetLegend}>
                  Goal {targetCalories} kcal
                </Text>
              )}
            </View>
            {hasChartData ? (
              <WeekChart
                labels={chartDays.map((d: any) => formatLocalWeekday(d.date))}
                todayFlags={chartDays.map((d: any) => isLocalToday(d.date))}
                values={chartValues}
                target={targetCalories}
              />
            ) : (
              <View style={styles.chartEmptyBox}>
                <IconBubble name="bar-chart-outline" size={44} color={colors.textSecondary} background={colors.surfaceMuted} />
                <Text style={styles.chartEmptyText}>No meals this week yet</Text>
                <Text style={styles.chartEmptySub}>
                  Scan or log meals to build your weekly trend.
                </Text>
              </View>
            )}
          </FadeInView>
        )}

        {/* 6. Recent Meals */}
        {recentMeals.length > 0 && (
          <FadeInView delay={300} style={{ marginTop: spacing.xs }}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeading}>Recent meals</Text>
              <PressableScale
                onPress={() => navigation.navigate('History')}
                style={styles.seeAllBtn}
                hitSlop={8}
              >
                <Text style={styles.seeAll}>See all</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.accent} />
              </PressableScale>
            </View>
            <View style={styles.listCard}>
              {recentMeals.map((meal: any, i: number) => (
                <RecentMealRow
                  key={meal.id}
                  meal={meal}
                  isLast={i === recentMeals.length - 1}
                  onPress={() =>
                    navigation.navigate('History', {
                      screen: 'MealDetail',
                      params: { meal },
                    })
                  }
                />
              ))}
            </View>
          </FadeInView>
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
// Hero stat row
// ---------------------------------------------------------------------------
function HeroStat({
  icon,
  label,
  value,
  unit = 'kcal',
}: {
  icon: IconName;
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <View style={styles.heroStat}>
      <IconBubble name={icon} size={32} color={colors.textSecondary} background={colors.surfaceMuted} />
      <View>
        <Text style={styles.heroStatLabel}>{label}</Text>
        <Text style={styles.heroStatValue}>
          {value}
          {unit ? <Text style={styles.heroStatUnit}> {unit}</Text> : null}
        </Text>
      </View>
    </View>
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
  const pct = Math.round(ratio * 100);

  let barColor = macroColors[type];
  if (type !== 'protein') {
    if (ratio > 1.1) {
      barColor = colors.limit;
    } else if (ratio > 1.0) {
      barColor = colors.moderate;
    }
  }

  return (
    <View style={styles.progressItem}>
      <View style={styles.progressTopRow}>
        <View style={styles.progressLabelRow}>
          <View style={[styles.progressDot, { backgroundColor: macroColors[type] }]} />
          <Text style={styles.progressLabel}>{label}</Text>
        </View>
        <Text style={styles.progressValue}>
          {current}
          <Text style={styles.progressTarget}>
            {' '}/ {target}
            {unit}
          </Text>
          {current > target ? (
            <Text style={[styles.progressTarget, { color: barColor }]}>  {pct}%</Text>
          ) : null}
        </Text>
      </View>
      <AnimatedBar ratio={ratio} color={barColor} height={8} />
    </View>
  );
}

function MicroTile({
  label,
  value,
  target,
  unit,
  warnWhenOver,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  warnWhenOver?: boolean;
}) {
  const over = warnWhenOver && value > target;
  return (
    <View style={[styles.microTile, over && { backgroundColor: colors.limitSoft }]}>
      <Text style={[styles.microSummaryLabel, over && { color: colors.limit }]}>{label}</Text>
      <Text style={[styles.microSummaryValue, over && { color: colors.limit }]} numberOfLines={1}>
        {value}
        <Text style={styles.microSummaryTarget}> {unit}</Text>
      </Text>
      <Text style={styles.microSummaryTarget} numberOfLines={1}>
        of {target}
        {unit}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 7-day bar chart (plain Views so bars can animate)
// ---------------------------------------------------------------------------
const CHART_HEIGHT = 130;

function WeekChart({
  labels,
  values,
  todayFlags,
  target,
}: {
  labels: string[];
  values: number[];
  todayFlags: boolean[];
  target: number;
}) {
  const max = Math.max(target, ...values, 1) * 1.1;
  const targetY = (target / max) * CHART_HEIGHT;

  return (
    <View style={styles.chartWrap}>
      <View style={[styles.chartTargetLine, { bottom: targetY + 18 }]} pointerEvents="none" />
      <View style={styles.chartBars}>
        {values.map((v, i) => (
          <ChartBar
            key={i}
            label={labels[i]}
            value={v}
            height={(v / max) * CHART_HEIGHT}
            highlight={todayFlags[i]}
            over={v > target}
            delay={i * 50}
          />
        ))}
      </View>
    </View>
  );
}

function ChartBar({
  label,
  value,
  height,
  highlight,
  over,
  delay,
}: {
  label: string;
  value: number;
  height: number;
  highlight: boolean;
  over: boolean;
  delay: number;
}) {
  const grow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(grow, {
      toValue: 1,
      duration: 600,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [grow, delay]);

  const barColor = over ? colors.moderate : highlight ? colors.accent : '#C9DCC5';

  return (
    <View style={styles.chartCol}>
      <Text style={[styles.chartValue, highlight && { color: colors.textPrimary }]} numberOfLines={1}>
        {value > 0 ? value : ''}
      </Text>
      <View style={styles.chartBarTrack}>
        <Animated.View
          style={{
            width: '100%',
            borderRadius: 8,
            backgroundColor: barColor,
            height: grow.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(value > 0 ? 6 : 0, height)] }),
          }}
        />
      </View>
      <Text style={[styles.chartLabel, highlight && styles.chartLabelToday]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Recent Meal Row Component
// ---------------------------------------------------------------------------
function RecentMealRow({
  meal,
  onPress,
  isLast,
}: {
  meal: any;
  onPress: () => void;
  isLast: boolean;
}) {
  const foods = meal.foods_json || [];
  const time = new Date(meal.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const totalCal = meal.totals_json?.calories ? Math.round(meal.totals_json.calories) : 0;
  const names = foods.map((f: any) => f.name).filter(Boolean);
  const title = names.length > 0 ? names.slice(0, 2).join(', ') : 'Meal';
  const extra = names.length > 2 ? ` +${names.length - 2}` : '';

  return (
    <PressableScale
      style={[styles.mealRow, !isLast && styles.mealRowDivider]}
      onPress={onPress}
      scaleTo={0.98}
    >
      <IconBubble name={mealTypeIcon(meal.meal_type)} size={42} />
      <View style={{ flex: 1 }}>
        <Text style={styles.mealTitle} numberOfLines={1}>
          {title}
          <Text style={styles.mealExtra}>{extra}</Text>
        </Text>
        <Text style={styles.mealSub}>
          {formatMealTypeBadge(meal.meal_type)} · {time}
        </Text>
      </View>
      <Text style={styles.mealCal}>
        {totalCal}
        <Text style={styles.mealCalUnit}> kcal</Text>
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------
// Skeleton Pulse Placeholder Components
// ---------------------------------------------------------------------------
function SkeletonPulse({ style }: { style: any }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
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
      <SkeletonPulse style={{ width: 100, height: 12, borderRadius: 6 }} />
      <SkeletonPulse style={{ width: '80%', height: 24, borderRadius: 8 }} />
      <SkeletonPulse style={{ width: '50%', height: 12, borderRadius: 6 }} />
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
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  dateText: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  greeting: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginTop: 2,
  },
  avatarBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonHeader: {
    marginBottom: spacing.md,
  },

  // Generic Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md + 4,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  cardBody: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  promoRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  outlineBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.ink,
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.textOnDark,
  },

  // Hero
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md + 4,
  },
  ringNumber: {
    fontSize: 34,
    lineHeight: 38,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  ringCaption: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  heroStats: {
    flex: 1,
    gap: spacing.md - 2,
  },
  heroStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  heroStatLabel: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  heroStatValue: {
    fontSize: 17,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  heroStatUnit: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },

  // Section labels
  sectionLabel: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.sm + 4,
  },
  sectionHeading: {
    fontSize: 18,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
  },
  seeAll: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: colors.accent,
  },

  // Macro progress
  progressItem: {
    marginBottom: spacing.md - 2,
  },
  progressTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  progressLabel: {
    fontSize: 14,
    fontFamily: fonts.bodyMedium,
    color: colors.textPrimary,
  },
  progressValue: {
    fontSize: 16,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  progressTarget: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  microSummaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  microTile: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.input,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  microSummaryLabel: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  microSummaryValue: {
    fontSize: 15,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginTop: 2,
  },
  microSummaryTarget: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },

  // Scan Card
  scanCard: {
    backgroundColor: colors.ink,
    borderRadius: radii.card + 4,
    padding: spacing.lg - 4,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...shadows.raised,
  },
  scanCardDecor: {
    position: 'absolute',
    right: -60,
    top: -60,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(62, 142, 67, 0.25)',
  },
  scanCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md + 4,
  },
  scanCardTitle: {
    fontSize: 20,
    fontFamily: fonts.display,
    color: colors.textOnDark,
  },
  scanCardBody: {
    fontSize: 13,
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 18,
    marginTop: 2,
  },
  scanBtnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  scanBtn: {
    flex: 1.4,
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtnText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.ink,
  },
  manualLogBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualLogBtnText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.textOnDark,
  },

  // Chart
  chartTargetLegend: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
    marginBottom: spacing.sm + 4,
  },
  chartWrap: {
    position: 'relative',
  },
  chartTargetLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  chartBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
  },
  chartCol: {
    flex: 1,
    alignItems: 'center',
  },
  chartValue: {
    fontSize: 10,
    fontFamily: fonts.bodyMedium,
    color: colors.textTertiary,
    marginBottom: 4,
  },
  chartBarTrack: {
    width: '70%',
    maxWidth: 28,
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
  },
  chartLabel: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
    marginTop: 6,
    height: 12,
    lineHeight: 12,
  },
  chartLabelToday: {
    fontFamily: fonts.bodySemiBold,
    color: colors.accent,
  },
  chartEmptyBox: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  chartEmptyText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
    marginTop: spacing.sm + 4,
  },
  chartEmptySub: {
    fontSize: 13,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 4,
  },

  // Recent meals
  listCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingVertical: spacing.md - 2,
  },
  mealRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  mealTitle: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  mealExtra: {
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  mealSub: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  mealCal: {
    fontSize: 16,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  mealCalUnit: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
});
