import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const resolveEnvPath = () => {
    const override = process.env.OD_ENV_PATH;
    if (override && override.trim())
        return override.trim();
    const localEnv = resolve(process.cwd(), '.env');
    if (existsSync(localEnv))
        return localEnv;
    const fallback = 'M:\\.env';
    return existsSync(fallback) ? fallback : undefined;
};
dotenv.config({ path: resolveEnvPath() });
const requireEnv = (key) => {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
};
const optionalEnv = (key, fallback) => {
    const value = process.env[key];
    return value && value.trim() ? value.trim() : fallback;
};
const parseNumber = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
export const config = {
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
