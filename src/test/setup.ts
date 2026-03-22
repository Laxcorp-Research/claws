process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(64);
process.env.ENCRYPTION_KEY_VERSION = 'v1';
process.env.NEXTAUTH_SECRET = 'test-secret';
process.env.NEXTAUTH_URL = 'http://localhost:3000';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
