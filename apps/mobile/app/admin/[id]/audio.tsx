import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { AdminBookCastPanel } from "../../../components/AdminBookCastPanel";
import { FormScroll } from "../../../components/FormScroll";
import { useAuth } from "../../../lib/auth";
import { colors } from "../../../lib/theme";

export default function AdminBookAudioScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  useFocusEffect(
    useCallback(() => {
      if (authLoading) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      if (user.role !== "admin") {
        router.replace("/");
      }
    }, [authLoading, user, router])
  );

  if (!id) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Missing book id.</Text>
      </View>
    );
  }

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: "Audio cast" }} />
      <Text style={styles.lead}>
        Edit speaking voices for this book. Mark ready when the cast is good enough to publish.
      </Text>
      <AdminBookCastPanel bookId={id} />
    </FormScroll>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40, gap: 12 },
  lead: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  error: { color: colors.danger },
});
