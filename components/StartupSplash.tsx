import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";

export function StartupSplash() {
  return (
    <View style={styles.container} accessibilityLabel="CozinhaFast Pro está iniciando">
      <StatusBar style="light" />
      <Image
        source={require("../assets/images/splash-cozinhafast.png")}
        style={styles.image}
        resizeMode="contain"
        onLoadEnd={() => { void SplashScreen.hideAsync().catch(() => {}); }}
        accessible
        accessibilityLabel="Cozinha Fácil. Gestão de restaurante sem complicação."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FF4713" },
  image: { width: "100%", height: "100%" },
});
