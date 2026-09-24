/**
 * HomeScreen — Dashboard landing page.
 * Shows daily summary, quick scan button, and recent meals.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
  Dimensions
} from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radii, getHealthColor } from '../theme/tokens';
import * as api from '../services/api';

export default function HomeScreen({ navigation }: any) {
  const [summary, setSummary] = useState<any>(null);
  const [recentMeals, setRecentMeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState<any>(null);

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
      }
      if (historyRes) {
        setRecentMeals(historyRes.meals || []);
      }
      if (reportRes) {
        setWeeklyReport(reportRes);
      }
    } catch {
      // Not logged in — show default state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => {
    loadData();
  }, []));

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.textPrimary} /></View>;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(true); }} />}
    >
      {/* Greeting */}
      <Text style={styles.greeting}>{greeting}</Text>
      <Text style={styles.title}>Food Intelligence</Text>

      {/* Quick Scan Card */}
      <TouchableOpacity
        style={styles.scanCard}
        onPress={() => navigation.navigate('ScanTab')}
        activeOpacity={0.85}
      >
        <Text style={styles.scanCardTitle}>Scan Food</Text>
        <Text style={styles.scanCardBody}>
          Take a photo or pick from gallery to analyze nutritional content
        </Text>
        <View style={styles.scanBtn}>
          <Text style={styles.scanBtnText}>Open Camera</Text>
        </View>
      </TouchableOpacity>

      {/* Daily Progress */}
      {loggedIn && summary && (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Today's progress</Text>
          <View style={styles.progressGrid}>
            <ProgressItem
              label="Calories"
              current={Math.round(summary.totals?.calories || 0)}
              target={summary.targets?.calories || 2000}
              unit="kcal"
            />
            <ProgressItem
              label="Protein"
              current={Math.round(summary.totals?.protein || 0)}
              target={summary.targets?.protein || 50}
              unit="g"
            />
            <ProgressItem
              label="Carbs"
              current={Math.round(summary.totals?.carbs || 0)}
              target={summary.targets?.carbs || 300}
              unit="g"
            />
            <ProgressItem
              label="Fat"
              current={Math.round(summary.totals?.fat || 0)}
              target={summary.targets?.fat || 65}
              unit="g"
            />
          </View>
          <Text style={styles.mealsToday}>
            {summary.meals_count || 0} meal{(summary.meals_count || 0) !== 1 ? 's' : ''} logged today
          </Text>
        </View>
      )}

      {/* Not logged in prompt */}
      {!loggedIn && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Track Your Nutrition</Text>
          <Text style={styles.cardBody}>
            Create an account to save meal history, set daily goals, and track your progress over time.
          </Text>
          <TouchableOpacity
            style={styles.outlineBtn}
            onPress={() => navigation.navigate('Profile')}
          >
            <Text style={styles.outlineBtnText}>Get Started</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Recent Meals */}
      {recentMeals.length > 0 && (
        <View>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Recent meals</Text>
            <TouchableOpacity onPress={() => navigation.navigate('History')}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          </View>
          {recentMeals.map((meal: any) => (
            <RecentMealCard key={meal.id} meal={meal} />
          ))}
        </View>
      )}

      {/* Weekly Trend Chart */}
      {loggedIn && weeklyReport?.daily_data && (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>7-Day Calorie Trend</Text>
          <BarChart
            data={{
              labels: weeklyReport.daily_data.map((d: any) => new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })),
              datasets: [{ data: weeklyReport.daily_data.map((d: any) => d.totals?.calories || 0) }]
            }}
            width={Dimensions.get('window').width - spacing.md * 4}
            height={220}
            yAxisLabel=""
            yAxisSuffix=""
            chartConfig={{
              backgroundColor: colors.surface,
              backgroundGradientFrom: colors.surface,
              backgroundGradientTo: colors.surface,
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(13, 13, 13, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(107, 107, 107, ${opacity})`,
              barPercentage: 0.5,
              propsForLabels: { fontSize: 10 }
            }}
            style={{ marginVertical: 8, borderRadius: radii.card, marginLeft: -10 }}
            showValuesOnTopOfBars
          />
        </View>
      )}
    </ScrollView>
  );
}

function ProgressItem({ label, current, target, unit }: any) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const color = pct > 90 ? colors.error : pct > 60 ? colors.moderate : colors.accent;

  return (
    <View style={styles.progressItem}>
      <Text style={styles.progressValue}>{current}</Text>
      <Text style={styles.progressTarget}>/ {target} {unit}</Text>
      {/* Simple progress bar */}
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.progressLabel}>{label}</Text>
    </View>
  );
}

function RecentMealCard({ meal }: { meal: any }) {
  const foods = meal.foods_json || [];
  const time = new Date(meal.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const totalCal = meal.totals_json?.calories ? Math.round(meal.totals_json.calories) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.mealHeader}>
        <Text style={styles.mealTime}>{time}</Text>
        <Text style={styles.mealCal}>{totalCal} kcal</Text>
      </View>
      {foods.slice(0, 3).map((f: any, i: number) => (
        <View key={i} style={styles.mealFoodRow}>
          <Text style={styles.mealFoodName} numberOfLines={1}>{f.name}</Text>
          <Text style={[styles.mealFoodScore, { color: getHealthColor(f.health_label) }]}>
            {f.health_score}
          </Text>
        </View>
      ))}
      {foods.length > 3 && (
        <Text style={styles.moreText}>+{foods.length - 3} more</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  greeting: { fontSize: 15, color: colors.textSecondary, marginTop: spacing.md },
  title: { fontSize: 32, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },

  // Scan card
  scanCard: {
    backgroundColor: colors.textPrimary, borderRadius: radii.card,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  scanCardTitle: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginBottom: spacing.xs },
  scanCardBody: { fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 20, marginBottom: spacing.md },
  scanBtn: {
    backgroundColor: '#FFFFFF', borderRadius: radii.button,
    paddingVertical: 12, alignItems: 'center',
  },
  scanBtnText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },

  // Cards
  card: {
    backgroundColor: colors.surface, borderRadius: radii.card,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  cardBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  outlineBtn: {
    borderWidth: 1, borderColor: colors.textPrimary, borderRadius: radii.button,
    paddingVertical: 12, alignItems: 'center',
  },
  outlineBtnText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },

  // Section
  sectionLabel: {
    fontSize: 13, fontWeight: '600', color: colors.textSecondary,
    letterSpacing: 0.3, marginBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: spacing.sm,
  },
  seeAll: { fontSize: 13, fontWeight: '600', color: colors.accent },

  // Progress
  progressGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  progressItem: { alignItems: 'center', flex: 1 },
  progressValue: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  progressTarget: { fontSize: 11, color: colors.textSecondary, marginBottom: 4 },
  progressBarBg: {
    width: '80%', height: 4, backgroundColor: colors.border,
    borderRadius: 2, marginVertical: 4,
  },
  progressBarFill: { height: 4, borderRadius: 2 },
  progressLabel: { fontSize: 12, color: colors.textSecondary },
  mealsToday: {
    fontSize: 13, color: colors.textSecondary,
    textAlign: 'center', marginTop: spacing.md,
  },

  // Stats
  statRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  statLabel: { fontSize: 14, color: colors.textSecondary },
  statValue: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },

  // Meal cards
  mealHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  mealTime: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  mealCal: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  mealFoodRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border,
  },
  mealFoodName: { fontSize: 14, color: colors.textPrimary, flex: 1 },
  mealFoodScore: { fontSize: 15, fontWeight: '700', marginLeft: spacing.sm },
  moreText: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
});
