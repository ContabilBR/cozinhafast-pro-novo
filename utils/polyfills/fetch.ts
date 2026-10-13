import { fetch as expoFetch } from 'expo/fetch';
// @ts-expect-error — untyped internal RN module
import { polyfillGlobal } from 'react-native/Libraries/Utilities/PolyfillFunctions';

// Replace global fetch with expo/fetch which supports streaming response bodies
polyfillGlobal('fetch', () => expoFetch);

// Dynamic imports so missing packages don't break the bundle
Promise.all([
  // eslint-disable-next-line import/no-unresolved
  import('@stardazed/streams-text-encoding').catch(() => null),
  import('@ungap/structured-clone').catch(() => null),
]).then(([streamsModule, structuredCloneModule]) => {
  if (streamsModule) {
    polyfillGlobal('TextEncoderStream', () => streamsModule.TextEncoderStream);
    polyfillGlobal('TextDecoderStream', () => streamsModule.TextDecoderStream);
  }

  if (structuredCloneModule && !('structuredClone' in globalThis)) {
    polyfillGlobal('structuredClone', () => structuredCloneModule.default);
  }
});
