import { Alert } from 'react-native';
// @ts-expect-error — untyped internal RN module
import { polyfillGlobal } from 'react-native/Libraries/Utilities/PolyfillFunctions';

// Add global alert() on iOS/Android — it doesn't exist by default in React Native.
// On web, window.alert already exists so no polyfill needed.
polyfillGlobal('alert', () => (message?: string) => {
  Alert.alert('', String(message ?? ''));
});
