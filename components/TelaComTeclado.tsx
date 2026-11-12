import React from "react";
import { RefreshControlProps, StyleProp, View, ViewStyle } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  children: React.ReactNode;
  /** Estilo do contêiner de conteúdo da rolagem. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Espaço extra (px) entre o campo focado e o teclado. */
  espacoExtra?: number;
  /** Rodapé fixo (botões de ação) que sobe junto com o teclado. */
  rodape?: React.ReactNode;
  /** Estilo do contêiner do rodapé. */
  rodapeStyle?: StyleProp<ViewStyle>;
  /** Puxar-para-atualizar da rolagem (opcional). */
  refreshControl?: React.ReactElement<RefreshControlProps>;
};

/**
 * Tela de formulário que mantém o campo focado visível acima do teclado,
 * em Android e iOS, celular e tablet. Fecha o teclado ao arrastar a lista e
 * mantém os toques nos botões funcionando com o teclado aberto.
 */
export function TelaComTeclado({ children, contentContainerStyle, espacoExtra = 0, rodape, rodapeStyle, refreshControl }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={contentContainerStyle}
        bottomOffset={24 + espacoExtra}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        {children}
      </KeyboardAwareScrollView>
      {rodape ? (
        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
          <View style={rodapeStyle}>{rodape}</View>
        </KeyboardStickyView>
      ) : null}
    </View>
  );
}
