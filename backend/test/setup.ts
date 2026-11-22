import {
  ensureExplicitTestSupabaseEnv,
  getTestDataSupabaseUrl,
  getTestDbSupabaseUrl,
} from './test-env';

ensureExplicitTestSupabaseEnv();
// Unit tests never inherit a production provider key from backend/.env.
// Floored tests explicitly supply a synthetic key and mocked fetch.
process.env.FLOORED_API_KEY = '';

// Global test setup
beforeAll(async () => {
  // Ensure we're using test environment
  console.log('🧪 Test environment configured');
  console.log('📍 DATA_SUPABASE_URL:', getTestDataSupabaseUrl());
  console.log('📍 DB_SUPABASE_URL:', getTestDbSupabaseUrl());
});

// Global test teardown
afterAll(async () => {
  // Cleanup if needed
  console.log('🧹 Test cleanup completed');
});

// Increase timeout for database operations
jest.setTimeout(30000);
