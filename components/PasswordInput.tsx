import React, { useState } from "react";
import { TextInput, TextInputProps, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

/**
 * Campo de senha com botão de olho para mostrar/ocultar o que foi digitado.
 * Use no lugar de <TextInput secureTextEntry /> nas telas em que gerente ou
 * administrador define a senha de outra pessoa, para conferir o que foi digitado.
 *
 * Aceita as mesmas props do TextInput (incluindo `style`). Começa oculto.
 */
export function PasswordInput({ style, ...props }: Omit<TextInputProps, "secureTextEntry">) {
  const COLORS = useColors();
  const [visivel, setVisivel] = useState(false);

  return (
    <View style={{ justifyContent: "center" }}>
      <TextInput
        {...props}
        secureTextEntry={!visivel}
        autoCapitalize="none"
        autoCorrect={false}
        // Espaço à direita para o texto não ficar embaixo do botão.
        style={[style, { paddingRight: 48 }]}
      />
      <TouchableOpacity
        onPress={() => setVisivel((v) => !v)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={visivel ? "Ocultar senha" : "Mostrar senha"}
        style={{ position: "absolute", right: 14, height: "100%", justifyContent: "center" }}
      >
        <Ionicons name={visivel ? "eye-off-outline" : "eye-outline"} size={20} color={COLORS.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

export default PasswordInput;
