import { defineConfig } from 'vitest/config';

// The rule tests read every source file in the repository; next to the API tests (a push checks them together) one took
// 17 s and failed on vitest's 5 s default though nothing was wrong.
export default defineConfig({ test: { testTimeout: 60_000 } });
