import express from 'express';
import { config } from './config.js';
import { getMysqlPool, getPgPool } from './db.js';
import { runImport } from './importer.js';
const app = express();
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'od-importer' });
});
app.post('/api/od/timesheets/import', async (req, res) => {
    try {
        const pg = getPgPool();
        const mysql = getMysqlPool();
        const result = await runImport(pg, mysql, req.body);
        res.json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(400).json({ ok: false, error: message });
    }
});
app.listen(config.port, () => {
    console.log(`od-importer listening on port ${config.port}`);
});
