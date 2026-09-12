import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off in this repo, so Testing Library cannot register its own
// cleanup hook and rendered trees would pile up across tests.
afterEach(cleanup);
