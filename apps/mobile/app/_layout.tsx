import { Pressable, Text } from "react-native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { BrandLogo } from "../components/BrandLogo";
import { AuthProvider, useAuth } from "../lib/auth";
import { ReaderPreferencesProvider } from "../lib/reader-preferences";
import { colors } from "../lib/theme";

function SettingsHeaderButton() {
  const router = useRouter();
  const { user } = useAuth();
  return (
    <Pressable
      onPress={() => router.push(user ? "/settings" : "/login")}
      hitSlop={8}
      style={{ paddingHorizontal: 4, paddingVertical: 6 }}
    >
      <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 15 }}>
        {user ? "Settings" : "Sign in"}
      </Text>
    </Pressable>
  );
}

function RootNavigator() {
  return (
    <>
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
            headerTitle: () => <BrandLogo variant="wordmark" height={24} />,
            headerTitleAlign: "left",
            headerRight: () => <SettingsHeaderButton />,
          }}
        />
        <Stack.Screen name="login" options={{ title: "Sign in", presentation: "modal" }} />
        <Stack.Screen name="books/[id]" options={{ title: "Book" }} />
        <Stack.Screen name="read/[bookId]/[chapterId]" options={{ headerShown: false }} />
        <Stack.Screen name="publisher/index" options={{ title: "Publisher" }} />
        <Stack.Screen name="publisher/new" options={{ title: "Upload book" }} />
        <Stack.Screen name="publisher/[id]" options={{ title: "Manage book" }} />
        <Stack.Screen name="admin/index" options={{ title: "Admin" }} />
        <Stack.Screen name="admin/[id]" options={{ title: "Review book" }} />
        <Stack.Screen name="legal/accept" options={{ title: "User agreement" }} />
        <Stack.Screen name="legal/[docId]" options={{ title: "Legal" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
    </>
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
