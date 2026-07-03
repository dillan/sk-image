import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        // Thin plugin entrypoint: it lazily wires the real store + worker pool (which needs the
        // built worker); covered by the Signal K integration / e2e path, not unit tests.
        'src/index.ts',
        // Worker-thread entry: it only wires sharp to postMessage and is exercised end-to-end by
        // the Signal K integration / e2e path, not by unit tests (which use a fake worker).
        'src/images/image-worker.ts',
      ],
      // Regression ratchet — set a few points below current actuals, not aspirational. Raise as
      // coverage improves. The multer upload path + real worker wiring are covered by integration.
      thresholds: {
        statements: 84,
        branches: 72,
        functions: 85,
        lines: 86,
      },
    },
  },
});
