import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#d5e2dd" },
          headerTintColor: "#14221c",
          contentStyle: { backgroundColor: "#eef3f0" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Read" }} />
        <Stack.Screen name="login" options={{ title: "Sign in" }} />
      </Stack>
    </>
  );
}
