import dotenv from 'dotenv';
import { existsSync } from 'node:fs';

const resolveEnvPath = (): string | undefined => {
  const override = process.env.OD_ENV_PATH;
  if (override && override.trim()) return override.trim();
  const fallback = 'M:\\.env';
  return existsSync(fallback) ? fallback : undefined;
};

dotenv.config({ path: resolveEnvPath() });

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optionalEnv = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : fallback;
};

const parseNumber = (value: string, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export type AppConfig = {
  port: number;
  maxDays: number;
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  postgres: {
    connectionString: string;
  };
};

export const config: AppConfig = {
  port: parseNumber(optionalEnv('PORT', '4020'), 4020),
  maxDays: parseNumber(optionalEnv('IMPORT_MAX_DAYS', '60'), 60),
  mysql: {
    host: requireEnv('OD_MYSQL_HOST'),
    port: parseNumber(optionalEnv('OD_MYSQL_PORT', '3306'), 3306),
    user: requireEnv('OD_MYSQL_USER'),
    password: optionalEnv('OD_MYSQL_PASSWORD', ''),
    database: requireEnv('OD_MYSQL_DATABASE')
  },
  postgres: {
    connectionString: requireEnv('DIRECTUS_PG_CONNECTION')
  }
};
