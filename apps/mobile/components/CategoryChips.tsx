import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Category } from "@read/api-client";
import { colors, radii, space } from "../lib/theme";

type Props = {
  categories: Category[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
  /** Counts keyed by category slug. When set with hideEmpty, zero-count chips are omitted. */
  countsBySlug?: Record<string, number>;
  /** Total shown on the All chip, e.g. books.length */
  allCount?: number;
  hideEmpty?: boolean;
};

export function CategoryChips({
  categories,
  selected,
  onSelect,
  countsBySlug,
  allCount,
  hideEmpty = false,
}: Props) {
  const visible = hideEmpty
    ? categories.filter((category) => (countsBySlug?.[category.slug] ?? 0) > 0)
    : categories;

  const allLabel =
    allCount === undefined ? "All" : `All (${allCount})`;

  return (
    <View style={styles.row}>
      <Chip label={allLabel} active={!selected} onPress={() => onSelect(null)} />
      {visible.map((category) => {
        const count = countsBySlug?.[category.slug];
        const label =
          count === undefined ? category.label : `${category.label} (${count})`;
        return (
          <Chip
            key={category.id}
            label={label}
            active={selected === category.slug}
            onPress={() => onSelect(category.slug)}
          />
        );
      })}
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
