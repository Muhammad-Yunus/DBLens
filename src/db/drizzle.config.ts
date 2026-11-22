import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST ?? '',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME ?? process.env.DB_DATABASE ?? 'postgres',
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    ssl: process.env.DB_SSL_MODE === 'disable' ? false : { rejectUnauthorized: false },
  },
});
