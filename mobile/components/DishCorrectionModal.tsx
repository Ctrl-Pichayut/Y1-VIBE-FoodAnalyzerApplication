/**
 * DishCorrectionModal — Reusable searchable food catalog bottom sheet.
 * Used for:
 *   1. Replacing a misidentified dish in ResultScreen ("Wrong dish?")
 *   2. Adding another dish to a meal in ResultScreen ("+ Add Dish")
 *   3. Logging a meal manually without camera from HomeScreen / HistoryScreen
 */
import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  spacing,
  radii,
  getHealthColor,
  getHealthSoftColor,
  fonts,
} from '../theme/tokens';
import * as api from '../services/api';
import { PressableScale } from './ui';

let cachedFoodsDb: any[] | null = null;

export interface DishCorrectionModalProps {
  visible: boolean;
  currentFoodName?: string;
  title?: string;
  subtitle?: string;
  onSelect: (detail: any) => void;
  onRemove?: () => void;
  onClose: () => void;
}

export default function DishCorrectionModal({
  visible,
  currentFoodName,
  title,
  subtitle,
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
    if (!visible) return;
    if (!cachedFoodsDb || cachedFoodsDb.length === 0) {
      setLoading(true);
      api
        .getFoods()
        .then((res: any) => {
          const list = res.foods || res || [];
          cachedFoodsDb = list;
          setFoodsDb(list);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setFoodsDb(cachedFoodsDb);
    }
  }, [visible]);

  const filteredFoods = useMemo(() => {
    if (!search.trim()) return foodsDb.slice(0, 40);
    const q = search.toLowerCase();
    return foodsDb
      .filter((f: any) => f.name?.toLowerCase().includes(q))
      .slice(0, 40);
  }, [foodsDb, search]);

  const handlePickFood = async (item: any) => {
    setSelecting(true);
    try {
      const detail = await api.getFoodDetail(item.id);
      onSelect(detail);
    } catch {
      onSelect({
        name: item.name,
        health_score: item.health_score || 50,
        health_label: item.health_label || 'Moderate',
        per_100g: {
          calories: 150,
          protein: 8,
          fat: 6,
          carbs: 18,
          fiber: 2,
          sugar: 3,
          sodium_mg: 300,
        },
        allergens: [],
        tags: [],
      });
    } finally {
      setSelecting(false);
      setSearch('');
    }
  };

  const resolvedTitle =
    title || (currentFoodName ? 'Select Correct Dish' : 'Add Dish from Catalog');
  const resolvedSubtitle =
    subtitle ||
    (currentFoodName
      ? `Replacing "${currentFoodName}"`
      : 'Search 100+ verified dishes');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Tap outside the sheet to dismiss */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.grabber} />

          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text style={styles.modalTitle}>{resolvedTitle}</Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {resolvedSubtitle}
              </Text>
            </View>
            <PressableScale
              style={styles.modalCloseBtn}
              onPress={onClose}
              scaleTo={0.9}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </PressableScale>
          </View>

          {/* Search Box */}
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search dishes (e.g. Pad Thai, Som Tam)..."
              placeholderTextColor={colors.textTertiary}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <Pressable
                onPress={() => setSearch('')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
              </Pressable>
            )}
          </View>

          {/* Loading Indicator or List */}
          {loading || selecting ? (
            <View style={styles.modalCenter}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.modalLoadingText}>
                {selecting ? 'Loading dish nutrition...' : 'Loading food catalog...'}
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.dishList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {filteredFoods.map((item: any) => {
                const healthCol = getHealthColor(item.health_label);
                return (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [styles.dishRow, pressed && styles.dishRowPressed]}
                    onPress={() => handlePickFood(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dishRowName}>{item.name}</Text>
                      <Text style={[styles.dishRowSub, { color: healthCol }]}>
                        {item.health_label}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.dishRowScorePill,
                        { backgroundColor: getHealthSoftColor(item.health_label) },
                      ]}
                    >
                      <Text style={[styles.dishRowScore, { color: healthCol }]}>
                        {item.health_score}
                      </Text>
                    </View>
                    <Ionicons name="add-circle" size={26} color={colors.accent} />
                  </Pressable>
                );
              })}

              {filteredFoods.length === 0 && (
                <View style={styles.modalCenter}>
                  <Ionicons name="search-outline" size={28} color={colors.textTertiary} />
                  <Text style={styles.noResultsText}>No matching dishes found</Text>
                </View>
              )}
            </ScrollView>
          )}

          {/* Optional Remove Dish Action */}
          {onRemove && (
            <PressableScale style={styles.removeDishBtn} onPress={onRemove}>
              <Ionicons name="trash-outline" size={17} color={colors.error} />
              <Text style={styles.removeDishText}>Remove this dish from meal</Text>
            </PressableScale>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.sm,
    maxHeight: '85%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 13,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: Platform.OS === 'ios' ? 12 : 4,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textPrimary,
  },
  dishList: {
    maxHeight: 380,
  },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.input,
  },
  dishRowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  dishRowName: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  dishRowSub: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    marginTop: 2,
  },
  dishRowScorePill: {
    minWidth: 40,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  dishRowScore: {
    fontSize: 15,
    fontFamily: fonts.display,
  },
  noResultsText: {
    textAlign: 'center',
    marginTop: spacing.sm,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  removeDishBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.errorSoft,
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
});
