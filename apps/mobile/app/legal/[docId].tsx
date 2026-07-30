import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { CURRENT_LEGAL_VERSION, LEGAL_DOCUMENTS, type LegalDocumentId } from "../../lib/legal";
import { colors, radii, space } from "../../lib/theme";

export default function LegalDocumentScreen() {
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const document = LEGAL_DOCUMENTS[docId as LegalDocumentId];

  if (!document) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body}>Document not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: document.title }} />
      <Text style={styles.eyebrow}>Version {CURRENT_LEGAL_VERSION}</Text>
      <Text style={styles.title}>{document.title}</Text>
      {document.sections.map((section) => (
        <View key={section.heading} style={styles.section}>
          <Text style={styles.heading}>{section.heading}</Text>
          <Text style={styles.body}>{section.body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.xl, gap: space.lg, paddingBottom: 56 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.mist },
  eyebrow: { color: colors.sage, textTransform: "uppercase", letterSpacing: 1.2, fontSize: 12, fontWeight: "700" },
  title: { color: colors.ink, fontSize: 30, fontWeight: "700" },
  section: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, padding: 16, gap: 8 },
  heading: { color: colors.ink, fontSize: 17, fontWeight: "700" },
  body: { color: colors.inkSoft, lineHeight: 22 },
});
