import React from "react";
import { Modal, View, Text, TouchableOpacity } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const COLORS = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          zIndex: 9999,
          elevation: 9999,
        }}
      >
        <View
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: 16,
            padding: 24,
            width: "100%",
            maxWidth: 340,
            gap: 12,
          }}
        >
          <Text
            style={{
              fontFamily: "Outfit_700Bold",
              fontSize: 18,
              color: COLORS.text,
              textAlign: "center",
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 14,
              color: COLORS.textSecondary,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            {message}
          </Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <TouchableOpacity
              onPress={onCancel}
              style={{
                flex: 1,
                height: 46,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: COLORS.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 15,
                  color: COLORS.textSecondary,
                }}
              >
                {cancelLabel}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onConfirm}
              style={{
                flex: 1,
                height: 46,
                borderRadius: 12,
                backgroundColor: destructive ? "#FF3B30" : COLORS.primary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: "Outfit_700Bold",
                  fontSize: 15,
                  color: "#fff",
                }}
              >
                {confirmLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
