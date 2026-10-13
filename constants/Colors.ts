const tintColorLight = "#0a7ea4";
const tintColorDark = "#fff";

export const Colors = {
  light: {
    text: "#11181C",
    background: "#fff",
    tint: tintColorLight,
    icon: "#687076",
    tabIconDefault: "#687076",
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: "#ECEDEE",
    background: "#151718",
    tint: tintColorDark,
    icon: "#9BA1A6",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: tintColorDark,
  },
};

export const COLORS = {
  // Brand
  primary: '#E8521A',
  primaryMuted: 'rgba(232, 82, 26, 0.10)',
  primaryDark: '#C4410F',
  accent: '#2DD4BF',

  // Backgrounds
  background: '#FAF7F4',
  surface: '#FFFFFF',
  surfaceSecondary: '#F2EDE8',

  // Text
  text: '#1A1208',
  textSecondary: '#7A6A5A',
  textTertiary: '#B8A898',

  // Status - table
  statusLivre: '#22C55E',
  statusOcupada: '#E8521A',
  statusReservada: '#F59E0B',
  statusFechando: '#8B5CF6',

  // Status - item
  statusPendente: '#94A3B8',
  statusRecebido: '#3B82F6',
  statusEmPreparo: '#F59E0B',
  statusPronto: '#22C55E',
  statusEntregue: '#64748B',
  statusCancelado: '#EF4444',

  // UI
  border: 'rgba(26, 18, 8, 0.08)',
  divider: 'rgba(26, 18, 8, 0.05)',
  danger: '#EF4444',
  warning: '#F59E0B',
  success: '#22C55E',

  // Dark mode
  darkBackground: '#120E0A',
  darkSurface: '#1E1812',
  darkSurfaceSecondary: '#2A2218',
  darkText: '#F5F0EB',
  darkTextSecondary: '#A89880',
  darkBorder: 'rgba(245, 240, 235, 0.08)',
};

export const DARK_COLORS = {
  ...COLORS,
  background: COLORS.darkBackground,
  surface: COLORS.darkSurface,
  surfaceSecondary: COLORS.darkSurfaceSecondary,
  text: COLORS.darkText,
  textSecondary: COLORS.darkTextSecondary,
  border: COLORS.darkBorder,
  divider: 'rgba(245, 240, 235, 0.04)',
};
