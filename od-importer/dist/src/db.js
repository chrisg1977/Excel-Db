import { createPool as createMysqlPool } from 'mysql2/promise';
import { Pool as PgPool } from 'pg';
import { config } from './config.js';
let mysqlPool = null;
let pgPool = null;
export const getMysqlPool = () => {
    if (!mysqlPool) {
        mysqlPool = createMysqlPool({
            host: config.mysql.host,
            port: config.mysql.port,
            user: config.mysql.user,
            password: config.mysql.password,
            database: config.mysql.database,
            connectionLimit: 10
        });
    }
    return mysqlPool;
};
export const getPgPool = () => {
    if (!pgPool) {
        pgPool = new PgPool({
            connectionString: config.postgres.connectionString,
            max: 10
        });
    }
    return pgPool;
};
