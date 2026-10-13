import React from "react";
import { Stack } from "expo-router";

export default function MesaClienteLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
