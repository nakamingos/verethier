module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testMatch: ['**/test/**/*.spec.(ts|js)'],
  transform: {
    '^.+\\.(ts|tsx|js)$': ['ts-jest', { tsconfig: { allowJs: true } }],
  },
  // bip322-js 4 uses Noble's ESM modules; transform their JS for the CommonJS test runner.
  transformIgnorePatterns: ['node_modules/(?!(@noble/(curves|hashes)|bip322-js)/)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testTimeout: 30000, // 30 seconds for database operations
  
  // Clean test output configuration
  silent: false, // Keep false to see important logs, but configure reporters
  verbose: false, // Reduces individual test output
  reporters: [
    'default',
    // Only show summary unless there are failures
  ],
  
  // Suppress console output during tests (except errors)
  setupFiles: ['<rootDir>/test/jest-console-setup.js'],
};
