import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";

export default function GestaoLayout() {
  const COLORS = useColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
      }}
    />
  );
}
