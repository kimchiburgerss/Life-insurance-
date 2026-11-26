// Runs before each integration test file, before any app module is imported.
import "dotenv/config";
import { testDatabaseUrl } from "./test-db";

process.env.DATABASE_URL = testDatabaseUrl();
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
