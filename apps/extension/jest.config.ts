// Unit tests of the extension: pnpm --filter ./apps/extension run test
export default {
  displayName: 'extension',
  rootDir: __dirname,
  // the specs create their own jsdom document
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'es2020',
          esModuleInterop: true,
          isolatedModules: true,
        },
      },
    ],
  },
};
