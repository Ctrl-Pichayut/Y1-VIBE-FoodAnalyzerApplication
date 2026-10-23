/**
 * ProfileScreen — User profile, daily targets, TDEE settings, and auth.
 * Phase 4: Profile & Auth Polish
 *
 * Features:
 *   • Wrapped in KeyboardAvoidingView with keyboardShouldPersistTaps="handled".
 *   • Auth form: Log in / Sign up segmented switch, icon inputs with focus highlight,
 *     eye Show/Hide password toggle, returnKeyType chaining, autoComplete/textContentType,
 *     and inline validation messages.
 *   • Friendly error messages for auth (401, 409, network).
 *   • Body stats edit: range validation (weight 20-300kg, height 100-250cm, age 10-100),
 *     input unit suffixes, non-destructive payloads, and saving spinner state.
 *   • Targets updated toast after saving profile changes.
 *   • Confirmed 1-tap logout navigating directly to Home.
 *   • Radio-style descriptive cards for Activity Levels, Goals and Dietary Modes.
 *   • Smooth LayoutAnimation when expanding / switching sections.
 */
import React, { useState, useCallback, useContext, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TextInput, TextInputProps, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform, LayoutAnimation,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radii, fonts, shadows, macroColors } from '../theme/tokens';
import * as api from '../services/api';
import AppModal, { ModalState } from '../components/AppModal';
import { AuthContext } from '../context/AuthContext';
import { FadeInView, IconBubble, IconName, PressableScale, Toast } from '../components/ui';

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

/** Ease the next layout change (expand / collapse / swap) instead of jumping. */
function animateLayout() {
  LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
}

export default function ProfileScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
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
    Haptics.selectionAsync().catch(() => {});
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
      animateLayout();
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
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!profile) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <AuthForm onSuccess={loadProfile} showModal={setModal} topInset={insets.top} />
        <AppModal state={modal} onClose={() => setModal(null)} />
      </KeyboardAvoidingView>
    );
  }

  const targets = profile.daily_targets || {};
  const initial = (profile.email || '?').charAt(0).toUpperCase();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          paddingTop: insets.top + spacing.md,
          paddingBottom: spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <FadeInView style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Profile</Text>
            <Text style={styles.email} numberOfLines={1}>{profile.email}</Text>
          </View>
          {profile.is_admin ? (
            <View style={styles.adminBadge}>
              <Ionicons name="shield-checkmark" size={12} color={colors.accent} />
              <Text style={styles.adminBadgeText}>Admin</Text>
            </View>
          ) : null}
        </FadeInView>

        {/* Daily Targets Card */}
        <FadeInView delay={60} style={styles.card}>
          <Text style={styles.sectionLabel}>Daily targets</Text>
          <View style={styles.targetGrid}>
            <TargetItem icon="flame" color={colors.moderate} label="Calories" value={targets.calories} unit="kcal" />
            <TargetItem icon="barbell-outline" color={macroColors.protein} label="Protein" value={targets.protein} unit="g" />
            <TargetItem icon="water-outline" color={macroColors.fat} label="Fat" value={targets.fat} unit="g" />
            <TargetItem icon="leaf-outline" color={macroColors.carbs} label="Carbs" value={targets.carbs} unit="g" />
          </View>

          {/* TDEE Breakdown Toggle */}
          <Pressable
            onPress={() => {
              animateLayout();
              setShowTDEE(!showTDEE);
            }}
            style={styles.tdeeToggleRow}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="calculator-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.tdeeToggleText}>
              {showTDEE ? 'Hide calculation details' : 'How are these calculated?'}
            </Text>
            <Ionicons
              name={showTDEE ? 'chevron-up' : 'chevron-down'}
              size={15}
              color={colors.textSecondary}
            />
          </Pressable>

          {showTDEE && (
            <View style={styles.tdeeExplainerBox}>
              <ExplainerLine title="BMR">
                uses the Mifflin-St Jeor formula based on your body weight, height, age, and biological sex.
              </ExplainerLine>
              <ExplainerLine title="TDEE">multiplies BMR by your physical activity level.</ExplainerLine>
              <ExplainerLine title="Goal Adjustment">
                −20% deficit for weight loss, +15% surplus for muscle gain.
              </ExplainerLine>
              <ExplainerLine title="Balanced Macros">
                25% Protein, 25% Healthy Fat, 50% Complex Carbs.
              </ExplainerLine>
            </View>
          )}
        </FadeInView>

        {/* Body Stats Card */}
        <FadeInView delay={120} style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>Body stats & goals</Text>
            <PressableScale
              onPress={() => {
                animateLayout();
                setEditing(!editing);
              }}
              style={[styles.editBtn, editing && styles.editBtnActive]}
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={editing ? 'close' : 'create-outline'}
                size={15}
                color={editing ? colors.textSecondary : colors.accent}
              />
              <Text style={[styles.editBtnText, editing && { color: colors.textSecondary }]}>
                {editing ? 'Cancel' : 'Edit'}
              </Text>
            </PressableScale>
          </View>

          {editing ? (
            <View>
              <View style={styles.fieldRow}>
                {/* Weight */}
                <View style={[styles.fieldWrapper, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Weight</Text>
                  <FocusInput
                    value={form.weight_kg}
                    onChangeText={(v) => {
                      setForm({ ...form, weight_kg: v });
                      if (fieldErrors.weight_kg) setFieldErrors({ ...fieldErrors, weight_kg: '' });
                    }}
                    keyboardType="numeric"
                    placeholder="70"
                    suffix="kg"
                    hasError={!!fieldErrors.weight_kg}
                  />
                </View>

                {/* Height */}
                <View style={[styles.fieldWrapper, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Height</Text>
                  <FocusInput
                    value={form.height_cm}
                    onChangeText={(v) => {
                      setForm({ ...form, height_cm: v });
                      if (fieldErrors.height_cm) setFieldErrors({ ...fieldErrors, height_cm: '' });
                    }}
                    keyboardType="numeric"
                    placeholder="175"
                    suffix="cm"
                    hasError={!!fieldErrors.height_cm}
                  />
                </View>

                {/* Age */}
                <View style={[styles.fieldWrapper, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Age</Text>
                  <FocusInput
                    value={form.age}
                    onChangeText={(v) => {
                      setForm({ ...form, age: v });
                      if (fieldErrors.age) setFieldErrors({ ...fieldErrors, age: '' });
                    }}
                    keyboardType="numeric"
                    placeholder="25"
                    suffix="yrs"
                    hasError={!!fieldErrors.age}
                  />
                </View>
              </View>
              {[fieldErrors.weight_kg, fieldErrors.height_cm, fieldErrors.age]
                .filter(Boolean)
                .map((err) => (
                  <Text key={err} style={styles.fieldErrorText}>{err}</Text>
                ))}

              {/* Gender */}
              <Text style={[styles.fieldLabel, styles.groupLabel]}>Biological Sex</Text>
              <View style={styles.genderRow}>
                {GENDERS.map((g) => {
                  const isSelected = form.gender === g.id;
                  return (
                    <Pressable
                      key={g.id}
                      style={[styles.genderChip, isSelected && styles.genderChipActive]}
                      onPress={() => setForm({ ...form, gender: g.id })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text style={[styles.genderChipText, isSelected && styles.genderChipTextActive]}>
                        {g.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Activity Level */}
              <Text style={[styles.fieldLabel, styles.groupLabel]}>Activity Level</Text>
              <View style={styles.chipStack}>
                {ACTIVITY_LEVELS.map((lvl) => (
                  <ChoiceCard
                    key={lvl.id}
                    label={lvl.label}
                    sub={lvl.sub}
                    selected={form.activity_level === lvl.id}
                    onPress={() => setForm({ ...form, activity_level: lvl.id })}
                  />
                ))}
              </View>

              {/* Goal */}
              <Text style={[styles.fieldLabel, styles.groupLabel]}>Dietary Goal</Text>
              <View style={styles.chipStack}>
                {GOALS.map((g) => (
                  <ChoiceCard
                    key={g.id}
                    label={g.label}
                    sub={g.sub}
                    selected={form.goal === g.id}
                    onPress={() => setForm({ ...form, goal: g.id })}
                  />
                ))}
              </View>

              {/* Dietary Mode */}
              <Text style={[styles.fieldLabel, styles.groupLabel]}>Dietary Mode (Macro Split)</Text>
              <View style={styles.chipStack}>
                {DIETARY_MODES.map((dm) => (
                  <ChoiceCard
                    key={dm.id}
                    label={dm.label}
                    sub={dm.sub}
                    selected={(form.dietary_mode || 'standard') === dm.id}
                    onPress={() => setForm({ ...form, dietary_mode: dm.id })}
                  />
                ))}
              </View>

              {/* Allergens */}
              <Text style={[styles.fieldLabel, styles.groupLabel]}>Food Allergies & Restrictions</Text>
              <Text style={styles.allergenHelperText}>
                We will alert you when a scanned dish contains any of your selected allergens.
              </Text>
              <View style={styles.allergenChipsWrap}>
                {COMMON_ALLERGENS.map((alg) => {
                  const selected = Array.isArray(form.allergens) && form.allergens.includes(alg.id);
                  return (
                    <PressableScale
                      key={alg.id}
                      style={[styles.allergenChip, selected && styles.allergenChipActive]}
                      onPress={() => toggleAllergen(alg.id)}
                      scaleTo={0.94}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                    >
                      {selected ? (
                        <Ionicons name="alert-circle" size={14} color={colors.error} />
                      ) : null}
                      <Text style={[styles.allergenChipText, selected && styles.allergenChipTextActive]}>
                        {alg.label}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>

              <PressableScale
                style={styles.btnPrimary}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.textOnDark} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color={colors.textOnDark} />
                    <Text style={styles.btnPrimaryText}>Save Changes</Text>
                  </>
                )}
              </PressableScale>
            </View>
          ) : (
            <View>
              <StatRow icon="scale-outline" label="Weight" value={profile.weight_kg ? `${profile.weight_kg} kg` : '—'} />
              <StatRow icon="resize-outline" label="Height" value={profile.height_cm ? `${profile.height_cm} cm` : '—'} />
              <StatRow icon="calendar-outline" label="Age" value={profile.age ? `${profile.age} years` : '—'} />
              <StatRow icon="person-outline" label="Biological Sex" value={profile.gender ? capitalize(profile.gender) : '—'} />
              <StatRow icon="walk-outline" label="Activity Level" value={formatActivity(profile.activity_level)} />
              <StatRow icon="flag-outline" label="Goal" value={formatGoal(profile.goal)} />
              <StatRow icon="pie-chart-outline" label="Dietary Mode" value={formatDietaryMode(profile.dietary_mode)} />
              <StatRow icon="alert-circle-outline" label="Allergies" value={formatAllergens(profile.allergens)} isLast />
            </View>
          )}
        </FadeInView>

        {/* Logout Button */}
        <FadeInView delay={180}>
          <PressableScale style={styles.btnLogout} onPress={handleLogoutConfirm}>
            <Ionicons name="log-out-outline" size={18} color={colors.error} />
            <Text style={styles.btnLogoutText}>Log Out</Text>
          </PressableScale>
        </FadeInView>
      </ScrollView>

      {/* Floating Notification Toast */}
      <Toast message={toastMessage} />

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
  topInset,
}: {
  onSuccess: () => void;
  showModal: (s: ModalState) => void;
  topInset: number;
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

  const switchMode = (login: boolean) => {
    if (login === isLogin) return;
    animateLayout();
    setIsLogin(login);
    setErrors({});
  };

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
      contentContainerStyle={[styles.authContainer, { paddingTop: topInset + spacing.xl }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <FadeInView>
        <View style={styles.authLogo}>
          <Ionicons name="nutrition" size={30} color={colors.textOnDark} />
        </View>
        <Text style={styles.authTitle}>{isLogin ? 'Welcome back' : 'Create account'}</Text>
        <Text style={styles.authSubtitle}>
          {isLogin
            ? 'Sign in to access your meal logs and nutrition goals'
            : 'Set up your profile to receive personalized daily targets'}
        </Text>

        {/* Log in / Sign up segmented switch */}
        <View style={styles.segment}>
          {[
            { login: true, label: 'Log in' },
            { login: false, label: 'Sign up' },
          ].map((opt) => {
            const active = isLogin === opt.login;
            return (
              <Pressable
                key={opt.label}
                onPress={() => switchMode(opt.login)}
                style={[styles.segmentOpt, active && styles.segmentOptActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Email Input */}
        <View style={styles.fieldWrapper}>
          <Text style={styles.fieldLabel}>Email Address</Text>
          <FocusInput
            icon="mail-outline"
            placeholder="you@example.com"
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
            hasError={!!errors.email}
          />
          {errors.email ? <Text style={styles.fieldErrorText}>{errors.email}</Text> : null}
        </View>

        {/* Password Input */}
        <View style={styles.fieldWrapper}>
          <Text style={styles.fieldLabel}>Password</Text>
          <FocusInput
            ref={passwordInputRef}
            icon="lock-closed-outline"
            placeholder={isLogin ? 'Enter your password' : 'At least 8 characters'}
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
            hasError={!!errors.password}
            trailing={
              <Pressable
                onPress={() => setShowPassword(!showPassword)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textSecondary}
                />
              </Pressable>
            }
          />
          {errors.password ? <Text style={styles.fieldErrorText}>{errors.password}</Text> : null}
        </View>

        {/* Registration-only Body Stats */}
        {!isLogin && (
          <View style={styles.regStatsSection}>
            <Text style={[styles.sectionLabel, { marginTop: spacing.sm }]}>
              Body stats (optional)
            </Text>

            <View style={styles.fieldRow}>
              <View style={[styles.fieldWrapper, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Weight</Text>
                <FocusInput
                  placeholder="70"
                  value={regForm.weight_kg}
                  onChangeText={(v) => setRegForm({ ...regForm, weight_kg: v })}
                  keyboardType="numeric"
                  suffix="kg"
                />
              </View>

              <View style={[styles.fieldWrapper, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Height</Text>
                <FocusInput
                  placeholder="175"
                  value={regForm.height_cm}
                  onChangeText={(v) => setRegForm({ ...regForm, height_cm: v })}
                  keyboardType="numeric"
                  suffix="cm"
                />
              </View>

              <View style={[styles.fieldWrapper, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Age</Text>
                <FocusInput
                  placeholder="25"
                  value={regForm.age}
                  onChangeText={(v) => setRegForm({ ...regForm, age: v })}
                  keyboardType="numeric"
                  suffix="yrs"
                />
              </View>
            </View>
          </View>
        )}

        {/* Submit Button */}
        <PressableScale
          style={styles.btnPrimary}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.textOnDark} />
          ) : (
            <>
              <Text style={styles.btnPrimaryText}>{isLogin ? 'Log In' : 'Create Account'}</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.textOnDark} />
            </>
          )}
        </PressableScale>

        {/* Switch Auth Mode */}
        <Pressable
          onPress={() => switchMode(!isLogin)}
          style={styles.switchAuthBtn}
        >
          <Text style={styles.switchAuthText}>
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <Text style={styles.switchAuthLink}>{isLogin ? 'Create one' : 'Log in'}</Text>
          </Text>
        </Pressable>
      </FadeInView>
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

/**
 * TextInput on a muted surface that gains an accent border while focused.
 * Optional leading icon, trailing node (e.g. eye toggle) and unit suffix.
 */
function FocusInput({
  icon,
  suffix,
  trailing,
  hasError,
  ref,
  onFocus,
  onBlur,
  ...rest
}: TextInputProps & {
  icon?: IconName;
  suffix?: string;
  trailing?: React.ReactNode;
  hasError?: boolean;
  ref?: React.Ref<TextInput>;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.inputShell,
        focused && styles.inputShellFocused,
        hasError && styles.inputShellError,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={18}
          color={focused ? colors.accent : colors.textTertiary}
        />
      ) : null}
      <TextInput
        ref={ref}
        style={styles.inputField}
        placeholderTextColor={colors.textTertiary}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />
      {suffix ? <Text style={styles.suffixText}>{suffix}</Text> : null}
      {trailing}
    </View>
  );
}

function ChoiceCard({
  label,
  sub,
  selected,
  onPress,
}: {
  label: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.descriptiveChip,
        selected && styles.descriptiveChipActive,
        pressed && !selected && { backgroundColor: colors.surfaceMuted },
      ]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.descriptiveChipTitle, selected && styles.descriptiveChipTitleActive]}>
          {label}
        </Text>
        <Text style={styles.descriptiveChipSub}>{sub}</Text>
      </View>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20}
        color={selected ? colors.accent : colors.borderStrong}
      />
    </Pressable>
  );
}

function ExplainerLine({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.tdeeExplainerRow}>
      <View style={styles.tdeeBullet} />
      <Text style={styles.tdeeExplainerLine}>
        <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.textPrimary }}>{title}</Text>{' '}
        {children}
      </Text>
    </View>
  );
}

function StatRow({
  icon,
  label,
  value,
  isLast,
}: {
  icon: IconName;
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.statRow, !isLast && styles.statRowDivider]}>
      <Ionicons name={icon} size={18} color={colors.textSecondary} style={{ marginTop: 1 }} />
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function TargetItem({
  icon,
  color,
  label,
  value,
  unit,
}: {
  icon: IconName;
  color: string;
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <View style={styles.targetItem}>
      <IconBubble name={icon} size={34} color={color} background={colors.surface} />
      <Text style={styles.targetValue}>{value || 0}</Text>
      <Text style={styles.targetLabel}>
        {label} <Text style={styles.targetUnit}>{unit}</Text>
      </Text>
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

  // Header
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  avatarText: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.textOnDark,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: fonts.display,
    color: colors.textPrimary,
  },
  email: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  adminBadgeText: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: colors.accent,
  },

  // Card & Layout
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.md + 4,
    marginBottom: spacing.md,
    ...shadows.card,
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
    marginBottom: spacing.sm + 4,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accentSoft,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
  },
  editBtnActive: {
    backgroundColor: colors.surfaceMuted,
  },
  editBtnText: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.accent,
  },

  // Daily Targets
  targetGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  targetItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.button,
    paddingVertical: spacing.sm + 4,
  },
  targetValue: {
    fontSize: 19,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginTop: 6,
  },
  targetUnit: {
    fontSize: 10,
    fontFamily: fonts.body,
    color: colors.textTertiary,
  },
  targetLabel: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  tdeeToggleRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tdeeToggleText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
  },
  tdeeExplainerBox: {
    marginTop: spacing.sm + 4,
    padding: spacing.md - 2,
    backgroundColor: colors.background,
    borderRadius: radii.button,
    gap: 8,
  },
  tdeeExplainerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tdeeBullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: 7,
  },
  tdeeExplainerLine: {
    flex: 1,
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // Stat Rows
  statRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 2,
    paddingVertical: 12,
  },
  statRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  statLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  statValue: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
    maxWidth: '58%',
    textAlign: 'right',
  },

  // Forms & Inputs
  fieldRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fieldWrapper: {
    marginBottom: spacing.md - 2,
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
    marginBottom: 6,
  },
  groupLabel: {
    marginTop: spacing.sm,
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: radii.input,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md - 2,
  },
  inputShellFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  inputShellError: {
    borderColor: colors.error,
  },
  inputField: {
    flex: 1,
    minWidth: 0, // let the field shrink in narrow 3-column rows instead of pushing the suffix out
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textPrimary,
  },
  fieldErrorText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.error,
    marginTop: 4,
    marginBottom: 2,
  },
  suffixText: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: colors.textSecondary,
  },

  // Descriptive Choice Cards
  chipStack: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  descriptiveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 11,
    paddingHorizontal: spacing.md - 2,
    borderRadius: radii.input,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  descriptiveChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  descriptiveChipTitle: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  descriptiveChipTitleActive: {
    color: colors.accent,
  },
  descriptiveChipSub: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginTop: 1,
  },

  // Gender Segmented Control
  genderRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.input,
    padding: 3,
    marginBottom: spacing.md,
  },
  genderChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radii.input - 2,
    alignItems: 'center',
  },
  genderChipActive: {
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  genderChipText: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  genderChipTextActive: {
    color: colors.textPrimary,
    fontFamily: fonts.bodySemiBold,
  },

  // Allergen Multi-Select Chips
  allergenHelperText: {
    fontSize: 12,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  allergenChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  allergenChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  allergenChipActive: {
    borderColor: 'rgba(198, 40, 40, 0.4)',
    backgroundColor: colors.errorSoft,
  },
  allergenChipText: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    color: colors.textPrimary,
  },
  allergenChipTextActive: {
    color: colors.error,
    fontFamily: fonts.bodySemiBold,
  },

  // Buttons
  btnPrimary: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.ink,
    borderRadius: radii.button,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 52,
  },
  btnPrimaryText: {
    color: colors.textOnDark,
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
  btnLogout: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.errorSoft,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  btnLogoutText: {
    color: colors.error,
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },

  // Auth Screen
  authContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  authLogo: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadows.raised,
  },
  authTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  authSubtitle: {
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 21,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.button,
    padding: 4,
    marginBottom: spacing.lg,
  },
  segmentOpt: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.button - 3,
    alignItems: 'center',
  },
  segmentOptActive: {
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  segmentText: {
    fontSize: 14,
    fontFamily: fonts.bodyMedium,
    color: colors.textSecondary,
  },
  segmentTextActive: {
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
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  switchAuthLink: {
    fontFamily: fonts.bodySemiBold,
    color: colors.accent,
  },
});
