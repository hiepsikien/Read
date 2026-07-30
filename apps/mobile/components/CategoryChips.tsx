import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Category } from "@read/api-client";
import { colors, radii, space } from "../lib/theme";

type Props = {
  categories: Category[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
};

export function CategoryChips({ categories, selected, onSelect }: Props) {
  return (
    <View style={styles.row}>
      <Chip label="All" active={!selected} onPress={() => onSelect(null)} />
      {categories.map((category) => (
        <Chip
          key={category.id}
          label={category.label}
          active={selected === category.slug}
          onPress={() => onSelect(category.slug)}
        />
      ))}
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: space.sm,
  },
  chip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.72)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: colors.sage,
    borderColor: colors.sage,
  },
  chipText: {
    color: colors.inkSoft,
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: colors.white,
  },
});
