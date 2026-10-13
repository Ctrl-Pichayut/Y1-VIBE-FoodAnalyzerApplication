/**
 * ResultScreen — Displays detected foods with nutrition cards + health scores.
 * Phase 3: Correct, Adjust, Trust
 *
 * Features:
 *   • Multi-dish portion control per card: stepper (− / + step 25g, min 25g)
 *     and quick chips (Small 150g / Regular 250g / Large 350g).
 *   • Live recalculation of per-serving macros and meal totals.
 *   • Trust badges ("Verified" vs "AI estimate") and low-confidence warning.
 *   • "Wrong dish?" modal with real-time search over api.getFoods() + remove dish option.
 *   • Bounding box overlay on hero image scaled to rendered size, tapping box scrolls to card.
 *   • Sticky bottom bar: [Scan another] [Save meal · X kcal] (no auto-save on mount).
 *   • Floating 5-second Undo toast on meal save.
 *   • Totals card: large calorie number + P/C/F kcal ratio stacked bar + gram labels.
 *   • Read-only detail mode preserved for history viewing.
 */
import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Image, TextInput, Modal,
  ActivityIndicator, LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radii, getHealthColor, fonts, typography } from '../theme/tokens';
import * as api from '../services/api';

// In-memory cache for GET /api/v1/foods list
let cachedFoodsDb: any[] | null = null;

export default function ResultScreen({ route, navigation }: any) {
  const { result, imageUri, meal } = route.params || {};
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const cardOffsets = useRef<Record<number, number>>({});

  // Detail mode = opened from history (saved meal, read-only)
  const isDetailView = !!meal;

  // Initial foods from route params
  const initialFoods = useMemo(() => {
    return (isDetailView ? meal.foods_json : result?.foods) || [];
  }, [isDetailView, meal, result]);

  // Editable local state for foods in scan mode
  const [foodsList, setFoodsList] = useState<any[]>(initialFoods);

  // Per-card toggle: show per-serving (default) vs per-100g
  const [showPer100g, setShowPer100g] = useState<Record<number, boolean>>({});

  // Image dimensions for bbox scaling
  const [originalImgSize, setOriginalImgSize] = useState<{ width: number; height: number } | null>(null);
  const [renderedImgSize, setRenderedImgSize] = useState<{ width: number; height: number } | null>(null);

  // Save / Undo states
  const loggedIn = api.isLoggedIn();
  const [saved, setSaved] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedMealId, setSavedMealId] = useState<number | null>(null);
  const [undoSeconds, setUndoSeconds] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Wrong dish search modal state
  const [correctingIndex, setCorrectingIndex] = useState<number | null>(null);

  // Measure original image size for bounding box scaling
  useEffect(() => {
    if (imageUri) {
      Image.getSize(
        imageUri,
        (width, height) => setOriginalImgSize({ width, height }),
        () => setOriginalImgSize(null)
      );
    }
  }, [imageUri]);

  // Undo countdown timer
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (undoSeconds > 0) {
      interval = setInterval(() => {
        setUndoSeconds((sec) => {
          if (sec <= 1) {
            setToastMessage(null);
            return 0;
          }
          return sec - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [undoSeconds]);

  // Live computed meal totals based on edited foods & portion sizes
  const computedTotals = useMemo(() => {
    if (isDetailView && meal?.totals_json) {
      return meal.totals_json;
    }
    const t = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, sodium_mg: 0 };
    foodsList.forEach((f: any) => {
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
    return {
      calories: Math.round(t.calories),
      protein: Math.round(t.protein),
      fat: Math.round(t.fat),
      carbs: Math.round(t.carbs),
      fiber: Math.round(t.fiber),
      sugar: Math.round(t.sugar),
      sodium_mg: Math.round(t.sodium_mg),
    };
  }, [isDetailView, meal, foodsList]);

  // Portion control handlers
  const handleUpdatePortion = (index: number, newGrams: number) => {
    if (newGrams < 25) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setFoodsList((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], serving_estimate_g: newGrams };
      return updated;
    });
  };

  const handleTogglePer100g = (index: number) => {
    setShowPer100g((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleReplaceDish = (index: number, newDishData: any) => {
    setFoodsList((prev) => {
      const updated = [...prev];
      const currentServing = updated[index]?.serving_estimate_g || 250;
      updated[index] = {
        ...newDishData,
        serving_estimate_g: currentServing,
        confidence: 1.0,
        source: 'nutrition_db',
        verified: true,
      };
      return updated;
    });
    setCorrectingIndex(null);
  };

  const handleRemoveDish = (index: number) => {
    setFoodsList((prev) => prev.filter((_, i) => i !== index));
    setCorrectingIndex(null);
  };

  // Scroll to card when tapping bounding box on hero image
  const scrollToCard = (index: number) => {
    const y = cardOffsets.current[index];
    if (typeof y === 'number' && scrollViewRef.current) {
      scrollViewRef.current.scrollTo({ y: Math.max(0, y - 20), animated: true });
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
    }
  };

  // Save meal handler
  const handleSaveMeal = async () => {
    if (!loggedIn) {
      navigation.navigate('Profile');
      return;
    }
    if (saving || saved) return;

    setSaving(true);
    try {
      const res = await api.logMeal(foodsList, computedTotals);
      setSavedMealId(res.id);
      setSaved(true);
      setUndoSeconds(5);
      setToastMessage('Meal saved to history');
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } catch (e: any) {
      setToastMessage(e.message || 'Failed to save meal');
      setTimeout(() => setToastMessage(null), 3500);
    } finally {
      setSaving(false);
    }
  };

  // Undo save handler
  const handleUndoSave = async () => {
    if (!savedMealId) return;
    try {
      await api.deleteMeal(savedMealId);
      setSaved(false);
      setSavedMealId(null);
      setUndoSeconds(0);
      setToastMessage('Meal save undone');
      setTimeout(() => setToastMessage(null), 2500);
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
    } catch (e: any) {
      setToastMessage('Failed to undo: ' + e.message);
    }
  };

  const title = isDetailView ? 'Meal Detail' : 'Analysis';
  const subtitle = isDetailView
    ? new Date(meal.timestamp).toLocaleString()
    : `${foodsList.length} dish${foodsList.length !== 1 ? 'es' : ''} detected`;

  return (
    <View style={styles.screenWrapper}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.container}
        contentContainerStyle={{
          padding: spacing.md,
          paddingBottom: isDetailView ? spacing.xxl : 140,
        }}
      >
        {/* Screen Header */}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {/* Hero Image with Bounding Box Overlays */}
        {!isDetailView && imageUri && (
          <View
            style={styles.heroWrapper}
            onLayout={(e: LayoutChangeEvent) => {
              const { width, height } = e.nativeEvent.layout;
              setRenderedImgSize({ width, height });
            }}
          >
            <Image source={{ uri: imageUri }} style={styles.heroImage} />

            {originalImgSize && renderedImgSize && (
              foodsList.map((food, i) => {
                if (!food.bbox || food.bbox.length < 4) return null;
                const [x1, y1, x2, y2] = food.bbox;
                const scaleX = renderedImgSize.width / originalImgSize.width;
                const scaleY = renderedImgSize.height / originalImgSize.height;
                const left = x1 * scaleX;
                const top = y1 * scaleY;
                const width = Math.max(20, (x2 - x1) * scaleX);
                const height = Math.max(20, (y2 - y1) * scaleY);

                return (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.8}
                    onPress={() => scrollToCard(i)}
                    style={[styles.bboxBox, { left, top, width, height }]}
                  >
                    <View style={styles.bboxLabelWrap}>
                      <Text style={styles.bboxLabelText} numberOfLines={1}>
                        {food.name}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        {/* Food Cards */}
        {foodsList.map((food: any, index: number) => (
          <View
            key={index}
            onLayout={(e: LayoutChangeEvent) => {
              cardOffsets.current[index] = e.nativeEvent.layout.y;
            }}
          >
            <FoodCard
              food={food}
              index={index}
              isDetailView={isDetailView}
              showPer100g={!!showPer100g[index]}
              onTogglePer100g={() => handleTogglePer100g(index)}
              onUpdatePortion={(grams) => handleUpdatePortion(index, grams)}
              onOpenCorrection={() => setCorrectingIndex(index)}
            />
          </View>
        ))}

        {foodsList.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No food detected</Text>
            <Text style={styles.emptyBody}>
              Try taking a clearer photo with better lighting.
            </Text>
          </View>
        )}

        {/* Totals Card */}
        {foodsList.length > 0 && <TotalsCard totals={computedTotals} />}
      </ScrollView>

      {/* Sticky Bottom Bar for Scan Mode */}
      {!isDetailView && foodsList.length > 0 && (
        <View style={[styles.stickyBottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <TouchableOpacity
            style={styles.bottomSecondaryBtn}
            onPress={() => navigation.navigate('ScanCamera')}
            activeOpacity={0.7}
          >
            <Text style={styles.bottomSecondaryBtnText}>Scan Another</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomPrimaryBtn, saved && styles.bottomPrimaryBtnSaved]}
            onPress={handleSaveMeal}
            disabled={saving || saved}
            activeOpacity={0.8}
          >
            <Text style={styles.bottomPrimaryBtnText}>
              {saving
                ? 'Saving...'
                : saved
                ? '✓ Saved to History'
                : `Save Meal · ${computedTotals.calories} kcal`}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Floating Undo Toast */}
      {toastMessage && (
        <View style={[styles.toastFloating, { bottom: isDetailView ? spacing.xl : 96 }]}>
          <Text style={styles.toastText}>{toastMessage}</Text>
          {undoSeconds > 0 && (
            <TouchableOpacity style={styles.toastUndoBtn} onPress={handleUndoSave}>
              <Text style={styles.toastUndoText}>Undo ({undoSeconds}s)</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Wrong Dish Search Modal */}
      {correctingIndex !== null && (
        <DishCorrectionModal
          visible={true}
          currentFoodName={foodsList[correctingIndex]?.name}
          onSelect={(selectedDetail) => handleReplaceDish(correctingIndex, selectedDetail)}
          onRemove={() => handleRemoveDish(correctingIndex)}
          onClose={() => setCorrectingIndex(null)}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Food Card Component
// ---------------------------------------------------------------------------
interface FoodCardProps {
  food: any;
  index: number;
  isDetailView: boolean;
  showPer100g: boolean;
  onTogglePer100g: () => void;
  onUpdatePortion: (grams: number) => void;
  onOpenCorrection: () => void;
}

function FoodCard({
  food,
  isDetailView,
  showPer100g,
  onTogglePer100g,
  onUpdatePortion,
  onOpenCorrection,
}: FoodCardProps) {
  const healthColor = getHealthColor(food.health_label);
  const servingG = food.serving_estimate_g || 250;
  const p = food.per_100g || {};

  // Compute displayed values: per-serving vs per-100g
  const mult = showPer100g ? 1.0 : servingG / 100;
  const cal = Math.round((p.calories || 0) * mult);
  const protein = Math.round((p.protein || 0) * mult);
  const fat = Math.round((p.fat || 0) * mult);
  const carbs = Math.round((p.carbs || 0) * mult);
  const fiber = Math.round((p.fiber || 0) * mult);
  const sugar = Math.round((p.sugar || 0) * mult);

  // Trust badge derivation
  const isAiEstimate = food.verified === false || food.source === 'gemini';
  const confidenceVal = food.confidence ?? 1.0;
  const isLowConfidence = confidenceVal < 0.6;

  return (
    <View style={styles.card}>
      {/* Header: Name + Trust Badge + Health Score */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <View style={styles.nameRow}>
            <Text style={styles.foodName}>{food.name}</Text>
            <View style={[styles.trustBadge, isAiEstimate ? styles.trustBadgeAi : styles.trustBadgeVerified]}>
              <Text style={[styles.trustBadgeText, isAiEstimate ? styles.trustBadgeAiText : styles.trustBadgeVerifiedText]}>
                {isAiEstimate ? 'AI estimate' : '✓ Verified'}
              </Text>
            </View>
          </View>

          {/* Confidence row with Wrong dish prompt */}
          <View style={styles.confidenceRow}>
            <Text
              style={[
                styles.confidenceText,
                isLowConfidence && { color: colors.moderate, fontFamily: fonts.bodySemiBold },
              ]}
            >
              {Math.round(confidenceVal * 100)}% confidence
            </Text>
            {!isDetailView && (
              <TouchableOpacity
                onPress={onOpenCorrection}
                style={styles.wrongDishBtn}
                accessibilityRole="button"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.wrongDishText, isLowConfidence && { color: colors.moderate }]}>
                  {isLowConfidence ? 'Not sure? Tap to change' : 'Wrong dish?'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Health Score Block */}
        <View style={styles.scoreBlock}>
          <Text style={[styles.scoreNumber, { color: healthColor }]} maxFontSizeMultiplier={1.3}>
            {food.health_score}
          </Text>
          <Text style={[styles.scoreLabel, { color: healthColor }]}>
            {food.health_label}
          </Text>
        </View>
      </View>

      {/* Portion Control (Scan Mode Only) */}
      {!isDetailView && (
        <View style={styles.portionSection}>
          <View style={styles.portionHeader}>
            <Text style={styles.portionLabel}>Portion size</Text>
            <View style={styles.stepperContainer}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => onUpdatePortion(Math.max(25, servingG - 25))}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Decrease portion by 25 grams"
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <View style={styles.stepValueBox}>
                <Text style={styles.stepValueText}>{servingG}g</Text>
              </View>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => onUpdatePortion(servingG + 25)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Increase portion by 25 grams"
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Quick Portion Chips */}
          <View style={styles.portionChipsRow}>
            {[
              { label: 'Small', grams: 150 },
              { label: 'Regular', grams: 250 },
              { label: 'Large', grams: 350 },
            ].map((chip) => {
              const isSelected = servingG === chip.grams;
              return (
                <TouchableOpacity
                  key={chip.label}
                  style={[styles.portionChip, isSelected && styles.portionChipActive]}
                  onPress={() => onUpdatePortion(chip.grams)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${chip.label} portion, ${chip.grams} grams`}
                >
                  <Text style={[styles.portionChipText, isSelected && styles.portionChipTextActive]}>
                    {chip.label} {chip.grams}g
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Nutrition Header + Per-serving / Per-100g Toggle */}
      <View style={styles.macroHeaderRow}>
        <Text style={styles.macroHeaderCaption}>
          {showPer100g ? 'Values per 100g' : `Values per ${servingG}g serving`}
        </Text>
        <TouchableOpacity
          style={styles.toggleUnitBtn}
          onPress={onTogglePer100g}
          activeOpacity={0.7}
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.toggleUnitText}>
            {showPer100g ? 'Switch to serving' : 'Switch to 100g'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Macro Grid */}
      <View style={styles.macroGrid}>
        <MacroItem label="Cal" value={cal} unit="kcal" />
        <MacroItem label="Protein" value={protein} unit="g" />
        <MacroItem label="Fat" value={fat} unit="g" />
        <MacroItem label="Carbs" value={carbs} unit="g" />
        <MacroItem label="Fiber" value={fiber} unit="g" />
        <MacroItem label="Sugar" value={sugar} unit="g" />
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

      {/* Glycemic Index */}
      {food.glycemic_index && (
        <Text style={styles.giText}>Glycemic Index: {food.glycemic_index}</Text>
      )}
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

// ---------------------------------------------------------------------------
// Totals Card Component
// ---------------------------------------------------------------------------
function TotalsCard({ totals }: { totals: any }) {
  const calories = Math.round(totals.calories || 0);
  const protein = Math.round(totals.protein || 0);
  const carbs = Math.round(totals.carbs || 0);
  const fat = Math.round(totals.fat || 0);

  const proteinKcal = protein * 4;
  const carbsKcal = carbs * 4;
  const fatKcal = fat * 9;
  const macroTotalKcal = proteinKcal + carbsKcal + fatKcal || 1;

  const proteinPct = Math.round((proteinKcal / macroTotalKcal) * 100);
  const carbsPct = Math.round((carbsKcal / macroTotalKcal) * 100);
  const fatPct = Math.max(0, 100 - proteinPct - carbsPct);

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>Meal Totals</Text>

      <View style={styles.totalsHeaderRow}>
        <View>
          <Text style={styles.totalsCalories} maxFontSizeMultiplier={1.3}>{calories}</Text>
          <Text style={styles.totalsCaloriesUnit}>total calories</Text>
        </View>
      </View>

      {/* Horizontal Stacked Macro Bar */}
      <View style={styles.stackedBarContainer}>
        <View style={[styles.stackedBarSegment, { width: `${proteinPct}%`, backgroundColor: colors.accent }]} />
        <View style={[styles.stackedBarSegment, { width: `${carbsPct}%`, backgroundColor: colors.moderate }]} />
        <View style={[styles.stackedBarSegment, { width: `${fatPct}%`, backgroundColor: colors.limit }]} />
      </View>

      {/* Macro Legend */}
      <View style={styles.macroLegendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
          <Text style={styles.legendText}>
            Protein <Text style={styles.legendValue}>{protein}g</Text> ({proteinPct}%)
          </Text>
        </View>

        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.moderate }]} />
          <Text style={styles.legendText}>
            Carbs <Text style={styles.legendValue}>{carbs}g</Text> ({carbsPct}%)
          </Text>
        </View>

        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.limit }]} />
          <Text style={styles.legendText}>
            Fat <Text style={styles.legendValue}>{fat}g</Text> ({fatPct}%)
          </Text>
        </View>
      </View>

      {/* Secondary Micronutrients */}
      <View style={styles.microGrid}>
        <View style={styles.microItem}>
          <Text style={styles.microValue}>{Math.round(totals.fiber || 0)}g</Text>
          <Text style={styles.microLabel}>Fiber</Text>
        </View>
        <View style={styles.microItem}>
          <Text style={styles.microValue}>{Math.round(totals.sugar || 0)}g</Text>
          <Text style={styles.microLabel}>Sugar</Text>
        </View>
        <View style={styles.microItem}>
          <Text style={styles.microValue}>{Math.round(totals.sodium_mg || 0)}mg</Text>
          <Text style={styles.microLabel}>Sodium</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Dish Correction Modal Component
// ---------------------------------------------------------------------------
interface DishCorrectionModalProps {
  visible: boolean;
  currentFoodName: string;
  onSelect: (detail: any) => void;
  onRemove: () => void;
  onClose: () => void;
}

function DishCorrectionModal({
  visible,
  currentFoodName,
  onSelect,
  onRemove,
  onClose,
}: DishCorrectionModalProps) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [foodsDb, setFoodsDb] = useState<any[]>(cachedFoodsDb || []);

  useEffect(() => {
    if (!cachedFoodsDb) {
      setLoading(true);
      api.getFoods()
        .then((res: any) => {
          const list = res.foods || res || [];
          cachedFoodsDb = list;
          setFoodsDb(list);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, []);

  const filteredFoods = useMemo(() => {
    if (!search.trim()) return foodsDb.slice(0, 30);
    const q = search.toLowerCase();
    return foodsDb.filter((f: any) => f.name?.toLowerCase().includes(q)).slice(0, 30);
  }, [foodsDb, search]);

  const handlePickFood = async (item: any) => {
    setSelecting(true);
    try {
      const detail = await api.getFoodDetail(item.id);
      onSelect(detail);
    } catch {
      // If detail fetch fails, pass baseline data
      onSelect({
        name: item.name,
        health_score: item.health_score || 50,
        health_label: item.health_label || 'Moderate',
        per_100g: {},
      });
    } finally {
      setSelecting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Select Correct Dish</Text>
              <Text style={styles.modalSubtitle}>Replacing "{currentFoodName}"</Text>
            </View>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
              <Text style={styles.modalCloseText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Search Box */}
          <View style={styles.searchBox}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search dishes (e.g. Pad Thai)..."
              placeholderTextColor={colors.textSecondary}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Text style={styles.searchClearText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Loading Indicator or List */}
          {loading || selecting ? (
            <View style={styles.modalCenter}>
              <ActivityIndicator color={colors.textPrimary} />
              <Text style={styles.modalLoadingText}>
                {selecting ? 'Loading dish nutrition...' : 'Loading food catalog...'}
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.dishList} keyboardShouldPersistTaps="handled">
              {filteredFoods.map((item: any) => {
                const healthCol = getHealthColor(item.health_label);
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.dishRow}
                    onPress={() => handlePickFood(item)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dishRowName}>{item.name}</Text>
                      <Text style={styles.dishRowSub}>
                        Health: <Text style={{ color: healthCol }}>{item.health_label}</Text>
                      </Text>
                    </View>
                    <Text style={[styles.dishRowScore, { color: healthCol }]}>
                      {item.health_score}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {filteredFoods.length === 0 && (
                <Text style={styles.noResultsText}>No matching dishes found</Text>
              )}
            </ScrollView>
          )}

          {/* Remove Dish Action */}
          <TouchableOpacity style={styles.removeDishBtn} onPress={onRemove} activeOpacity={0.7}>
            <Text style={styles.removeDishText}>Remove this dish from meal</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 32,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },

  // Hero Image & Bounding Box
  heroWrapper: {
    width: '100%',
    height: 220,
    borderRadius: radii.card,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: spacing.lg,
    backgroundColor: colors.border,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  bboxBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  bboxLabelWrap: {
    position: 'absolute',
    top: -20,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bboxLabelText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
  },

  // Food Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  foodName: {
    fontSize: 20,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  trustBadge: {
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  trustBadgeText: {
    fontSize: 10,
  },
  trustBadgeVerified: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(44, 95, 46, 0.08)',
  },
  trustBadgeVerifiedText: {
    color: colors.accent,
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
  },
  trustBadgeAi: {
    borderColor: colors.textSecondary,
    backgroundColor: 'rgba(107, 107, 107, 0.08)',
  },
  trustBadgeAiText: {
    color: colors.textSecondary,
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  confidenceText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  wrongDishBtn: {
    paddingVertical: 2,
  },
  wrongDishText: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  scoreBlock: {
    alignItems: 'center',
    minWidth: 55,
  },
  scoreNumber: {
    fontSize: 32,
    fontFamily: fonts.display,
    lineHeight: 36,
  },
  scoreLabel: {
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Portion Controls
  portionSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  portionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  portionLabel: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    overflow: 'hidden',
  },
  stepBtn: {
    width: 32,
    height: 30,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBtnText: {
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  stepValueBox: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepValueText: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  portionChipsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 4,
  },
  portionChip: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  portionChipActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  portionChipText: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  portionChipTextActive: {
    color: '#FFFFFF',
    fontFamily: fonts.bodySemiBold,
  },

  // Macro Display & Unit Toggle
  macroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  macroHeaderCaption: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  toggleUnitBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  toggleUnitText: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.xs,
  },
  macroItem: {
    width: '33.3%',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  macroValue: {
    fontSize: 20,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  macroUnit: {
    fontSize: 10,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  macroLabel: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Tags & Allergens
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.xs,
  },
  tag: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  allergenRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  allergenLabel: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: colors.error,
  },
  allergenText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.error,
  },
  giText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  // Totals Card Styles
  sectionLabel: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  totalsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.md,
  },
  totalsCalories: {
    fontSize: 48,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    lineHeight: 52,
  },
  totalsCaloriesUnit: {
    fontSize: 13,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  stackedBarContainer: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  stackedBarSegment: {
    height: '100%',
  },
  macroLegendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  legendValue: {
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  microGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  microItem: {
    alignItems: 'center',
  },
  microValue: {
    fontSize: 16,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  microLabel: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Sticky Bottom Bar
  stickyBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  bottomSecondaryBtn: {
    flex: 1,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  bottomSecondaryBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },
  bottomPrimaryBtn: {
    flex: 1.6,
    borderRadius: radii.button,
    backgroundColor: colors.textPrimary,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomPrimaryBtnSaved: {
    backgroundColor: colors.accent,
  },
  bottomPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },

  // Floating Undo Toast
  toastFloating: {
    position: 'absolute',
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

  // Modal Sheet Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card * 1.5,
    borderTopRightRadius: radii.card * 1.5,
    padding: spacing.md,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalCloseBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  modalCloseText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textPrimary,
  },
  searchClearText: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
    paddingLeft: spacing.sm,
  },
  dishList: {
    maxHeight: 300,
  },
  dishRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dishRowName: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  dishRowSub: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dishRowScore: {
    fontSize: 20,
    fontFamily: fonts.display,
    marginLeft: spacing.sm,
  },
  noResultsText: {
    textAlign: 'center',
    paddingVertical: spacing.xl,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  removeDishBtn: {
    marginTop: spacing.md,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.error,
  },
  removeDishText: {
    color: colors.error,
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  modalCenter: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  modalLoadingText: {
    marginTop: spacing.sm,
    fontSize: 13,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  emptyBody: {
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
