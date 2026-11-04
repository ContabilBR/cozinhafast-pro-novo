import { useSafeAreaInsets } from "react-native-safe-area-context";

// Medidas da barra de abas flutuante (components/FloatingTabBar.tsx):
// pílula de 60 de altura + margem inferior de 20 + área segura do aparelho.
const TAB_BAR_HEIGHT = 60;
const TAB_BAR_BOTTOM_MARGIN = 20;

/**
 * Espaço que o final de uma lista rolável deve reservar para o último item
 * ficar inteiro acima da barra de abas: altura da barra + área segura inferior.
 * Use em `paddingBottom` do contentContainerStyle (somando o respiro que a tela já tinha).
 */
export function useTabBarInset(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_MARGIN + insets.bottom;
}
