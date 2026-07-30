import { ScrollView, type ScrollViewProps } from "react-native";

/**
 * Scroll container for screens with text inputs. `automaticallyAdjustKeyboardInsets`
 * handles iOS; on Android the window resizes via Expo's default `adjustResize`.
 */
export function FormScroll({ children, ...rest }: ScrollViewProps) {
  return (
    <ScrollView
      {...rest}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      {children}
    </ScrollView>
  );
}
