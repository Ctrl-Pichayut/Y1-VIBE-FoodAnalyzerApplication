/**
 * ResultScreen — Displays detected foods with nutrition cards + health scores.
 *
 * Features:
 *   • Multi-dish portion control per card: stepper (− / + step 25g, min 25g)
 *     and quick chips (Small 150g / Regular 250g / Large 350g).
 *   • Live recalculation of per-serving macros and meal totals.
 *   • Trust badges ("Verified" vs "AI estimate") and low-confidence warning.
 *   • Allergen conflict warning banner when a dish matches user's saved allergies.
 *   • Meal type selector chips (Breakfast, Lunch, Dinner, Snack).
 *   • "Wrong dish?" modal + "+ Add Dish" button from catalog.
 *   • Post-log meal editing (PUT /api/v1/history/{id}) when viewing from History.
 *   • Bounding box overlay on hero image scaled with aspect-fill (cover) offset math.
 */
import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  colors,
  spacing,
  radii,
  getHealthColor,
  getHealthSoftColor,
  fonts,
  shadows,
  macroColors,
} from '../theme/tokens';
import * as api from '../services/api';
import DishCorrectionModal from '../components/DishCorrectionModal';
import { FadeInView, IconBubble, PressableScale, Toast, mealTypeIcon } from '../components/ui';
import { MealType } from '../types/models';

const MEAL_TYPE_OPTIONS: { id: MealType; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snack' },
];

function inferDefaultMealType(): MealType {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 22) return 'dinner';
  return 'snack';
}

function normalizeAllergenToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, '_');
}

function doesAllergenMatch(foodAllergen: string, userAllergens: string[]): boolean {
  const f = normalizeAllergenToken(foodAllergen);
  return userAllergens.some((uRaw) => {
    const u = normalizeAllergenToken(uRaw);
    if (f === u || f.includes(u) || u.includes(f)) return true;
    if ((u === 'dairy' && f === 'milk') || (u === 'milk' && f === 'dairy')) return true;
    if ((u === 'gluten' && f === 'wheat') || (u === 'wheat' && f === 'gluten')) return true;
    return false;
  });
}

export default function ResultScreen({ route, navigation }: any) {
  const { result, imageUri, meal } = route.params || {};
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const cardOffsets = useRef<Record<number, number>>({});

  // Detail mode = opened from history (saved meal)
  const isDetailView = !!meal;
  const [isEditingSavedMeal, setIsEditingSavedMeal] = useState<boolean>(false);
  const canEdit = !isDetailView || isEditingSavedMeal;

  // Initial foods from route params
  const initialFoods = useMemo(() => {
    return (isDetailView ? meal.foods_json : result?.foods) || [];
  }, [isDetailView, meal, result]);

  const [foodsList, setFoodsList] = useState<any[]>(initialFoods);
  const [mealType, setMealType] = useState<MealType>(
    (meal?.meal_type as MealType) || inferDefaultMealType()
  );

  // User allergens for conflict warnings
  const [userAllergens, setUserAllergens] = useState<string[]>([]);

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

  // Wrong dish / Add dish modal state
  const [correctingIndex, setCorrectingIndex] = useState<number | null>(null);
  const [addingDish, setAddingDish] = useState<boolean>(false);

  // Load user profile allergens
  useEffect(() => {
    if (loggedIn) {
      api
        .getProfile()
        .then((prof) => {
          if (Array.isArray(prof?.allergens)) {
            setUserAllergens(prof.allergens);
          }
        })
        .catch(() => {});
    }
  }, [loggedIn]);

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

  // Compute allergen conflicts across all dishes in the meal
  const allergenConflicts = useMemo(() => {
    if (!userAllergens.length) return [];
    const conflicts: { dishName: string; allergens: string[] }[] = [];
    foodsList.forEach((food: any) => {
      const dishAllergens: string[] = Array.isArray(food.allergens) ? food.allergens : [];
      const matched = dishAllergens.filter((a) => doesAllergenMatch(a, userAllergens));
      if (matched.length > 0) {
        conflicts.push({ dishName: food.name, allergens: matched });
      }
    });
    return conflicts;
  }, [foodsList, userAllergens]);

  // Live computed meal totals based on edited foods & portion sizes
  const computedTotals = useMemo(() => {
    if (isDetailView && !isEditingSavedMeal && meal?.totals_json && foodsList === initialFoods) {
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
  }, [isDetailView, isEditingSavedMeal, meal, foodsList, initialFoods]);

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

  const handleAddDish = (newDishData: any) => {
    setFoodsList((prev) => [
      ...prev,
      {
        ...newDishData,
        serving_estimate_g: 250,
        confidence: 1.0,
        source: 'nutrition_db',
        verified: true,
      },
    ]);
    setAddingDish(false);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
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

  // Save new meal handler
  const handleSaveMeal = async () => {
    if (!loggedIn) {
      navigation.navigate('Profile');
      return;
    }
    if (saving || saved) return;

    setSaving(true);
    try {
      const res = await api.logMeal(foodsList, computedTotals, mealType);
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

  // Save edited meal in detail view (PUT /api/v1/history/{meal_id})
  const handleUpdateSavedMeal = async () => {
    if (!meal?.id || saving) return;
    setSaving(true);
    try {
      await api.updateMeal(meal.id, foodsList, computedTotals, mealType);
      setIsEditingSavedMeal(false);
      setToastMessage('Meal updated');
      setTimeout(() => setToastMessage(null), 2500);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } catch (e: any) {
      setToastMessage(e.message || 'Failed to update meal');
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
    : `${foodsList.length} dish${foodsList.length !== 1 ? 'es' : ''} in meal`;

  return (
    <View style={styles.screenWrapper}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.container}
        contentContainerStyle={{
          padding: spacing.md,
          paddingBottom: canEdit ? 140 : spacing.xxl,
        }}
      >
        {/* Screen Header */}
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
          {isDetailView && loggedIn && (
            <PressableScale
              style={[
                styles.editMealToggleBtn,
                isEditingSavedMeal && styles.editMealToggleBtnActive,
              ]}
              onPress={() => {
                if (isEditingSavedMeal) {
                  // Reset changes on cancel
                  setFoodsList(initialFoods);
                  setMealType((meal?.meal_type as MealType) || inferDefaultMealType());
                  setIsEditingSavedMeal(false);
                } else {
                  setIsEditingSavedMeal(true);
                }
              }}
            >
              <Ionicons
                name={isEditingSavedMeal ? 'close' : 'create-outline'}
                size={16}
                color={isEditingSavedMeal ? colors.textSecondary : colors.accent}
              />
              <Text
                style={[
                  styles.editMealToggleText,
                  isEditingSavedMeal && styles.editMealToggleTextActive,
                ]}
              >
                {isEditingSavedMeal ? 'Cancel' : 'Edit'}
              </Text>
            </PressableScale>
          )}
        </View>

        {/* Allergen Conflict Alert Banner */}
        {allergenConflicts.length > 0 && (
          <FadeInView style={styles.allergenAlertBanner}>
            <IconBubble
              name="warning"
              size={36}
              color={colors.error}
              background="rgba(198, 40, 40, 0.12)"
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.allergenAlertTitle}>Allergen alert</Text>
              <Text style={styles.allergenAlertBody}>
                Matches your saved food allergies:{' '}
                {allergenConflicts
                  .map((c) => `${c.dishName} (${c.allergens.join(', ')})`)
                  .join(' · ')}
              </Text>
            </View>
          </FadeInView>
        )}

        {/* Meal Type Selector Chips */}
        <View style={styles.mealTypeRow}>
          {MEAL_TYPE_OPTIONS.map((opt) => {
            const isSelected = mealType === opt.id;
            return (
              <PressableScale
                key={opt.id}
                style={[styles.mealTypeChip, isSelected && styles.mealTypeChipActive]}
                disabled={!canEdit}
                dimWhenDisabled={false}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setMealType(opt.id);
                }}
                scaleTo={0.94}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
              >
                <Ionicons
                  name={mealTypeIcon(opt.id)}
                  size={18}
                  color={isSelected ? colors.textOnDark : colors.textSecondary}
                />
                <Text style={[styles.mealTypeChipText, isSelected && styles.mealTypeChipTextActive]}>
                  {opt.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>

        {/* Hero Image with Aspect-Fill (Cover) Bounding Box Overlays */}
        {!isDetailView && imageUri && (
          <View
            style={styles.heroWrapper}
            onLayout={(e: LayoutChangeEvent) => {
              const { width, height } = e.nativeEvent.layout;
              setRenderedImgSize({ width, height });
            }}
          >
            <Image source={{ uri: imageUri }} style={styles.heroImage} resizeMode="cover" />

            {originalImgSize &&
              renderedImgSize &&
              foodsList.map((food, i) => {
                if (!food.bbox || food.bbox.length < 4) return null;
                const [x1, y1, x2, y2] = food.bbox;
                // Account for resizeMode="cover" uniform scaling and center-crop offset
                const scale = Math.max(
                  renderedImgSize.width / originalImgSize.width,
                  renderedImgSize.height / originalImgSize.height
                );
                const offsetX = (originalImgSize.width * scale - renderedImgSize.width) / 2;
                const offsetY = (originalImgSize.height * scale - renderedImgSize.height) / 2;

                const rawLeft = x1 * scale - offsetX;
                const rawTop = y1 * scale - offsetY;
                const rawWidth = (x2 - x1) * scale;
                const rawHeight = (y2 - y1) * scale;

                const left = Math.max(0, Math.min(renderedImgSize.width - 24, rawLeft));
                const top = Math.max(20, Math.min(renderedImgSize.height - 24, rawTop));
                const width = Math.max(24, Math.min(renderedImgSize.width - left, rawWidth));
                const height = Math.max(24, Math.min(renderedImgSize.height - top, rawHeight));

                return (
                  <Pressable
                    key={i}
                    onPress={() => scrollToCard(i)}
                    style={({ pressed }) => [
                      styles.bboxBox,
                      { left, top, width, height },
                      pressed && styles.bboxBoxPressed,
                    ]}
                  >
                    <View style={styles.bboxLabelWrap}>
                      <Text style={styles.bboxLabelText} numberOfLines={1}>
                        {food.name}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            {foodsList.some((f: any) => f.bbox?.length >= 4) && (
              <View style={styles.heroHint} pointerEvents="none">
                <Ionicons name="hand-left-outline" size={12} color={colors.textOnDark} />
                <Text style={styles.heroHintText}>Tap a box to jump to the dish</Text>
              </View>
            )}
          </View>
        )}

        {/* Food Cards */}
        {foodsList.map((food: any, index: number) => (
          <FadeInView
            key={index}
            delay={Math.min(index, 5) * 70}
            onLayout={(e: LayoutChangeEvent) => {
              cardOffsets.current[index] = e.nativeEvent.layout.y;
            }}
          >
            <FoodCard
              food={food}
              index={index}
              canEdit={canEdit}
              userAllergens={userAllergens}
              showPer100g={!!showPer100g[index]}
              onTogglePer100g={() => handleTogglePer100g(index)}
              onUpdatePortion={(grams) => handleUpdatePortion(index, grams)}
              onOpenCorrection={() => setCorrectingIndex(index)}
            />
          </FadeInView>
        ))}

        {/* Add Dish Button */}
        {canEdit && (
          <PressableScale style={styles.addDishBtn} onPress={() => setAddingDish(true)}>
            <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
            <Text style={styles.addDishBtnText}>Add another dish</Text>
          </PressableScale>
        )}

        {foodsList.length === 0 && (
          <View style={styles.empty}>
            <IconBubble name="restaurant-outline" size={64} color={colors.textSecondary} background={colors.surfaceMuted} />
            <Text style={styles.emptyTitle}>No food in this meal</Text>
            <Text style={styles.emptyBody}>
              Tap "Add another dish" above or scan a photo with better lighting.
            </Text>
          </View>
        )}

        {/* Totals Card */}
        {foodsList.length > 0 && <TotalsCard totals={computedTotals} />}
      </ScrollView>

      {/* Sticky Bottom Bar for Scan Mode */}
      {!isDetailView && foodsList.length > 0 && (
        <View style={[styles.stickyBottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <PressableScale
            style={styles.bottomSecondaryBtn}
            onPress={() => navigation.navigate('ScanCamera')}
            accessibilityLabel="Scan another meal"
          >
            <Ionicons name="camera-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.bottomSecondaryBtnText}>Rescan</Text>
          </PressableScale>

          <PressableScale
            style={[styles.bottomPrimaryBtn, saved && styles.bottomPrimaryBtnSaved]}
            onPress={handleSaveMeal}
            disabled={saving || saved}
            dimWhenDisabled={!saved}
          >
            <Ionicons
              name={saved ? 'checkmark-circle' : loggedIn ? 'bookmark-outline' : 'log-in-outline'}
              size={18}
              color={colors.textOnDark}
            />
            <Text style={styles.bottomPrimaryBtnText}>
              {saving
                ? 'Saving...'
                : saved
                ? 'Saved to History'
                : `Save Meal · ${computedTotals.calories} kcal`}
            </Text>
          </PressableScale>
        </View>
      )}

      {/* Sticky Bottom Bar for Editing Saved Meal from History */}
      {isDetailView && isEditingSavedMeal && foodsList.length > 0 && (
        <View style={[styles.stickyBottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <PressableScale
            style={[styles.bottomPrimaryBtn, { flex: 1 }]}
            onPress={handleUpdateSavedMeal}
            disabled={saving}
          >
            <Ionicons name="save-outline" size={18} color={colors.textOnDark} />
            <Text style={styles.bottomPrimaryBtnText}>
              {saving ? 'Updating...' : `Save Changes · ${computedTotals.calories} kcal`}
            </Text>
          </PressableScale>
        </View>
      )}

      {/* Floating Undo Toast */}
      <Toast
        message={toastMessage}
        icon={/fail/i.test(toastMessage || '') ? 'alert-circle' : 'checkmark-circle'}
        bottom={canEdit ? 104 : spacing.xl}
        actionLabel={undoSeconds > 0 ? `Undo (${undoSeconds}s)` : undefined}
        onAction={undoSeconds > 0 ? handleUndoSave : undefined}
      />

      {/* Wrong Dish Replacement Modal */}
      {correctingIndex !== null && (
        <DishCorrectionModal
          visible={true}
          currentFoodName={foodsList[correctingIndex]?.name}
          onSelect={(selectedDetail) => handleReplaceDish(correctingIndex, selectedDetail)}
          onRemove={() => handleRemoveDish(correctingIndex)}
          onClose={() => setCorrectingIndex(null)}
        />
      )}

      {/* Add Dish Modal */}
      {addingDish && (
        <DishCorrectionModal
          visible={true}
          title="Add Dish to Meal"
          subtitle="Search 100+ verified dishes"
          onSelect={(selectedDetail) => handleAddDish(selectedDetail)}
          onClose={() => setAddingDish(false)}
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
  canEdit: boolean;
  userAllergens: string[];
  showPer100g: boolean;
  onTogglePer100g: () => void;
  onUpdatePortion: (grams: number) => void;
  onOpenCorrection: () => void;
}

function FoodCard({
  food,
  canEdit,
  userAllergens,
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
  const isOpenFoodFacts = food.source === 'openfoodfacts';
  const confidenceVal = food.confidence ?? 1.0;
  const isLowConfidence = confidenceVal < 0.6;

  const dishAllergens: string[] = Array.isArray(food.allergens) ? food.allergens : [];
  const hasAllergenConflict =
    userAllergens.length > 0 &&
    dishAllergens.some((a) => doesAllergenMatch(a, userAllergens));

  return (
    <View style={[styles.card, hasAllergenConflict && styles.cardAllergenConflict]}>
      {/* Header: Name + Trust Badge + Health Score */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <Text style={styles.foodName}>{food.name}</Text>
          <View style={styles.nameRow}>
            <View
              style={[
                styles.trustBadge,
                isAiEstimate ? styles.trustBadgeAi : styles.trustBadgeVerified,
              ]}
            >
              <Ionicons
                name={isAiEstimate ? 'sparkles' : 'shield-checkmark'}
                size={11}
                color={isAiEstimate ? colors.textSecondary : colors.accent}
              />
              <Text
                style={[
                  styles.trustBadgeText,
                  isAiEstimate ? styles.trustBadgeAiText : styles.trustBadgeVerifiedText,
                ]}
              >
                {isAiEstimate
                  ? 'AI estimate'
                  : isOpenFoodFacts
                  ? 'OpenFoodFacts'
                  : 'Verified'}
              </Text>
            </View>
            <Text
              style={[
                styles.confidenceText,
                isLowConfidence && { color: colors.moderate, fontFamily: fonts.bodySemiBold },
              ]}
            >
              {Math.round(confidenceVal * 100)}% match
            </Text>
          </View>

          {/* Wrong dish prompt */}
          {canEdit && (
            <Pressable
              onPress={onOpenCorrection}
              style={({ pressed }) => [styles.wrongDishBtn, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="swap-horizontal"
                size={14}
                color={isLowConfidence ? colors.moderate : colors.accent}
              />
              <Text style={[styles.wrongDishText, isLowConfidence && { color: colors.moderate }]}>
                {isLowConfidence ? 'Not sure? Tap to change' : 'Wrong dish?'}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Health Score Block */}
        <View style={[styles.scoreBlock, { backgroundColor: getHealthSoftColor(food.health_label) }]}>
          <Text style={[styles.scoreNumber, { color: healthColor }]} maxFontSizeMultiplier={1.3}>
            {food.health_score}
          </Text>
          <Text style={[styles.scoreLabel, { color: healthColor }]}>{food.health_label}</Text>
        </View>
      </View>

      {/* Portion Control (Editable Mode) */}
      {canEdit && (
        <View style={styles.portionSection}>
          <View style={styles.portionHeader}>
            <Text style={styles.portionLabel}>Portion size</Text>
            <View style={styles.stepperContainer}>
              <PressableScale
                style={styles.stepBtn}
                onPress={() => onUpdatePortion(Math.max(25, servingG - 25))}
                scaleTo={0.85}
                accessibilityRole="button"
                accessibilityLabel="Decrease portion by 25 grams"
              >
                <Ionicons name="remove" size={18} color={colors.textPrimary} />
              </PressableScale>
              <View style={styles.stepValueBox}>
                <Text style={styles.stepValueText}>{servingG}g</Text>
              </View>
              <PressableScale
                style={styles.stepBtn}
                onPress={() => onUpdatePortion(servingG + 25)}
                scaleTo={0.85}
                accessibilityRole="button"
                accessibilityLabel="Increase portion by 25 grams"
              >
                <Ionicons name="add" size={18} color={colors.textPrimary} />
              </PressableScale>
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
                <PressableScale
                  key={chip.label}
                  style={[styles.portionChip, isSelected && styles.portionChipActive]}
                  onPress={() => onUpdatePortion(chip.grams)}
                  scaleTo={0.94}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${chip.label} portion, ${chip.grams} grams`}
                >
                  <Text style={[styles.portionChipText, isSelected && styles.portionChipTextActive]}>
                    {chip.label}
                  </Text>
                  <Text style={[styles.portionChipSub, isSelected && styles.portionChipSubActive]}>
                    {chip.grams}g
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>
      )}

      {/* Nutrition Header + Per-serving / Per-100g Toggle */}
      <View style={styles.macroHeaderRow}>
        <Text style={styles.macroHeaderCaption}>Nutrition</Text>
        <View style={styles.unitToggle}>
          {[
            { id: false, label: `${servingG}g` },
            { id: true, label: '100g' },
          ].map((opt) => {
            const active = showPer100g === opt.id;
            return (
              <Pressable
                key={String(opt.id)}
                onPress={() => {
                  if (!active) onTogglePer100g();
                }}
                style={[styles.unitToggleOpt, active && styles.unitToggleOptActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.id ? 'Show values per 100 grams' : 'Show values per serving'}
                hitSlop={4}
              >
                <Text style={[styles.unitToggleText, active && styles.unitToggleTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Macro Grid */}
      <View style={styles.macroGrid}>
        <MacroItem label="Calories" value={cal} unit="kcal" highlight />
        <MacroItem label="Protein" value={protein} unit="g" dot={macroColors.protein} />
        <MacroItem label="Carbs" value={carbs} unit="g" dot={macroColors.carbs} />
        <MacroItem label="Fat" value={fat} unit="g" dot={macroColors.fat} />
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
      {dishAllergens.length > 0 && (
        <View style={[styles.allergenRow, hasAllergenConflict && styles.allergenRowConflict]}>
          <Ionicons
            name={hasAllergenConflict ? 'warning' : 'information-circle-outline'}
            size={15}
            color={hasAllergenConflict ? colors.error : colors.textSecondary}
          />
          <Text style={[styles.allergenText, hasAllergenConflict && styles.allergenTextConflict]}>
            <Text style={styles.allergenLabel}>
              {hasAllergenConflict ? 'Contains your allergen: ' : 'Allergens: '}
            </Text>
            {dishAllergens.join(', ')}
          </Text>
        </View>
      )}

      {/* Glycemic Index */}
      {food.glycemic_index && (
        <Text style={styles.giText}>Glycemic Index: {food.glycemic_index}</Text>
      )}
    </View>
  );
}

function MacroItem({
  label,
  value,
  unit,
  dot,
  highlight,
}: {
  label: string;
  value: number;
  unit: string;
  dot?: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.macroItemOuter}>
      <View style={[styles.macroItem, highlight && styles.macroItemHighlight]}>
        <Text style={[styles.macroValue, highlight && { color: colors.textOnDark }]}>
          {value ?? 0}
          <Text style={[styles.macroUnit, highlight && { color: 'rgba(255,255,255,0.7)' }]}> {unit}</Text>
        </Text>
        <View style={styles.macroLabelRow}>
          {dot ? <View style={[styles.macroDot, { backgroundColor: dot }]} /> : null}
          <Text style={[styles.macroLabel, highlight && { color: 'rgba(255,255,255,0.75)' }]}>
            {label}
          </Text>
        </View>
      </View>
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
    <View style={[styles.card, styles.totalsCard]}>
      <View style={styles.totalsHeaderRow}>
        <View>
          <Text style={styles.sectionLabel}>Meal totals</Text>
          <Text style={styles.totalsCalories} maxFontSizeMultiplier={1.3}>
            {calories}
            <Text style={styles.totalsCaloriesUnit}> kcal</Text>
          </Text>
        </View>
        <IconBubble name="flame" size={44} color={colors.moderate} background={colors.moderateSoft} />
      </View>

      {/* Horizontal Stacked Macro Bar */}
      <View style={styles.stackedBarContainer}>
        <View
          style={[
            styles.stackedBarSegment,
            { width: `${proteinPct}%`, backgroundColor: macroColors.protein },
          ]}
        />
        <View
          style={[
            styles.stackedBarSegment,
            { width: `${carbsPct}%`, backgroundColor: macroColors.carbs },
          ]}
        />
        <View
          style={[
            styles.stackedBarSegment,
            { width: `${fatPct}%`, backgroundColor: macroColors.fat },
          ]}
        />
      </View>

      {/* Macro Legend */}
      <View style={styles.macroLegendRow}>
        <LegendItem color={macroColors.protein} label="Protein" grams={protein} pct={proteinPct} />
        <LegendItem color={macroColors.carbs} label="Carbs" grams={carbs} pct={carbsPct} />
        <LegendItem color={macroColors.fat} label="Fat" grams={fat} pct={fatPct} />
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

function LegendItem({
  color,
  label,
  grams,
  pct,
}: {
  color: string;
  label: string;
  grams: number;
  pct: number;
}) {
  return (
    <View style={styles.legendItem}>
      <View style={styles.legendTop}>
        <View style={[styles.legendDot, { backgroundColor: color }]} />
        <Text style={styles.legendText}>{label}</Text>
      </View>
      <Text style={styles.legendValue}>
        {grams}g <Text style={styles.legendPct}>{pct}%</Text>
      </Text>
    </View>
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
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  editMealToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accentSoft,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  editMealToggleBtnActive: {
    backgroundColor: colors.surfaceMuted,
  },
  editMealToggleText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: colors.accent,
  },
  editMealToggleTextActive: {
    color: colors.textSecondary,
  },

  // Allergen Alert Banner
  allergenAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    backgroundColor: colors.errorSoft,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  allergenAlertTitle: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: colors.error,
    marginBottom: 2,
  },
  allergenAlertBody: {
    fontSize: 13,
    fontFamily: fonts.body,
    color: colors.error,
    lineHeight: 18,
  },

  // Meal Type Chips
  mealTypeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  mealTypeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
    alignItems: 'center',
    gap: 4,
    ...shadows.card,
  },
  mealTypeChipActive: {
    backgroundColor: colors.ink,
  },
  mealTypeChipText: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  mealTypeChipTextActive: {
    color: colors.textOnDark,
    fontFamily: fonts.bodySemiBold,
  },

  // Hero Image & Bounding Box
  heroWrapper: {
    width: '100%',
    height: 240,
    borderRadius: radii.card + 4,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: spacing.md + 4,
    backgroundColor: colors.surfaceMuted,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroHint: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  heroHintText: {
    color: colors.textOnDark,
    fontSize: 11,
    fontFamily: fonts.bodyMedium,
  },
  bboxBox: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: '#B9F0B9',
    borderRadius: 10,
    backgroundColor: 'rgba(185, 240, 185, 0.12)',
  },
  bboxBoxPressed: {
    backgroundColor: 'rgba(185, 240, 185, 0.3)',
  },
  bboxLabelWrap: {
    position: 'absolute',
    top: -22,
    left: -2,
    backgroundColor: colors.ink,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  bboxLabelText: {
    color: colors.textOnDark,
    fontSize: 11,
    fontFamily: fonts.bodySemiBold,
  },

  // Food Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md + 4,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  cardAllergenConflict: {
    borderColor: colors.error,
    borderWidth: 1.5,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 6,
  },
  foodName: {
    fontSize: 21,
    lineHeight: 26,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  trustBadgeText: {
    fontSize: 11,
  },
  trustBadgeVerified: {
    backgroundColor: colors.accentSoft,
  },
  trustBadgeVerifiedText: {
    color: colors.accent,
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
  },
  trustBadgeAi: {
    backgroundColor: colors.surfaceMuted,
  },
  trustBadgeAiText: {
    color: colors.textSecondary,
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
  },
  confidenceText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  wrongDishBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingVertical: 2,
  },
  wrongDishText: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.accent,
  },
  scoreBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 66,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radii.button + 2,
  },
  scoreNumber: {
    fontSize: 28,
    fontFamily: fonts.display,
    lineHeight: 32,
  },
  scoreLabel: {
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // Portion Controls
  portionSection: {
    backgroundColor: colors.background,
    borderRadius: radii.button + 2,
    padding: spacing.sm + 4,
    marginBottom: spacing.md,
  },
  portionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm + 2,
  },
  portionLabel: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    padding: 3,
    ...shadows.card,
  },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepValueBox: {
    minWidth: 60,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepValueText: {
    fontSize: 16,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  portionChipsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  portionChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  portionChipActive: {
    backgroundColor: colors.accent,
  },
  portionChipText: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  portionChipTextActive: {
    color: colors.textOnDark,
  },
  portionChipSub: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 1,
  },
  portionChipSubActive: {
    color: 'rgba(255, 255, 255, 0.8)',
  },

  // Macro Display & Unit Toggle
  macroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm + 2,
  },
  macroHeaderCaption: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    padding: 3,
  },
  unitToggleOpt: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
  },
  unitToggleOptActive: {
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  unitToggleText: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  unitToggleTextActive: {
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  macroItemOuter: {
    width: '33.333%',
    padding: 4,
  },
  macroItem: {
    backgroundColor: colors.background,
    borderRadius: radii.input,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  macroItemHighlight: {
    backgroundColor: colors.ink,
  },
  macroValue: {
    fontSize: 18,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  macroUnit: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  macroLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  macroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  macroLabel: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },

  // Tags & Allergens
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm + 4,
  },
  tag: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  allergenRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: spacing.sm + 4,
  },
  allergenRowConflict: {
    backgroundColor: colors.errorSoft,
    padding: spacing.sm + 2,
    borderRadius: radii.input,
  },
  allergenLabel: {
    fontFamily: fonts.bodySemiBold,
  },
  allergenText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  allergenTextConflict: {
    color: colors.error,
  },
  giText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },

  // Add Dish Button
  addDishBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: '#BFD6BB',
    borderStyle: 'dashed',
    borderRadius: radii.card,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    backgroundColor: 'rgba(229, 239, 226, 0.5)',
  },
  addDishBtnText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.accent,
  },

  // Totals Card Styles
  totalsCard: {
    paddingBottom: spacing.md,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  totalsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  totalsCalories: {
    fontSize: 40,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    lineHeight: 46,
  },
  totalsCaloriesUnit: {
    fontSize: 15,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  stackedBarContainer: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    overflow: 'hidden',
    gap: 2,
    marginBottom: spacing.md,
  },
  stackedBarSegment: {
    height: '100%',
    borderRadius: 6,
  },
  macroLegendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  legendItem: {
    flex: 1,
  },
  legendTop: {
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
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  legendValue: {
    fontSize: 16,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginTop: 2,
  },
  legendPct: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  microGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  microItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.input,
    paddingVertical: 10,
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
    ...shadows.bar,
  },
  bottomSecondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    borderRadius: radii.button,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  bottomSecondaryBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },
  bottomPrimaryBtn: {
    flex: 2,
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.ink,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomPrimaryBtnSaved: {
    backgroundColor: colors.accent,
  },
  bottomPrimaryBtnText: {
    color: colors.textOnDark,
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
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
    marginTop: spacing.md,
  },
  emptyBody: {
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
    maxWidth: 300,
  },
});
