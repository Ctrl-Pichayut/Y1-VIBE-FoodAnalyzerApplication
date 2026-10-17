/**
 * Shared TypeScript domain interfaces for the Food Intelligence Analyzer mobile app.
 */

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type DietaryMode =
  | 'standard'
  | 'high_protein'
  | 'keto'
  | 'low_carb'
  | 'vegetarian'
  | 'vegan';

export interface NutritionPer100g {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber?: number;
  sugar?: number;
  sodium_mg?: number;
  saturated_fat_g?: number;
  cholesterol_mg?: number;
  vitamin_a_dv?: number;
  vitamin_c_dv?: number;
  calcium_dv?: number;
  iron_dv?: number;
}

export interface DetectedFood {
  name: string;
  confidence: number;
  bbox?: number[] | null;
  serving_estimate_g: number;
  per_100g: NutritionPer100g;
  health_score: number;
  health_label: 'Healthy' | 'Moderate' | 'Limit' | string;
  glycemic_index?: string | null;
  allergens?: string[];
  tags?: string[];
  source?: 'nutrition_db' | 'openfoodfacts' | 'gemini' | 'unknown' | string;
  verified?: boolean;
}

export interface MealTotals {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  sugar: number;
  sodium_mg: number;
}

export interface MealLogItem {
  id: number;
  timestamp: string;
  scan_id?: string | null;
  meal_type?: MealType | string;
  foods_json: DetectedFood[];
  totals_json: MealTotals;
}

export interface DailyTargets {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  sugar?: number;
  sodium_mg: number;
}

export interface UserProfile {
  id: number;
  email: string;
  is_admin: boolean;
  weight_kg?: number | null;
  height_cm?: number | null;
  age?: number | null;
  gender?: string | null;
  activity_level: string;
  goal: string;
  dietary_mode?: DietaryMode | string | null;
  allergens: string[];
  daily_targets: DailyTargets;
}

export interface DailySummaryResponse {
  date: string;
  totals: MealTotals;
  targets: DailyTargets;
  meals_count: number;
  progress: Record<string, number>;
}

export interface WeeklyDayEntry {
  date: string;
  totals: MealTotals;
  meals_count: number;
}

export interface WeeklyReportResponse {
  start_date: string;
  end_date: string;
  daily_data: WeeklyDayEntry[];
  averages: Partial<MealTotals>;
  daily_targets: DailyTargets;
}

export interface FoodCatalogItem {
  id: number;
  name: string;
  health_score: number;
  health_label: string;
}

export interface ModelInfo {
  version: string;
  class_count: number;
  model_path: string;
  device: string;
  confidence_threshold: number;
}
