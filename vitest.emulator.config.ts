import { defineConfig } from "vitest/config";

// The tests that need the Firestore emulator; `pnpm test:emulator` starts it around them.
export default defineConfig({
  test: {
    include: ["src/**/*.emulator.test.ts"],
    environment: "node",
    fileParallelism: false,
  },
});
