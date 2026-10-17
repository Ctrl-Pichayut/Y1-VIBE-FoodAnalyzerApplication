/**
 * ProfileScreen — User profile, daily targets, TDEE settings, and auth.
 * Phase 4: Profile & Auth Polish
 *
 * Features:
 *   • Wrapped in KeyboardAvoidingView with keyboardShouldPersistTaps="handled".
 *   • Auth form: labels above inputs, Show/Hide password toggle, returnKeyType chaining,
 *     autoComplete/textContentType, and inline validation messages.
 *   • Friendly error messages for auth (401, 409, network).
 *   • Body stats edit: range validation (weight 20-300kg, height 100-250cm, age 10-100),
 *     input unit suffixes, non-destructive payloads, and saving spinner state.
 *   • Targets updated toast after saving profile changes.
 *   • Confirmed 1-tap logout navigating directly to Home.
 *   • Two-line descriptive chips for Activity Levels and Goals with subtitles.
 */
import React, { useState, useCallback, useContext, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radii, fonts, typography } from '../theme/tokens';
import * as api from '../services/api';
import AppModal, { ModalState } from '../components/AppModal';
import { AuthContext } from '../context/AuthContext';

const ACTIVITY_LEVELS = [
  { id: 'sedentary', label: 'Sedentary', sub: 'Desk job / little exercise' },
  { id: 'light', label: 'Light', sub: '1–3 workouts / week' },
  { id: 'moderate', label: 'Moderate', sub: '3–5 workouts / week' },
  { id: 'active', label: 'Active', sub: '6–7 workouts / week' },
  { id: 'very_active', label: 'Very Active', sub: 'Athlete / physical labor' },
];

const GOALS = [
  { id: 'lose', label: 'Lose Weight', sub: '−20% calorie deficit' },
  { id: 'maintain', label: 'Maintain', sub: 'Baseline maintenance' },
  { id: 'gain', label: 'Gain Muscle', sub: '+15% calorie surplus' },
];

const GENDERS = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'other', label: 'Other' },
];

const DIETARY_MODES = [
  { id: 'standard', label: 'Standard Balanced', sub: '25% Protein · 25% Fat · 50% Carbs' },
  { id: 'high_protein', label: 'High Protein', sub: '35% Protein · 25% Fat · 40% Carbs' },
  { id: 'low_carb', label: 'Low Carb', sub: '30% Protein · 45% Fat · 25% Carbs' },
  { id: 'keto', label: 'Ketogenic (Keto)', sub: '25% Protein · 70% Fat · 5% Carbs' },
  { id: 'vegetarian', label: 'Vegetarian', sub: '20% Protein · 30% Fat · 50% Carbs' },
  { id: 'vegan', label: 'Plant-Based / Vegan', sub: '20% Protein · 25% Fat · 55% Carbs' },
];

const COMMON_ALLERGENS = [
  { id: 'peanuts', label: 'Peanuts' },
  { id: 'tree_nuts', label: 'Tree Nuts' },
  { id: 'shellfish', label: 'Shellfish' },
  { id: 'fish', label: 'Fish' },
  { id: 'eggs', label: 'Eggs' },
  { id: 'soy', label: 'Soy' },
  { id: 'gluten', label: 'Gluten / Wheat' },
  { id: 'dairy', label: 'Dairy / Milk' },
  { id: 'sesame', label: 'Sesame' },
];

export default function ProfileScreen({ navigation }: any) {
  const { setIsAdmin } = useContext(AuthContext);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [editing, setEditing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [showTDEE, setShowTDEE] = useState<boolean>(false);
  const [form, setForm] = useState<any>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [])
  );

  const loadProfile = async () => {
    try {
      const data = await api.getProfile();
      setProfile(data);
      setIsAdmin(!!data.is_admin);
      setForm({
        weight_kg: data.weight_kg ? String(data.weight_kg) : '',
        height_cm: data.height_cm ? String(data.height_cm) : '',
        age: data.age ? String(data.age) : '',
        gender: data.gender || 'male',
        activity_level: data.activity_level || 'moderate',
        goal: data.goal || 'maintain',
        dietary_mode: data.dietary_mode || 'standard',
        allergens: Array.isArray(data.allergens) ? data.allergens : [],
      });
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleAllergen = (allergenId: string) => {
    const current: string[] = Array.isArray(form.allergens) ? form.allergens : [];
    const exists = current.includes(allergenId);
    const next = exists
      ? current.filter((a) => a !== allergenId)
      : [...current, allergenId];
    setForm({ ...form, allergens: next });
  };

  const validateEditForm = (): boolean => {
    const errs: Record<string, string> = {};
    const w = parseFloat(form.weight_kg);
    if (form.weight_kg && (isNaN(w) || w < 20 || w > 300)) {
      errs.weight_kg = 'Weight must be between 20 and 300 kg';
    }
    const h = parseFloat(form.height_cm);
    if (form.height_cm && (isNaN(h) || h < 100 || h > 250)) {
      errs.height_cm = 'Height must be between 100 and 250 cm';
    }
    const a = parseInt(form.age);
    if (form.age && (isNaN(a) || a < 10 || a > 100)) {
      errs.age = 'Age must be between 10 and 100 years';
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validateEditForm()) return;
    setSaving(true);
    try {
      const payload: any = {
        gender: form.gender,
        activity_level: form.activity_level,
        goal: form.goal,
        dietary_mode: form.dietary_mode || 'standard',
        allergens: Array.isArray(form.allergens) ? form.allergens : [],
      };
      if (form.weight_kg) payload.weight_kg = parseFloat(form.weight_kg);
      if (form.height_cm) payload.height_cm = parseFloat(form.height_cm);
      if (form.age) payload.age = parseInt(form.age);

      const updated = await api.updateProfile(payload);
      setProfile(updated);
      setEditing(false);

      const newCal = updated.daily_targets?.calories;
      const msg = newCal ? `Targets updated: ${newCal} kcal/day` : 'Profile updated successfully';
      setToastMessage(msg);
      setTimeout(() => setToastMessage(null), 3000);

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } catch (e: any) {
      setModal({ title: 'Error', message: e.message || 'Failed to update profile' });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoutConfirm = () => {
    setModal({
      title: 'Log Out',
      message: 'Are you sure you want to log out of your account?',
      confirm: true,
      destructive: true,
      okLabel: 'Log Out',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        try {
          await api.logout();
        } catch {}
        setProfile(null);
        setIsAdmin(false);
        navigation.navigate('Home');
      },
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <AuthForm onSuccess={loadProfile} showModal={setModal} />
        <AppModal state={modal} onClose={() => setModal(null)} />
      </KeyboardAvoidingView>
    );
  }

  const targets = profile.daily_targets || {};

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.email}>{profile.email}</Text>

        {/* Daily Targets Card */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Daily Targets</Text>
          <View style={styles.targetGrid}>
            <TargetItem label="Calories" value={targets.calories} unit="kcal" />
            <TargetItem label="Protein" value={targets.protein} unit="g" />
            <TargetItem label="Fat" value={targets.fat} unit="g" />
            <TargetItem label="Carbs" value={targets.carbs} unit="g" />
          </View>

          {/* TDEE Breakdown Toggle */}
          <TouchableOpacity
            onPress={() => setShowTDEE(!showTDEE)}
            style={styles.tdeeToggleRow}
            activeOpacity={0.7}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.tdeeToggleText}>
              {showTDEE ? 'Hide calculation details' : 'How are these calculated?'}
            </Text>
          </TouchableOpacity>

          {showTDEE && (
            <View style={styles.tdeeExplainerBox}>
              <Text style={styles.tdeeExplainerLine}>
                • <Text style={{ fontFamily: fonts.bodySemiBold }}>BMR</Text> uses the Mifflin-St Jeor formula based on your body weight, height, age, and biological sex.
              </Text>
              <Text style={styles.tdeeExplainerLine}>
                • <Text style={{ fontFamily: fonts.bodySemiBold }}>TDEE</Text> multiplies BMR by your physical activity level.
              </Text>
              <Text style={styles.tdeeExplainerLine}>
                • <Text style={{ fontFamily: fonts.bodySemiBold }}>Goal Adjustment</Text>: −20% deficit for weight loss, +15% surplus for muscle gain.
              </Text>
              <Text style={styles.tdeeExplainerLine}>
                • <Text style={{ fontFamily: fonts.bodySemiBold }}>Balanced Macros</Text>: 25% Protein, 25% Healthy Fat, 50% Complex Carbs.
              </Text>
            </View>
          )}
        </View>

        {/* Body Stats Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.sectionLabel}>Body Stats & Goals</Text>
            <TouchableOpacity
              onPress={() => setEditing(!editing)}
              activeOpacity={0.7}
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.editBtn}>{editing ? 'Cancel' : 'Edit'}</Text>
            </TouchableOpacity>
          </View>

          {editing ? (
            <View>
              {/* Weight */}
              <View style={styles.fieldWrapper}>
                <Text style={styles.fieldLabel}>Weight</Text>
                <View style={styles.inputWithSuffix}>
                  <TextInput
                    style={styles.suffixInput}
                    value={form.weight_kg}
                    onChangeText={(v) => {
                      setForm({ ...form, weight_kg: v });
                      if (fieldErrors.weight_kg) setFieldErrors({ ...fieldErrors, weight_kg: '' });
                    }}
                    keyboardType="numeric"
                    placeholder="e.g. 70"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <Text style={styles.suffixText}>kg</Text>
                </View>
                {fieldErrors.weight_kg ? (
                  <Text style={styles.fieldErrorText}>{fieldErrors.weight_kg}</Text>
                ) : null}
              </View>

              {/* Height */}
              <View style={styles.fieldWrapper}>
                <Text style={styles.fieldLabel}>Height</Text>
                <View style={styles.inputWithSuffix}>
                  <TextInput
                    style={styles.suffixInput}
                    value={form.height_cm}
                    onChangeText={(v) => {
                      setForm({ ...form, height_cm: v });
                      if (fieldErrors.height_cm) setFieldErrors({ ...fieldErrors, height_cm: '' });
                    }}
                    keyboardType="numeric"
                    placeholder="e.g. 175"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <Text style={styles.suffixText}>cm</Text>
                </View>
                {fieldErrors.height_cm ? (
                  <Text style={styles.fieldErrorText}>{fieldErrors.height_cm}</Text>
                ) : null}
              </View>

              {/* Age */}
              <View style={styles.fieldWrapper}>
                <Text style={styles.fieldLabel}>Age</Text>
                <View style={styles.inputWithSuffix}>
                  <TextInput
                    style={styles.suffixInput}
                    value={form.age}
                    onChangeText={(v) => {
                      setForm({ ...form, age: v });
                      if (fieldErrors.age) setFieldErrors({ ...fieldErrors, age: '' });
                    }}
                    keyboardType="numeric"
                    placeholder="e.g. 25"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <Text style={styles.suffixText}>years</Text>
                </View>
                {fieldErrors.age ? (
                  <Text style={styles.fieldErrorText}>{fieldErrors.age}</Text>
                ) : null}
              </View>

              {/* Activity Level */}
              <Text style={styles.fieldLabel}>Activity Level</Text>
              <View style={styles.chipStack}>
                {ACTIVITY_LEVELS.map((lvl) => {
                  const isSelected = form.activity_level === lvl.id;
                  return (
                    <TouchableOpacity
                      key={lvl.id}
                      style={[styles.descriptiveChip, isSelected && styles.descriptiveChipActive]}
                      onPress={() => setForm({ ...form, activity_level: lvl.id })}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.descriptiveChipTitle, isSelected && styles.descriptiveChipTitleActive]}>
                        {lvl.label}
                      </Text>
                      <Text style={[styles.descriptiveChipSub, isSelected && styles.descriptiveChipSubActive]}>
                        {lvl.sub}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Goal */}
              <Text style={styles.fieldLabel}>Dietary Goal</Text>
              <View style={styles.chipStack}>
                {GOALS.map((g) => {
                  const isSelected = form.goal === g.id;
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={[styles.descriptiveChip, isSelected && styles.descriptiveChipActive]}
                      onPress={() => setForm({ ...form, goal: g.id })}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.descriptiveChipTitle, isSelected && styles.descriptiveChipTitleActive]}>
                        {g.label}
                      </Text>
                      <Text style={[styles.descriptiveChipSub, isSelected && styles.descriptiveChipSubActive]}>
                        {g.sub}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Gender */}
              <Text style={styles.fieldLabel}>Biological Sex</Text>
              <View style={styles.genderRow}>
                {GENDERS.map((g) => {
                  const isSelected = form.gender === g.id;
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={[styles.genderChip, isSelected && styles.genderChipActive]}
                      onPress={() => setForm({ ...form, gender: g.id })}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.genderChipText, isSelected && styles.genderChipTextActive]}>
                        {g.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Dietary Mode */}
              <Text style={styles.fieldLabel}>Dietary Mode (Macro Split)</Text>
              <View style={styles.chipStack}>
                {DIETARY_MODES.map((dm) => {
                  const isSelected = (form.dietary_mode || 'standard') === dm.id;
                  return (
                    <TouchableOpacity
                      key={dm.id}
                      style={[styles.descriptiveChip, isSelected && styles.descriptiveChipActive]}
                      onPress={() => setForm({ ...form, dietary_mode: dm.id })}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.descriptiveChipTitle, isSelected && styles.descriptiveChipTitleActive]}>
                        {dm.label}
                      </Text>
                      <Text style={[styles.descriptiveChipSub, isSelected && styles.descriptiveChipSubActive]}>
                        {dm.sub}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Allergens */}
              <Text style={styles.fieldLabel}>Food Allergies & Restrictions</Text>
              <Text style={styles.allergenHelperText}>
                We will alert you when a scanned dish contains any of your selected allergens.
              </Text>
              <View style={styles.allergenChipsWrap}>
                {COMMON_ALLERGENS.map((alg) => {
                  const selected = Array.isArray(form.allergens) && form.allergens.includes(alg.id);
                  return (
                    <TouchableOpacity
                      key={alg.id}
                      style={[styles.allergenChip, selected && styles.allergenChipActive]}
                      onPress={() => toggleAllergen(alg.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.allergenChipText, selected && styles.allergenChipTextActive]}>
                        {selected ? `⚠ ${alg.label}` : alg.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.btnPrimary, saving && { opacity: 0.7 }]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <StatRow label="Weight" value={profile.weight_kg ? `${profile.weight_kg} kg` : '—'} />
              <StatRow label="Height" value={profile.height_cm ? `${profile.height_cm} cm` : '—'} />
              <StatRow label="Age" value={profile.age ? `${profile.age} years` : '—'} />
              <StatRow label="Biological Sex" value={profile.gender ? capitalize(profile.gender) : '—'} />
              <StatRow label="Activity Level" value={formatActivity(profile.activity_level)} />
              <StatRow label="Goal" value={formatGoal(profile.goal)} />
              <StatRow label="Dietary Mode" value={formatDietaryMode(profile.dietary_mode)} />
              <StatRow label="Allergies" value={formatAllergens(profile.allergens)} />
            </View>
          )}
        </View>

        {/* Logout Button */}
        <TouchableOpacity style={styles.btnLogout} onPress={handleLogoutConfirm} activeOpacity={0.7}>
          <Text style={styles.btnLogoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Floating Notification Toast */}
      {toastMessage && (
        <View style={styles.toastFloating}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}

      <AppModal state={modal} onClose={() => setModal(null)} />
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Auth Form Component
// ---------------------------------------------------------------------------
function AuthForm({
  onSuccess,
  showModal,
}: {
  onSuccess: () => void;
  showModal: (s: ModalState) => void;
}) {
  const { setIsAdmin } = useContext(AuthContext);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const passwordInputRef = useRef<TextInput>(null);

  // Body stats captured at registration
  const [regForm, setRegForm] = useState({
    weight_kg: '',
    height_cm: '',
    age: '',
    gender: 'male',
    activity_level: 'moderate',
    goal: 'maintain',
  });

  const validate = (): boolean => {
    const errs: { email?: string; password?: string } = {};
    if (!email.trim()) {
      errs.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email.trim())) {
      errs.email = 'Please enter a valid email address';
    }

    if (!password) {
      errs.password = 'Password is required';
    } else if (!isLogin && password.length < 8) {
      errs.password = 'Password must be at least 8 characters';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);

    try {
      if (isLogin) {
        const user = await api.login(email.trim(), password);
        setIsAdmin(!!user.is_admin);
      } else {
        await api.register(email.trim(), password, {
          weight_kg: parseFloat(regForm.weight_kg) || undefined,
          height_cm: parseFloat(regForm.height_cm) || undefined,
          age: parseInt(regForm.age) || undefined,
          gender: regForm.gender,
          activity_level: regForm.activity_level,
          goal: regForm.goal,
        });

        try {
          const profile = await api.getProfile();
          setIsAdmin(!!profile.is_admin);
        } catch {
          setIsAdmin(false);
        }
      }
      onSuccess();
    } catch (e: any) {
      const msg = e.message || '';
      let friendlyTitle = 'Authentication Error';
      let friendlyMsg = msg;

      if (/401|invalid credentials|wrong/i.test(msg)) {
        friendlyTitle = 'Sign In Failed';
        friendlyMsg = 'Incorrect email or password. Please try again.';
      } else if (/409|already exists|registered/i.test(msg)) {
        friendlyTitle = 'Account Exists';
        friendlyMsg = 'An account with this email already exists. Please log in.';
      } else if (/network|server|timeout|fetch/i.test(msg)) {
        friendlyTitle = 'Server Unreachable';
        friendlyMsg = 'Cannot reach the server. Please check your internet connection.';
      }

      showModal({ title: friendlyTitle, message: friendlyMsg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.authContainer}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.authTitle}>{isLogin ? 'Welcome Back' : 'Create Account'}</Text>
      <Text style={styles.authSubtitle}>
        {isLogin
          ? 'Sign in to access your meal logs and nutrition goals'
          : 'Set up your profile to receive personalized daily targets'}
      </Text>

      {/* Email Input */}
      <View style={styles.fieldWrapper}>
        <Text style={styles.fieldLabel}>Email Address</Text>
        <TextInput
          style={[styles.input, errors.email ? styles.inputError : null]}
          placeholder="you@example.com"
          placeholderTextColor={colors.textSecondary}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (errors.email) setErrors({ ...errors, email: undefined });
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordInputRef.current?.focus()}
        />
        {errors.email ? <Text style={styles.fieldErrorText}>{errors.email}</Text> : null}
      </View>

      {/* Password Input */}
      <View style={styles.fieldWrapper}>
        <View style={styles.passwordLabelRow}>
          <Text style={styles.fieldLabel}>Password</Text>
          <TouchableOpacity
            onPress={() => setShowPassword(!showPassword)}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.showHideText}>{showPassword ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          ref={passwordInputRef}
          style={[styles.input, errors.password ? styles.inputError : null]}
          placeholder={isLogin ? 'Enter your password' : 'At least 8 characters'}
          placeholderTextColor={colors.textSecondary}
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (errors.password) setErrors({ ...errors, password: undefined });
          }}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          textContentType={isLogin ? 'password' : 'newPassword'}
          returnKeyType={isLogin ? 'go' : 'next'}
          onSubmitEditing={isLogin ? handleSubmit : undefined}
        />
        {errors.password ? <Text style={styles.fieldErrorText}>{errors.password}</Text> : null}
      </View>

      {/* Registration-only Body Stats */}
      {!isLogin && (
        <View style={styles.regStatsSection}>
          <Text style={[styles.sectionLabel, { marginTop: spacing.sm }]}>
            Body Stats (Optional)
          </Text>

          <View style={styles.fieldWrapper}>
            <Text style={styles.fieldLabel}>Weight (kg)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 70"
              placeholderTextColor={colors.textSecondary}
              value={regForm.weight_kg}
              onChangeText={(v) => setRegForm({ ...regForm, weight_kg: v })}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.fieldWrapper}>
            <Text style={styles.fieldLabel}>Height (cm)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 175"
              placeholderTextColor={colors.textSecondary}
              value={regForm.height_cm}
              onChangeText={(v) => setRegForm({ ...regForm, height_cm: v })}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.fieldWrapper}>
            <Text style={styles.fieldLabel}>Age</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 25"
              placeholderTextColor={colors.textSecondary}
              value={regForm.age}
              onChangeText={(v) => setRegForm({ ...regForm, age: v })}
              keyboardType="numeric"
            />
          </View>
        </View>
      )}

      {/* Submit Button */}
      <TouchableOpacity
        style={[styles.btnPrimary, loading && { opacity: 0.7 }]}
        onPress={handleSubmit}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.btnPrimaryText}>{isLogin ? 'Log In' : 'Create Account'}</Text>
        )}
      </TouchableOpacity>

      {/* Switch Auth Mode */}
      <TouchableOpacity
        onPress={() => {
          setIsLogin(!isLogin);
          setErrors({});
        }}
        style={styles.switchAuthBtn}
        activeOpacity={0.7}
      >
        <Text style={styles.switchAuthText}>
          {isLogin
            ? "Don't have an account? Create one"
            : 'Already have an account? Log In'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Helpers & Subcomponents
// ---------------------------------------------------------------------------
function capitalize(str: string): string {
  if (!str) return '—';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatActivity(lvl?: string): string {
  const match = ACTIVITY_LEVELS.find((a) => a.id === lvl);
  return match ? `${match.label} (${match.sub})` : '—';
}

function formatGoal(goal?: string): string {
  const match = GOALS.find((g) => g.id === goal);
  return match ? `${match.label} (${match.sub})` : '—';
}

function formatDietaryMode(mode?: string): string {
  const match = DIETARY_MODES.find((d) => d.id === (mode || 'standard'));
  return match ? match.label : capitalize(mode || 'standard');
}

function formatAllergens(allergens?: string[]): string {
  if (!Array.isArray(allergens) || allergens.length === 0) return 'None';
  return allergens
    .map((id) => COMMON_ALLERGENS.find((a) => a.id === id)?.label || capitalize(id))
    .join(', ');
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function TargetItem({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <View style={styles.targetItem}>
      <Text style={styles.targetValue}>{value || 0}</Text>
      <Text style={styles.targetUnit}>{unit}</Text>
      <Text style={styles.targetLabel}>{label}</Text>
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 32,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  email: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },

  // Card & Layout
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  editBtn: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },

  // Daily Targets
  targetGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  targetItem: {
    alignItems: 'center',
    flex: 1,
  },
  targetValue: {
    fontSize: 22,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  targetUnit: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  targetLabel: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  tdeeToggleRow: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  tdeeToggleText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
  },
  tdeeExplainerBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radii.card,
  },
  tdeeExplainerLine: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 4,
  },

  // Stat Rows
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statLabel: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  statValue: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
    maxWidth: '65%',
    textAlign: 'right',
  },

  // Forms & Inputs
  fieldWrapper: {
    marginBottom: spacing.sm + 4,
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  inputError: {
    borderColor: colors.error,
  },
  fieldErrorText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.error,
    marginTop: 4,
  },
  inputWithSuffix: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
  },
  suffixInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textPrimary,
  },
  suffixText: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },

  // Descriptive Chips
  chipStack: {
    gap: 6,
    marginBottom: spacing.md,
    marginTop: 2,
  },
  descriptiveChip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  descriptiveChipActive: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.textPrimary,
  },
  descriptiveChipTitle: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  descriptiveChipTitleActive: {
    color: '#FFFFFF',
  },
  descriptiveChipSub: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 1,
  },
  descriptiveChipSubActive: {
    color: 'rgba(255, 255, 255, 0.8)',
  },

  // Gender Chips
  genderRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
    marginTop: 2,
  },
  genderChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  genderChipActive: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.textPrimary,
  },
  genderChipText: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    color: colors.textPrimary,
  },
  genderChipTextActive: {
    color: '#FFFFFF',
    fontFamily: fonts.bodySemiBold,
  },

  // Allergen Multi-Select Chips
  allergenHelperText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  allergenChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
    marginTop: 2,
  },
  allergenChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  allergenChipActive: {
    borderColor: colors.error,
    backgroundColor: 'rgba(185, 28, 28, 0.1)',
  },
  allergenChipText: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    color: colors.textPrimary,
  },
  allergenChipTextActive: {
    color: colors.error,
    fontFamily: fonts.bodySemiBold,
  },

  // Buttons
  btnPrimary: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },
  btnLogout: {
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  btnLogoutText: {
    color: colors.error,
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },

  // Auth Screen
  authContainer: {
    padding: spacing.xl,
    paddingTop: spacing.xxl,
  },
  authTitle: {
    fontSize: 28,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  authSubtitle: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  showHideText: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  regStatsSection: {
    marginVertical: spacing.xs,
  },
  switchAuthBtn: {
    marginTop: spacing.lg,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  switchAuthText: {
    fontSize: 14,
    fontFamily: fonts.bodyMedium,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },

  // Toast
  toastFloating: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.textPrimary,
    borderRadius: radii.card,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
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
});
