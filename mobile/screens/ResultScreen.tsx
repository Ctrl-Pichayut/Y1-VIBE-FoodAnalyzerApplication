/**
 * ResultScreen — Displays detected foods with nutrition cards + health scores.
 *
 * Two modes, selected by route params:
 *   • Scan mode   : { result, imageUri }  — fresh from ScanScreen. Shows the
 *                   Save button (reflecting auto-save state) + "Scan Another".
 *   • Detail mode : { meal }              — opened from History (read-only).
 *                   Reuses the same layout; no save/camera actions.
 *
 * Minimalist design: large typographic numbers, no gauges, no icons.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Image,
} from 'react-native';
import { colors, spacing, radii, getHealthColor } from '../theme/tokens';
import * as api from '../services/api';

export default function ResultScreen({ route, navigation }: any) {
  const { result, imageUri, meal } = route.params || {};

  // Detail mode = opened from history (saved meal, read-only)
  const isDetailView = !!meal;

  // Normalize food list: saved meals carry foods_json, scans carry result.foods
  const foods = (isDetailView ? meal.foods_json : result?.foods) || [];
  // Saved meals already have server-side totals; scans compute them on the fly
  const savedTotals = isDetailView ? meal.totals_json : null;

  // --- Save state ----------------------------------------------------------
  const loggedIn = api.isLoggedIn();
  const [saved, setSaved] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const t = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, sodium_mg: 0 };
      foods.forEach((f: any) => {
        const p = f.per_100g || {};
        const mult = (f.serving_estimate_g || 250) / 100;
        t.calories += (p.calories || 0) * mult;
        t.protein += (p.protein || 0) * mult;
        t.fat += (p.fat || 0) * mult;
        t.carbs += (p.carbs || 0) * mult;
        t.fiber += (p.fiber || 0) * mult;
        t.sugar += (p.sugar || 0) * mult;
        t.sodium_mg += (p.sodium_mg || 0) * mult;
      });
      const roundedTotals = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)]));

      await api.logMeal(foods, roundedTotals);
      setSaved(true);
      showToast('Meal saved to history');
    } catch (e: any) {
      showToast(e.message || 'Failed to save meal');
    } finally {
      setSaving(false);
    }
  };

  // Header copy varies by mode
  const title = isDetailView ? 'Meal Detail' : 'Analysis';
  const subtitle = isDetailView
    ? new Date(meal.timestamp).toLocaleString()
    : `${foods.length} food${foods.length !== 1 ? 's' : ''} detected`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl + 40 }}>
      {/* Header */}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      {!isDetailView && imageUri && (
        <Image source={{ uri: imageUri }} style={styles.heroImage} />
      )}

      {/* Food Cards */}
      {foods.map((food: any, index: number) => (
        <FoodCard key={index} food={food} />
      ))}

      {foods.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No food detected</Text>
          <Text style={styles.emptyBody}>
            Try taking a clearer photo with better lighting.
          </Text>
        </View>
      )}

      {/* Totals */}
      {foods.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Meal totals</Text>
          <TotalsRow foods={foods} savedTotals={savedTotals} />
        </View>
      )}

      {/* Actions — scan mode only */}
      {!isDetailView && (
        <>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => navigation.navigate('ScanCamera')}
          >
            <Text style={styles.btnPrimaryText}>Scan Another</Text>
          </TouchableOpacity>

          {foods.length > 0 && <SaveButton
            loggedIn={loggedIn}
            saved={saved}
            saving={saving}
            onSave={handleSave}
            onLogIn={() => navigation.navigate('Profile')}
          />}
        </>
      )}

      {/* Toast */}
      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </ScrollView>
  );
}

/**
 * Save button — allows the user to manually save a scanned meal to history.
 */
function SaveButton({ loggedIn, saved, saving, onSave, onLogIn }: {
  loggedIn: boolean;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  onLogIn: () => void;
}) {
  if (!loggedIn) {
    return (
      <TouchableOpacity style={styles.btnSave} onPress={onLogIn}>
        <Text style={styles.btnSaveText}>Log in to save</Text>
      </TouchableOpacity>
    );
  }

  if (saved) {
    return (
      <View style={[styles.btnSave, styles.btnSaveDone]}>
        <Text style={styles.btnSaveText}>Saved to history</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity style={styles.btnSave} onPress={onSave} disabled={saving}>
      <Text style={styles.btnSaveText}>{saving ? 'Saving...' : 'Save to history'}</Text>
    </TouchableOpacity>
  );
}

function FoodCard({ food }: { food: any }) {
  const healthColor = getHealthColor(food.health_label);
  const p = food.per_100g || {};

  return (
    <View style={styles.card}>
      {/* Name + confidence */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.foodName}>{food.name}</Text>
          <Text style={styles.confidence}>
            {Math.round(food.confidence * 100)}% confidence  ·  ~{food.serving_estimate_g}g
          </Text>
        </View>
        {/* Health score as large number */}
        <View style={styles.scoreBlock}>
          <Text style={[styles.scoreNumber, { color: healthColor }]}>
            {food.health_score}
          </Text>
          <Text style={[styles.scoreLabel, { color: healthColor }]}>
            {food.health_label}
          </Text>
        </View>
      </View>

      {/* Macros grid */}
      <View style={styles.macroGrid}>
        <MacroItem label="Cal" value={p.calories} unit="kcal" />
        <MacroItem label="Protein" value={p.protein} unit="g" />
        <MacroItem label="Fat" value={p.fat} unit="g" />
        <MacroItem label="Carbs" value={p.carbs} unit="g" />
        <MacroItem label="Fiber" value={p.fiber} unit="g" />
        <MacroItem label="Sugar" value={p.sugar} unit="g" />
      </View>

      {/* Tags */}
      {food.tags?.length > 0 && (
        <View style={styles.tagRow}>
          {food.tags.map((tag: string, i: number) => (
            <View key={i} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Allergens */}
      {food.allergens?.length > 0 && (
        <View style={styles.allergenRow}>
          <Text style={styles.allergenLabel}>Allergens: </Text>
          <Text style={styles.allergenText}>{food.allergens.join(', ')}</Text>
        </View>
      )}

      {/* GI */}
      <Text style={styles.giText}>Glycemic Index: {food.glycemic_index}</Text>
    </View>
  );
}

function MacroItem({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <View style={styles.macroItem}>
      <Text style={styles.macroValue}>{value ?? 0}</Text>
      <Text style={styles.macroUnit}>{unit}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

function TotalsRow({ foods, savedTotals }: { foods: any[]; savedTotals: any }) {
  // Prefer server-computed totals (saved meals). Fall back to client estimate.
  const totals = savedTotals || (() => {
    const t = { calories: 0, protein: 0, fat: 0, carbs: 0 };
    foods.forEach((f: any) => {
      const p = f.per_100g || {};
      const mult = (f.serving_estimate_g || 250) / 100;
      t.calories += (p.calories || 0) * mult;
      t.protein += (p.protein || 0) * mult;
      t.fat += (p.fat || 0) * mult;
      t.carbs += (p.carbs || 0) * mult;
    });
    return t;
  })();

  return (
    <View style={styles.macroGrid}>
      <MacroItem label="Cal" value={Math.round(totals.calories)} unit="kcal" />
      <MacroItem label="Protein" value={Math.round(totals.protein)} unit="g" />
      <MacroItem label="Fat" value={Math.round(totals.fat)} unit="g" />
      <MacroItem label="Carbs" value={Math.round(totals.carbs)} unit="g" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 32, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.md },
  subtitle: { fontSize: 15, color: colors.textSecondary, marginBottom: spacing.md },
  heroImage: {
    width: '100%', height: 200, borderRadius: radii.card,
    marginBottom: spacing.lg, backgroundColor: colors.border,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.card,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  foodName: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  confidence: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  scoreBlock: { alignItems: 'center', minWidth: 60 },
  scoreNumber: { fontSize: 36, fontWeight: '700' },
  scoreLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  macroItem: { width: '33%', alignItems: 'center', marginBottom: spacing.md },
  macroValue: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  macroUnit: { fontSize: 11, color: colors.textSecondary },
  macroLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  tag: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 4,
    paddingHorizontal: 8, paddingVertical: 3, marginRight: 6, marginBottom: 4,
  },
  tagText: { fontSize: 11, color: colors.textSecondary },
  allergenRow: { flexDirection: 'row', marginTop: spacing.sm },
  allergenLabel: { fontSize: 13, fontWeight: '600', color: colors.error },
  allergenText: { fontSize: 13, color: colors.error },
  giText: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.sm },
  sectionLabel: {
    fontSize: 13, fontWeight: '600', color: colors.textSecondary,
    letterSpacing: 0.3, marginBottom: spacing.sm,
  },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  emptyBody: { fontSize: 15, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },
  btnPrimary: {
    backgroundColor: colors.textPrimary, borderRadius: radii.button,
    paddingVertical: 16, alignItems: 'center', marginTop: spacing.sm,
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  // Save button sits below "Scan Another"
  btnSave: {
    backgroundColor: colors.surface, borderRadius: radii.button,
    borderWidth: 1, borderColor: colors.textPrimary,
    paddingVertical: 16, alignItems: 'center', marginTop: spacing.sm,
  },
  btnSaveText: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  // Already-saved (disabled confirmation) state — muted to read as "done"
  btnSaveDone: {
    backgroundColor: colors.border, borderColor: colors.border,
  },
  // Lightweight inline toast (no extra deps, matches minimalist aesthetic)
  toast: {
    position: 'absolute', bottom: spacing.lg, left: spacing.md, right: spacing.md,
    backgroundColor: colors.textPrimary, borderRadius: radii.button,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md,
    alignSelf: 'center',
  },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
