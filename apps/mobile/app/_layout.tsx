import { Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { BrandLogo } from "../components/BrandLogo";
import { AuthProvider, useAuth } from "../lib/auth";
import { ReaderPreferencesProvider } from "../lib/reader-preferences";
import { colors } from "../lib/theme";

function LibraryHeaderRight() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, api } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPending = useCallback(async () => {
    if (!user || user.role !== "admin") {
      setPendingCount(0);
      return;
    }
    try {
      const data = await api.adminSummary();
      setPendingCount(data.pending_count);
    } catch {
      // Keep the last known count; never block navigation.
    }
  }, [api, user]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending, pathname]);

  return (
    <View style={headerStyles.row}>
      {user?.role === "admin" ? (
        <Pressable
          onPress={() => router.push("/admin")}
          hitSlop={8}
          style={headerStyles.adminBtn}
        >
          <Text style={headerStyles.adminText}>Admin</Text>
          {pendingCount > 0 ? (
            <View style={headerStyles.badge}>
              <Text style={headerStyles.badgeText}>
                {pendingCount > 99 ? "99+" : String(pendingCount)}
              </Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => router.push(user ? "/settings" : "/login")}
        hitSlop={8}
        style={{ paddingHorizontal: 4, paddingVertical: 6 }}
      >
        <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 15 }}>
          {user ? "Settings" : "Sign in"}
        </Text>
      </Pressable>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  adminBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.sage,
  },
  adminText: { color: colors.white, fontWeight: "700", fontSize: 13 },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger,
  },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: "700" },
});

function HandleGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user || user.handle) return;
    if (
      pathname === "/claim-handle" ||
      pathname === "/login" ||
      pathname.startsWith("/legal/")
    ) {
      return;
    }
    router.replace("/claim-handle");
  }, [loading, user, pathname, router]);

  return <>{children}</>;
}

function RootNavigator() {
  return (
    <HandleGate>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.mist },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontWeight: "600" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.mist },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: "Library",
            headerTitle: () => <BrandLogo variant="wordmark" height={24} />,
            headerTitleAlign: "left",
            headerRight: () => <LibraryHeaderRight />,
          }}
        />
        <Stack.Screen name="login" options={{ title: "Sign in", presentation: "modal" }} />
        <Stack.Screen name="claim-handle" options={{ title: "Choose handle" }} />
        <Stack.Screen name="books/[id]" options={{ title: "Book" }} />
        <Stack.Screen name="[handle]" options={{ title: "Profile" }} />
        <Stack.Screen name="read/[bookId]/[chapterId]" options={{ headerShown: false }} />
        <Stack.Screen name="publisher/index" options={{ title: "Publisher" }} />
        <Stack.Screen name="publisher/new" options={{ title: "Upload book" }} />
        <Stack.Screen name="publisher/[id]" options={{ title: "Manage book" }} />
        <Stack.Screen name="admin/index" options={{ title: "Admin" }} />
        <Stack.Screen name="admin/[id]/index" options={{ title: "Review book" }} />
        <Stack.Screen name="admin/[id]/edit" options={{ title: "Edit catalog" }} />
        <Stack.Screen name="legal/accept" options={{ title: "User agreement" }} />
        <Stack.Screen name="legal/[docId]" options={{ title: "Legal" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
    </HandleGate>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ReaderPreferencesProvider>
        <RootNavigator />
      </ReaderPreferencesProvider>
    </AuthProvider>
  );
}
