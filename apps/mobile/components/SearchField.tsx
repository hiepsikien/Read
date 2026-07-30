import { StyleSheet, TextInput, View } from "react-native";
import { colors, radii, space } from "../lib/theme";

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
};

export function SearchField({
  value,
  onChangeText,
  placeholder = "Search titles or authors",
}: Props) {
  return (
    <View style={styles.wrap}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.88)",
  },
  input: {
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    color: colors.ink,
    fontSize: 15,
  },
});
