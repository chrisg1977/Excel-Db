import { config } from '../src/config.js';
const redact = (value) => (value.length > 4 ? `${value.slice(0, 2)}***${value.slice(-2)}` : '***');
console.log('od-importer smoke check');
console.log('Port:', config.port);
console.log('Max days:', config.maxDays);
console.log('MySQL host:', config.mysql.host);
console.log('MySQL user:', config.mysql.user);
console.log('MySQL database:', config.mysql.database);
console.log('Postgres DSN:', redact(config.postgres.connectionString));
