// Unit tests of the nestjs libraries: pnpm exec jest -c libraries/nestjs-libraries/jest.config.ts
export default {
  displayName: 'nestjs-libraries',
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
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@gitroom/nestjs-libraries/(.*)$': '<rootDir>/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/../helpers/src/$1',
  },
};
