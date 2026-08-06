/**
 * Food Intelligence Analyzer — Main App Entry
 * Tab navigation: Home | Scan | History | Profile
 * Minimalist design: no icons, text-only tabs.
 */
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import HomeScreen from './screens/HomeScreen';
import ScanScreen from './screens/ScanScreen';
import ResultScreen from './screens/ResultScreen';
import HistoryScreen from './screens/HistoryScreen';
import ProfileScreen from './screens/ProfileScreen';
import AdminScreen from './screens/AdminScreen';
import { loadTokens, warmup, getProfile } from './services/api';
import { colors } from './theme/tokens';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const headerStyle = {
  headerStyle: { backgroundColor: '#FAFAF9' },
  headerShadowVisible: false,
  headerTitleStyle: { fontWeight: '700' as const, fontSize: 18, color: '#0D0D0D' },
};

function ScanStack() {
  return (
    <Stack.Navigator screenOptions={headerStyle}>
      <Stack.Screen name="ScanCamera" component={ScanScreen} options={{ title: 'Scan Food' }} />
      <Stack.Screen name="Result" component={ResultScreen} options={{ title: 'Results' }} />
    </Stack.Navigator>
  );
}

function HistoryStack() {
  return (
    <Stack.Navigator screenOptions={headerStyle}>
      <Stack.Screen name="HistoryList" component={HistoryScreen} options={{ title: 'History' }} />
      <Stack.Screen name="MealDetail" component={ResultScreen} options={{ title: 'Meal' }} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={headerStyle}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Stack.Navigator>
  );
}

function AdminStack() {
  return (
    <Stack.Navigator screenOptions={headerStyle}>
      <Stack.Screen name="AdminReview" component={AdminScreen} options={{ title: 'Admin' }} />
    </Stack.Navigator>
  );
}

/**
 * Custom tab bar — fully controlled so the active highlight is always
 * visible. React Navigation's tabBarLabel function proved unreliable for
 * propagating the `focused` state on some devices/versions, producing a
 * faint or missing highlight. Rendering our own Pressable pills avoids that
 * entirely: we read `state.index` (always authoritative) for the active state.
 */
function CustomTabBar({ state, descriptors, navigation }: any) {
  // Respect the system bottom inset (gesture-nav indicator / home pill) so
  // the bar sits above the OS UI instead of overlapping it.
  const insets = useSafeAreaInsets();

  return (
    <View style={[
      tabStyles.bar,
      { paddingBottom: insets.bottom > 0 ? insets.bottom : 8 },
    ]}>
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
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={({ pressed }) => [
              tabStyles.tab,
              pressed && tabStyles.tabPressed,
            ]}
            android_ripple={{ color: 'transparent' }}
          >
            <View style={[tabStyles.pill, isFocused && tabStyles.pillActive]}>
              <Text style={[tabStyles.label, isFocused && tabStyles.labelActive]}>
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#FFFFFF',
    borderTopColor: '#EBEBEB',
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabPressed: {
    opacity: 0.7,
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Filled dark pill behind the active tab — unmistakable "you are here".
  // NOTE: borderRadius + overflow are repeated here (not inherited from
  // `pill`) because Android's native style resolver can drop inherited
  // properties when merging an array style [pill, pillActive] that adds a
  // backgroundColor — which previously made the active tab render as a
  // sharp rectangle instead of a pill. Defining them explicitly fixes that.
  pillActive: {
    backgroundColor: '#0D0D0D',
    borderRadius: 999,
    overflow: 'hidden',
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B6B6B',
  },
  labelActive: {
    fontWeight: '700',
    color: '#FFFFFF',
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

  if (bootState !== 'ready') {
    return <BootScreen state={bootState} onRetry={() => {
      setBootState('warming');
      warmup().then((ok) => setBootState(ok ? 'ready' : 'offline'));
    }} />;
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Tab.Navigator
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'Home', headerShown: true, headerTitle: 'Food Intelligence', ...headerStyle }}
        />
        <Tab.Screen name="ScanTab" component={ScanStack} options={{ tabBarLabel: 'Scan' }} />
        <Tab.Screen name="History" component={HistoryStack} options={{ tabBarLabel: 'History' }} />
        <Tab.Screen name="Profile" component={ProfileStack} options={{ tabBarLabel: 'Profile' }} />
        {isAdmin && (
          <Tab.Screen name="Admin" component={AdminStack} options={{ tabBarLabel: 'Admin' }} />
        )}
      </Tab.Navigator>
    </NavigationContainer>
  );
}

/**
 * Boot screen — shown while the backend wakes from sleep, or if it can't be
 * reached. Keeps the user informed instead of showing frozen screens.
 */
function BootScreen({ state, onRetry }: { state: 'warming' | 'offline'; onRetry: () => void }) {
  return (
    <View style={bootStyles.container}>
      {state === 'warming' ? (
        <>
          <ActivityIndicator size="large" color={colors.textPrimary} />
          <Text style={bootStyles.title}>Waking up server...</Text>
          <Text style={bootStyles.body}>
            The first open after a few minutes may take 30-60 seconds while the
            server starts up. Thanks for your patience.
          </Text>
        </>
      ) : (
        <>
          <Text style={bootStyles.title}>Can't reach server</Text>
          <Text style={bootStyles.body}>
            Check your internet connection and try again. If the problem
            persists, the server may be redeploying.
          </Text>
          <Pressable style={bootStyles.retryBtn} onPress={onRetry}>
            <Text style={bootStyles.retryBtnText}>Try again</Text>
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
    padding: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 24,
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  retryBtn: {
    backgroundColor: colors.textPrimary,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 24,
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
