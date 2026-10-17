import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { services } from './runtime/services';

afterEach(() => {
  cleanup();
  for (const key of Object.keys(services)) Reflect.deleteProperty(services, key);
});
