import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../lib/auth";
import { colors } from "../lib/theme";

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.mist },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: colors.mist },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Read" }} />
        <Stack.Screen name="login" options={{ title: "Sign in", presentation: "modal" }} />
        <Stack.Screen name="books/[id]" options={{ title: "Book" }} />
        <Stack.Screen
          name="read/[bookId]/[chapterId]"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="publisher/index" options={{ title: "Publisher" }} />
        <Stack.Screen name="publisher/new" options={{ title: "Upload book" }} />
        <Stack.Screen name="publisher/[id]" options={{ title: "Manage book" }} />
      </Stack>
    </AuthProvider>
  );
}
