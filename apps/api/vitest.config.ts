import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Nest injects by constructor type, so tests need real decorator metadata (esbuild does not emit it).
export default defineConfig({
  plugins: [swc.vite({ jsc: { target: 'es2023', parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true, useDefineForClassFields: false } }, module: { type: 'es6' } })],
  // One PostgreSQL for the run (test/global-setup.ts); each file copies ready-made databases, so files run side by side.
  test: { include: ['test/**/*.test.ts', 'src/**/*.test.ts'], globalSetup: ['test/global-setup.ts'], hookTimeout: 240_000, testTimeout: 60_000, pool: 'forks', maxWorkers: 4 },
});
