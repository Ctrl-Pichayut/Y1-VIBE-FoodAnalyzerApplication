/**
 * Food Intelligence Analyzer — Main App Entry
 * Tab navigation: Home | History | Scan | Profile (| Admin)
 * Icon tab bar with a raised centre Scan button and animated active state.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, View, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';

import { AuthContext } from './context/AuthContext';
export { AuthContext };

SplashScreen.preventAutoHideAsync().catch(() => {});

import HomeScreen from './screens/HomeScreen';
import ScanScreen from './screens/ScanScreen';
import ResultScreen from './screens/ResultScreen';
import HistoryScreen from './screens/HistoryScreen';
import ProfileScreen from './screens/ProfileScreen';
import AdminScreen from './screens/AdminScreen';

import { loadTokens, warmup, getProfile } from './services/api';
import { colors, fonts, radii, shadows, spacing } from './theme/tokens';
import { PressableScale, IconName } from './components/ui';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.background,
    primary: colors.accent,
    text: colors.textPrimary,
    border: colors.border,
  },
};

const stackOptions = {
  headerStyle: { backgroundColor: colors.background },
  headerShadowVisible: false,
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { fontFamily: fonts.display, fontSize: 18, color: colors.textPrimary },
  headerBackButtonDisplayMode: 'minimal' as const,
  contentStyle: { backgroundColor: colors.background },
  animation: 'slide_from_right' as const,
};

function ScanStack() {
  return (
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="ScanCamera" component={ScanScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Result" component={ResultScreen} options={{ title: 'Results', headerTitle: '' }} />
    </Stack.Navigator>
  );
}

function HistoryStack() {
  return (
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="HistoryList" component={HistoryScreen} options={{ headerShown: false }} />
      <Stack.Screen name="MealDetail" component={ResultScreen} options={{ title: 'Meal', headerTitle: '' }} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function AdminStack() {
  return (
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="AdminReview" component={AdminScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  Home: { active: 'home', inactive: 'home-outline' },
  History: { active: 'time', inactive: 'time-outline' },
  ScanTab: { active: 'scan', inactive: 'scan' },
  Profile: { active: 'person', inactive: 'person-outline' },
  Admin: { active: 'shield-checkmark', inactive: 'shield-checkmark-outline' },
};

/**
 * Custom tab bar — fully controlled so the active highlight is always
 * visible. We read `state.index` (always authoritative) for the active state
 * rather than relying on React Navigation's tabBarLabel `focused` propagation,
 * which proved unreliable on some devices/versions.
 */
function CustomTabBar({ state, descriptors, navigation }: any) {
  // Respect the system bottom inset (gesture-nav indicator / home pill) so
  // the bar sits above the OS UI instead of overlapping it.
  const insets = useSafeAreaInsets();

  return (
    <View style={[tabStyles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {state.routes.map((route: any, index: number) => {
        const { options } = descriptors[route.key];
        const label: string = options.tabBarLabel ?? options.title ?? route.name;
        const isFocused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            Haptics.selectionAsync().catch(() => {});
            navigation.navigate(route.name);
          }
        };

        if (route.name === 'ScanTab') {
          return (
            <ScanTabButton
              key={route.key}
              label={label}
              focused={isFocused}
              onPress={onPress}
            />
          );
        }

        return (
          <TabItem
            key={route.key}
            label={label}
            icons={TAB_ICONS[route.name] ?? { active: 'ellipse', inactive: 'ellipse-outline' }}
            focused={isFocused}
            onPress={onPress}
          />
        );
      })}
    </View>
  );
}

function TabItem({
  label,
  icons,
  focused,
  onPress,
}: {
  label: string;
  icons: { active: IconName; inactive: IconName };
  focused: boolean;
  onPress: () => void;
}) {
  const focus = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(focus, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 8,
    }).start();
  }, [focused, focus]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      style={tabStyles.tab}
    >
      <View style={tabStyles.iconWrap}>
        <Animated.View
          style={[
            tabStyles.iconPill,
            {
              opacity: focus,
              transform: [{ scaleX: focus.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
            },
          ]}
        />
        <Ionicons
          name={focused ? icons.active : icons.inactive}
          size={22}
          color={focused ? colors.accent : colors.textTertiary}
        />
      </View>
      <Text style={[tabStyles.label, focused && tabStyles.labelActive]}>{label}</Text>
    </Pressable>
  );
}

function ScanTabButton({
  label,
  focused,
  onPress,
}: {
  label: string;
  focused: boolean;
  onPress: () => void;
}) {
  return (
    <View style={tabStyles.tab}>
      <PressableScale
        onPress={onPress}
        scaleTo={0.9}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        style={[tabStyles.scanButton, focused && tabStyles.scanButtonActive]}
      >
        <Ionicons name="scan" size={26} color={colors.textOnDark} />
      </PressableScale>
      <Text style={[tabStyles.label, focused && tabStyles.labelActive]}>{label}</Text>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 6,
    ...shadows.bar,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 2,
  },
  iconWrap: {
    width: 56,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPill: {
    ...StyleSheet.absoluteFill,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 3,
  },
  labelActive: {
    fontFamily: fonts.bodySemiBold,
    color: colors.textPrimary,
  },
  scanButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    marginTop: -26,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.surface,
    ...shadows.raised,
  },
  scanButtonActive: {
    backgroundColor: colors.accent,
  },
});

export default function App() {
  // Boot gate: warm up the backend before showing the app. Render's free
  // tier sleeps after 15 min idle, so the first request on open can take
  // 30-60s while it wakes + reloads the model. Doing this up-front with an
  // honest loading screen is much better UX than every screen freezing.
  const [bootState, setBootState] = useState<'warming' | 'ready' | 'offline'>('warming');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadTokens();
      const ready = await warmup();
      if (cancelled) return;
      if (!ready) { setBootState('offline'); return; }

      // Fetch profile to determine admin status (gates the Admin tab).
      // Not being logged in is fine — admin tab just stays hidden.
      try {
        const profile = await getProfile();
        if (!cancelled) setIsAdmin(!!profile.is_admin);
      } catch { /* not logged in — not admin */ }

      if (!cancelled) setBootState('ready');
    })();
    return () => { cancelled = true; };
  }, []);

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  if (bootState !== 'ready') {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <BootScreen
          state={bootState}
          onRetry={() => {
            setBootState('warming');
            warmup().then((ok) => setBootState(ok ? 'ready' : 'offline'));
          }}
          onBypass={() => setBootState('ready')}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthContext.Provider value={{ isAdmin, setIsAdmin }}>
          <NavigationContainer theme={navTheme}>
            <StatusBar style="dark" />
            <Tab.Navigator
              tabBar={(props) => <CustomTabBar {...props} />}
              screenOptions={{
                headerShown: false,
                animation: 'fade',
              }}
            >
              <Tab.Screen
                name="Home"
                component={HomeScreen}
                options={{ title: 'Home', headerShown: false }}
              />
              <Tab.Screen name="History" component={HistoryStack} options={{ tabBarLabel: 'History' }} />
              <Tab.Screen name="ScanTab" component={ScanStack} options={{ tabBarLabel: 'Scan' }} />
              <Tab.Screen name="Profile" component={ProfileStack} options={{ tabBarLabel: 'Profile' }} />
              {isAdmin && (
                <Tab.Screen name="Admin" component={AdminStack} options={{ tabBarLabel: 'Admin' }} />
              )}
            </Tab.Navigator>
          </NavigationContainer>
        </AuthContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Boot screen — shown while the backend wakes from sleep, or if it can't be
 * reached. Keeps the user informed instead of showing frozen screens.
 */
function BootScreen({
  state,
  onRetry,
  onBypass,
}: {
  state: 'warming' | 'offline';
  onRetry: () => void;
  onBypass: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state !== 'warming') return;
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [state, pulse]);

  const warming = state === 'warming';

  return (
    <View style={bootStyles.container}>
      <View style={bootStyles.logoWrap}>
        {warming && (
          <Animated.View
            style={[
              bootStyles.pulseRing,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }],
              },
            ]}
          />
        )}
        <View style={[bootStyles.logo, !warming && bootStyles.logoOffline]}>
          <Ionicons
            name={warming ? 'nutrition' : 'cloud-offline-outline'}
            size={36}
            color={colors.textOnDark}
          />
        </View>
      </View>

      <Text style={bootStyles.brand}>Food Intelligence</Text>

      {warming ? (
        <>
          <Text style={bootStyles.title}>
            Waking up the server{seconds > 0 ? ` · ${seconds}s` : '…'}
          </Text>
          <Text style={bootStyles.body}>
            The free server sleeps when idle. It takes 20–40 seconds while the AI model loads.
          </Text>
          <Pressable style={bootStyles.bypassBtn} onPress={onBypass} hitSlop={8}>
            <Text style={bootStyles.bypassBtnText}>Continue offline</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={bootStyles.title}>Can't reach the server</Text>
          <Text style={bootStyles.body}>
            Check your internet connection and try again. If the problem
            persists, the server may still be waking up.
          </Text>
          <PressableScale style={bootStyles.retryBtn} onPress={onRetry}>
            <Ionicons name="refresh" size={18} color={colors.textOnDark} />
            <Text style={bootStyles.retryBtnText}>Try again</Text>
          </PressableScale>
          <Pressable style={bootStyles.bypassBtn} onPress={onBypass} hitSlop={8}>
            <Text style={bootStyles.bypassBtnText}>Continue offline</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const bootStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  logoWrap: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  pulseRing: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.accent,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 28,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.raised,
  },
  logoOffline: {
    backgroundColor: colors.textSecondary,
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.ink,
    borderRadius: radii.button,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  retryBtnText: {
    color: colors.textOnDark,
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
  },
  bypassBtn: {
    marginTop: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  bypassBtnText: {
    color: colors.textSecondary,
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
  },
});
