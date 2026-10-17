/**
 * DishCorrectionModal — Reusable searchable food catalog modal.
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
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radii, getHealthColor, fonts } from '../theme/tokens';
import * as api from '../services/api';

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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text style={styles.modalTitle}>{resolvedTitle}</Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {resolvedSubtitle}
              </Text>
            </View>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
              <Text style={styles.modalCloseText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Search Box */}
          <View style={styles.searchBox}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search dishes (e.g. Pad Thai, Som Tam)..."
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

          {/* Optional Remove Dish Action */}
          {onRemove && (
            <TouchableOpacity style={styles.removeDishBtn} onPress={onRemove} activeOpacity={0.7}>
              <Text style={styles.removeDishText}>Remove this dish from meal</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    maxHeight: 320,
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
});
