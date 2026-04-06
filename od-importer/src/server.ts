import express from 'express';
import { config } from './config.js';
import { getMysqlPool, getPgPool } from './db.js';
import { runImport } from './importer.js';
import { runProviderProductionImport } from './provider-production-importer.js';
import { calculateProviderDues } from './provider-dues-calculator.js';
import { buildProviderPayslip } from './provider-payslip.js';
import { buildProviderDocumentPlan, resolveScannedDocumentTarget } from './provider-document-routing.js';
import { buildProviderInvoice } from './provider-invoice.js';

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, error: message });
  }
});

app.post('/api/od/provider-production/import', async (req, res) => {
  try {
    const pg = getPgPool();
    const mysql = getMysqlPool();
    const result = await runProviderProductionImport(pg, mysql, req.body);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, error: message });
  }
});


app.post('/api/od/provider-dues/preview', (req, res) => {
  try {
    const result = calculateProviderDues(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, error: message });
  }
});


app.post('/api/od/provider-payslip/preview', (req, res) => {
  try {
    const result = buildProviderPayslip(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, error: message });
  }
});


app.post('/api/od/provider-invoice/preview', (req, res) => {
  try {
    const result = buildProviderInvoice(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, error: message });
  }
});


app.post('/api/od/provider-documents/plan', (req, res) => {
  try {
    const plan = buildProviderDocumentPlan(req.body);
    res.json({ ok: true, ...plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, error: message });
  }
});


app.post('/api/od/provider-documents/register-scan', async (req, res) => {
  try {
    const pg = getPgPool();
    const target = resolveScannedDocumentTarget(req.body);

    const providerId = String(req.body.provider_id);
    const periodYear = Number(req.body.period_year);
    const periodMonth = Number(req.body.period_month);
    const documentType = String(req.body.document_type);
    const sourceFilename = req.body.source_filename ? String(req.body.source_filename) : null;
    const uploadedBy = req.body.uploaded_by ? String(req.body.uploaded_by) : null;
    const invoiceNumber = req.body.invoice_number ? String(req.body.invoice_number) : null;

    const result = await pg.query(
      `INSERT INTO provider_documents
        (provider_id, period_year, period_month, document_type, invoice_number, source_filename, canonical_filename, target_directory, target_full_path, status, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'SIGNED', $10)
       ON CONFLICT (provider_id, period_year, period_month, document_type)
       DO UPDATE SET
         invoice_number = EXCLUDED.invoice_number,
         source_filename = EXCLUDED.source_filename,
         canonical_filename = EXCLUDED.canonical_filename,
         target_directory = EXCLUDED.target_directory,
         target_full_path = EXCLUDED.target_full_path,
         status = 'SIGNED',
         uploaded_by = EXCLUDED.uploaded_by,
         updated_at = NOW()
       RETURNING id`,
      [
        providerId,
        periodYear,
        periodMonth,
        documentType,
        invoiceNumber,
        sourceFilename,
        target.canonical_filename,
        target.directory,
        target.full_path,
        uploadedBy
      ]
    );

    res.json({ ok: true, document_id: result.rows[0].id, ...target });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, error: message });
  }
});

app.listen(config.port, () => {
  console.log(`od-importer listening on port ${config.port}`);
});
