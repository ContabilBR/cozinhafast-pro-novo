import React, { useState } from "react";
import { LayoutChangeEvent, RefreshControlProps, StyleProp, View, ViewStyle } from "react-native";
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
  // Altura real do rodapé fixo (0 quando a tela não passa rodapé)
  const [alturaRodape, setAlturaRodape] = useState(0);
  const aoMedirRodape = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setAlturaRodape((atual) => (atual === h ? atual : h));
  };
  const reserva = rodape ? alturaRodape : 0;
  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={contentContainerStyle}
        bottomOffset={24 + espacoExtra + reserva}
        extraKeyboardSpace={reserva}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        {children}
      </KeyboardAwareScrollView>
      {rodape ? (
        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
          <View style={rodapeStyle} onLayout={aoMedirRodape}>
            {rodape}
          </View>
        </KeyboardStickyView>
      ) : null}
    </View>
  );
}
