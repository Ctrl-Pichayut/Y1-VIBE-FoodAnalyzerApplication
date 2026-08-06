/**
 * ProfileScreen — User profile, daily targets, TDEE settings, and auth.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TextInput, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radii } from '../theme/tokens';
import * as api from '../services/api';
import AppModal, { ModalState } from '../components/AppModal';

const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
const GOALS = ['lose', 'maintain', 'gain'];
const GENDERS = ['male', 'female', 'other'];

export default function ProfileScreen({ navigation }: any) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [modal, setModal] = useState<ModalState | null>(null);

  useFocusEffect(useCallback(() => {
    loadProfile();
  }, []));

  const loadProfile = async () => {
    try {
      const data = await api.getProfile();
      setProfile(data);
      setForm(data);
    } catch {
      // Not logged in
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const updated = await api.updateProfile({
        weight_kg: parseFloat(form.weight_kg) || null,
        height_cm: parseFloat(form.height_cm) || null,
        age: parseInt(form.age) || null,
        gender: form.gender || null,
        activity_level: form.activity_level,
        goal: form.goal,
      });
      setProfile(updated);
      setEditing(false);
      setModal({ title: 'Saved', message: 'Profile updated successfully' });
    } catch (e: any) {
      setModal({ title: 'Error', message: e.message });
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setModal({ title: 'Logged out', message: 'You have been logged out' });
  };

  if (loading) {
    return (
      <>
        <View style={styles.center}><ActivityIndicator size="large" /></View>
        <AppModal state={modal} onClose={() => setModal(null)} />
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <AuthForm onSuccess={loadProfile} showModal={setModal} />
        <AppModal state={modal} onClose={() => setModal(null)} />
      </>
    );
  }

  const targets = profile.daily_targets || {};

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.email}>{profile.email}</Text>

      {/* Daily Targets Card */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Daily targets</Text>
        <View style={styles.targetGrid}>
          <TargetItem label="Calories" value={targets.calories} unit="kcal" />
          <TargetItem label="Protein" value={targets.protein} unit="g" />
          <TargetItem label="Fat" value={targets.fat} unit="g" />
          <TargetItem label="Carbs" value={targets.carbs} unit="g" />
        </View>
      </View>

      {/* Body Stats Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.sectionLabel}>Body stats</Text>
          <TouchableOpacity onPress={() => setEditing(!editing)}>
            <Text style={styles.editBtn}>{editing ? 'Cancel' : 'Edit'}</Text>
          </TouchableOpacity>
        </View>

        {editing ? (
          <View>
            <FieldInput label="Weight (kg)" value={String(form.weight_kg || '')}
              onChange={(v: string) => setForm({...form, weight_kg: v})} />
            <FieldInput label="Height (cm)" value={String(form.height_cm || '')}
              onChange={(v: string) => setForm({...form, height_cm: v})} />
            <FieldInput label="Age" value={String(form.age || '')}
              onChange={(v: string) => setForm({...form, age: v})} />

            <Text style={styles.fieldLabel}>Activity Level</Text>
            <View style={styles.chipRow}>
              {ACTIVITY_LEVELS.map(lvl => (
                <TouchableOpacity key={lvl}
                  style={[styles.chip, form.activity_level === lvl && styles.chipActive]}
                  onPress={() => setForm({...form, activity_level: lvl})}>
                  <Text style={[styles.chipText, form.activity_level === lvl && styles.chipTextActive]}>
                    {lvl.replace('_', ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Goal</Text>
            <View style={styles.chipRow}>
              {GOALS.map(g => (
                <TouchableOpacity key={g}
                  style={[styles.chip, form.goal === g && styles.chipActive]}
                  onPress={() => setForm({...form, goal: g})}>
                  <Text style={[styles.chipText, form.goal === g && styles.chipTextActive]}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Gender</Text>
            <View style={styles.chipRow}>
              {GENDERS.map(g => (
                <TouchableOpacity key={g}
                  style={[styles.chip, form.gender === g && styles.chipActive]}
                  onPress={() => setForm({...form, gender: g})}>
                  <Text style={[styles.chipText, form.gender === g && styles.chipTextActive]}>
                    {g}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.btnPrimary} onPress={handleSave}>
              <Text style={styles.btnPrimaryText}>Save Changes</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <StatRow label="Weight" value={profile.weight_kg ? `${profile.weight_kg} kg` : '—'} />
            <StatRow label="Height" value={profile.height_cm ? `${profile.height_cm} cm` : '—'} />
            <StatRow label="Age" value={profile.age ? String(profile.age) : '—'} />
            <StatRow label="Gender" value={profile.gender ? profile.gender : '—'} />
            <StatRow label="Activity" value={profile.activity_level?.replace('_', ' ') || '—'} />
            <StatRow label="Goal" value={profile.goal || '—'} />
          </View>
        )}
      </View>

      <TouchableOpacity style={styles.btnSecondary} onPress={handleLogout}>
        <Text style={styles.btnSecondaryText}>Log Out</Text>
      </TouchableOpacity>

      <View style={{ height: spacing.xxl }} />
    </ScrollView>
    <AppModal state={modal} onClose={() => setModal(null)} />
    </>
  );
}

function AuthForm({ onSuccess, showModal }: { onSuccess: () => void; showModal: (s: ModalState) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // Optional body stats — captured at registration so TDEE targets are real
  // from day one. Login ignores these and signs in with email + password.
  const [form, setForm] = useState<any>({
    weight_kg: '', height_cm: '', age: '',
    gender: 'male', activity_level: 'moderate', goal: 'maintain',
  });

  const handleSubmit = async () => {
    if (!email || !password) {
      showModal({ title: 'Error', message: 'Fill in email and password' });
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        await api.login(email, password);
      } else {
        await api.register(email, password, {
          weight_kg: parseFloat(form.weight_kg) || undefined,
          height_cm: parseFloat(form.height_cm) || undefined,
          age: parseInt(form.age) || undefined,
          gender: form.gender,
          activity_level: form.activity_level,
          goal: form.goal,
        });
      }
      onSuccess();
    } catch (e: any) {
      showModal({ title: 'Error', message: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.authScroll} contentContainerStyle={styles.authContainer}>
      <Text style={styles.authTitle}>{isLogin ? 'Welcome back' : 'Create account'}</Text>
      {!isLogin && (
        <Text style={styles.authHint}>
          Fill in your body stats for accurate daily targets. You can change them later.
        </Text>
      )}
      <TextInput style={styles.input} placeholder="Email" value={email}
        onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"
        placeholderTextColor={colors.textSecondary} />
      <TextInput style={styles.input} placeholder="Password" value={password}
        onChangeText={setPassword} secureTextEntry
        placeholderTextColor={colors.textSecondary} />

      {/* Body stats — registration only */}
      {!isLogin && (
        <View style={styles.authSection}>
          <FieldInput label="Weight (kg)" value={form.weight_kg}
            onChange={(v: string) => setForm({...form, weight_kg: v})} />
          <FieldInput label="Height (cm)" value={form.height_cm}
            onChange={(v: string) => setForm({...form, height_cm: v})} />
          <FieldInput label="Age" value={form.age}
            onChange={(v: string) => setForm({...form, age: v})} />

          <Text style={styles.fieldLabel}>Gender</Text>
          <View style={styles.chipRow}>
            {GENDERS.map(g => (
              <TouchableOpacity key={g}
                style={[styles.chip, form.gender === g && styles.chipActive]}
                onPress={() => setForm({...form, gender: g})}>
                <Text style={[styles.chipText, form.gender === g && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Activity Level</Text>
          <View style={styles.chipRow}>
            {ACTIVITY_LEVELS.map(lvl => (
              <TouchableOpacity key={lvl}
                style={[styles.chip, form.activity_level === lvl && styles.chipActive]}
                onPress={() => setForm({...form, activity_level: lvl})}>
                <Text style={[styles.chipText, form.activity_level === lvl && styles.chipTextActive]}>
                  {lvl.replace('_', ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Goal</Text>
          <View style={styles.chipRow}>
            {GOALS.map(g => (
              <TouchableOpacity key={g}
                style={[styles.chip, form.goal === g && styles.chipActive]}
                onPress={() => setForm({...form, goal: g})}>
                <Text style={[styles.chipText, form.goal === g && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.btnPrimary} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> :
          <Text style={styles.btnPrimaryText}>{isLogin ? 'Log In' : 'Register'}</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setIsLogin(!isLogin)} style={{ marginTop: spacing.md }}>
        <Text style={styles.switchAuth}>
          {isLogin ? "Don't have an account? Register" : 'Already have an account? Log In'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function FieldInput({ label, value, onChange }: any) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange}
        keyboardType="numeric" placeholderTextColor={colors.textSecondary} />
    </View>
  );
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { fontSize: 32, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.md },
  email: { fontSize: 15, color: colors.textSecondary, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.card,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: {
    fontSize: 13, fontWeight: '600', color: colors.textSecondary,
    letterSpacing: 0.3, marginBottom: spacing.sm,
  },
  editBtn: { fontSize: 14, fontWeight: '600', color: colors.accent },
  targetGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  targetItem: { alignItems: 'center', flex: 1 },
  targetValue: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  targetUnit: { fontSize: 11, color: colors.textSecondary },
  targetLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  statRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  statLabel: { fontSize: 15, color: colors.textSecondary },
  statValue: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.input, padding: spacing.md, fontSize: 16,
    color: colors.textPrimary, marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 8,
  },
  chipActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  chipText: { fontSize: 13, color: colors.textPrimary, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff' },
  btnPrimary: {
    backgroundColor: colors.textPrimary, borderRadius: radii.button,
    paddingVertical: 16, alignItems: 'center', marginTop: spacing.sm,
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: colors.surface, borderRadius: radii.button,
    borderWidth: 1, borderColor: colors.textPrimary,
    paddingVertical: 16, alignItems: 'center',
  },
  btnSecondaryText: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  authScroll: { flex: 1, backgroundColor: colors.background },
  authContainer: {
    flexGrow: 1, justifyContent: 'center',
    padding: spacing.xl, paddingVertical: spacing.xxl,
  },
  authSection: { marginVertical: spacing.md },
  authTitle: { fontSize: 32, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  authHint: {
    fontSize: 14, color: colors.textSecondary,
    lineHeight: 20, marginBottom: spacing.lg,
  },
  switchAuth: { fontSize: 14, color: colors.accent, textAlign: 'center' },
});
