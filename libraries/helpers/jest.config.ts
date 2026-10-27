// Unit tests of the helpers library: pnpm exec jest -c libraries/helpers/jest.config.ts
export default {
  displayName: 'helpers',
  rootDir: __dirname,
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
  moduleNameMapper: {
    '^@gitroom/helpers/(.*)$': '<rootDir>/src/$1',
  },
};
