import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle, StyleProp } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface SkeletonLineProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonLine({ width = '100%', height = 14, borderRadius, style }: SkeletonLineProps) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius: borderRadius ?? height / 2,
          backgroundColor: COLORS.surfaceSecondary,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function CardSkeleton() {
  const COLORS = useColors();
  return (
    <View
      style={{
        backgroundColor: COLORS.surface,
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: COLORS.border,
        gap: 10,
      }}
    >
      <SkeletonLine width="60%" height={18} />
      <SkeletonLine width="40%" height={14} />
      <SkeletonLine width="80%" height={14} />
    </View>
  );
}
