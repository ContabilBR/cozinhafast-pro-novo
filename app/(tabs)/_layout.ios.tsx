import React from "react";
import { Redirect } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { useAuth } from "@/contexts/AuthContext";

export default function TabLayoutIOS() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;
  if (!user) return <Redirect href="/auth-screen" />;

  const role = user.role || "garcom";

  if (role === "garcom") {
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="(mesas)">
          <Icon sf="table.furniture" />
          <Label>Mesas</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(cardapio)">
          <Icon sf="fork.knife" />
          <Label>Cardápio</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(comandas)">
          <Icon sf="receipt" />
          <Label>Comandas</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(pedidos)">
          <Icon sf="list.bullet.clipboard" />
          <Label>Pedidos</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(perfil)">
          <Icon sf="person.circle" />
          <Label>Perfil</Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  if (role === "cozinheiro" || role === "cozinha") {
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="(cozinha)">
          <Icon sf="flame" />
          <Label>Cozinha</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(cardapio)">
          <Icon sf="book.pages" />
          <Label>Cardápio</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(perfil)">
          <Icon sf="person.circle" />
          <Label>Perfil</Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  // gerente, administrador, admin
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(dashboard)">
        <Icon sf="chart.bar" />
        <Label>Dashboard</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(mesas)">
        <Icon sf="table.furniture" />
        <Label>Mesas</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(comandas)">
        <Icon sf="receipt" />
        <Label>Comandas</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(cardapio)">
        <Icon sf="book.pages" />
        <Label>Cardápio</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(gestao)">
        <Icon sf="gearshape" />
        <Label>Gestão</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(perfil)">
        <Icon sf="person.circle" />
        <Label>Perfil</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
