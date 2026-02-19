import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';
import { validateTaxRatesBatch, getValidationSummary, type TaxRecord } from '../lib/tax-validation.js';

const CANONICAL_TAX_CODES = new Set(['sng', 'mar1', 'mar2', 'mar', 'par1', 'par2', 'par']);

/**
 * Helper to get user details for audit logging
 */
const getUserInfo = (req: any) => {
  const user = req.accountability?.user;
  return {
    user_id: user?.id || null,
    user_email: user?.email || null,
    user_name: user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : null
  };
};

/**
 * Helper to log audit events
 */
const logAuditEvent = async (
  database: any,
  logger: any,
  batchId: string,
  actionType: string,
  actionStatus: string,
  year: number,
  userId: string | null,
  userEmail: string | null,
  userName: string | null,
  sourceUrl: string | null,
  totalRecords: number,
  processingTimeMs: number,
  validationErrors?: any[],
  notes?: string
) => {
  try {
    await database('tax_publish_audit_log').insert({
      batch_id: batchId,
      action_type: actionType,
      action_status: actionStatus,
      user_id: userId,
      user_email: userEmail,
      user_name: userName,
      timestamp: new Date(),
      year,
      source_url: sourceUrl,
      total_records: totalRecords,
      validation_errors: validationErrors ? JSON.stringify(validationErrors) : null,
      processing_time_ms: processingTimeMs,
      notes
    });
  } catch (logError) {
    logger.warn(`Failed to log audit event: ${logError}`);
  }
};

export default defineEndpoint((router: Router, { database, logger }: any) => {
  /**
   * POST /tax/publish/:batch_id
   * Publish tax rates with validation and audit logging
   */
  router.post('/tax/publish/:batch_id', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication required'
        });
      }

      const { batch_id } = req.params;
      const userInfo = getUserInfo(req);

      if (!batch_id) {
        return res.status(400).json({
          status: 'error',
          message: 'Batch ID is required'
        });
      }

      const startTime = Date.now();

      const records = await database('tax_rates_import').where('batch_id', '=', batch_id);
      if (!records.length) {
        await logAuditEvent(
          database,
          logger,
          batch_id,
          'publish',
          'failed',
          0,
          userInfo.user_id,
          userInfo.user_email,
          userInfo.user_name,
          null,
          0,
          Date.now() - startTime,
          [],
          'Batch not found'
        );

        return res.status(404).json({
          status: 'error',
          message: 'Batch not found'
        });
      }

      const year = records[0]?.year || new Date().getFullYear();
      const sourceUrl = records[0]?.source_url || null;

      // Convert records to TaxRecord format for validation
      const taxRecords: TaxRecord[] = records.map((r: any) => ({
        year: r.year,
        category_code: r.category_code,
        raw_category_label: r.raw_category_label,
        band_from: r.band_from,
        band_to: r.band_to,
        rate: r.rate,
        subtract: r.subtract,
        source_url: r.source_url
      }));

      // RUN PRE-PUBLISH VALIDATIONS
      const validationErrors = validateTaxRatesBatch(taxRecords);
      const validationSummary = getValidationSummary(validationErrors);

      if (!validationSummary.isValid) {
        // Log validation failure to audit trail
        await logAuditEvent(
          database,
          logger,
          batch_id,
          'validate',
          'validation_failed',
          year,
          userInfo.user_id,
          userInfo.user_email,
          userInfo.user_name,
          sourceUrl,
          records.length,
          Date.now() - startTime,
          validationErrors.map((e) => ({
            type: e.type,
            message: e.message,
            details: e.details
          })),
          `Validation failed: ${validationSummary.totalErrors} error(s)`
        );

        return res.status(409).json({
          status: 'error',
          message: 'Publish blocked: validation failed',
          data: {
            batchId: batch_id,
            year,
            validationSummary: {
              isValid: false,
              totalErrors: validationSummary.totalErrors,
              errorsByType: validationSummary.errorsByType
            },
            errors: validationErrors.slice(0, 20) // Return first 20 errors
          }
        });
      }

      const unknownCategories = Array.from(
        new Set(records.filter((r: any) => !r.category_code).map((r: any) => r.raw_category_label || 'unknown'))
      );

      if (unknownCategories.length > 0) {
        await logAuditEvent(
          database,
          logger,
          batch_id,
          'publish',
          'failed',
          year,
          userInfo.user_id,
          userInfo.user_email,
          userInfo.user_name,
          sourceUrl,
          records.length,
          Date.now() - startTime,
          [],
          `Unmapped categories detected: ${unknownCategories.join(', ')}`
        );

        return res.status(409).json({
          status: 'error',
          message: 'Publish blocked: unmapped categories detected',
          data: {
            batchId: batch_id,
            unknownCategories
          }
        });
      }

      const invalidCategoryCodes = Array.from(
        new Set(
          records
            .map((r: any) => r.category_code)
            .filter((code: any) => code && !CANONICAL_TAX_CODES.has(String(code)))
        )
      );

      if (invalidCategoryCodes.length > 0) {
        await logAuditEvent(
          database,
          logger,
          batch_id,
          'publish',
          'failed',
          year,
          userInfo.user_id,
          userInfo.user_email,
          userInfo.user_name,
          sourceUrl,
          records.length,
          Date.now() - startTime,
          [],
          `Non-canonical category codes detected: ${invalidCategoryCodes.join(', ')}`
        );

        return res.status(409).json({
          status: 'error',
          message: 'Publish blocked: non-canonical category codes detected',
          data: {
            batchId: batch_id,
            invalidCategoryCodes
          }
        });
      }

      const years = Array.from(new Set(records.map((r: any) => r.year)));

      await database.transaction(async (trx: any) => {
        for (const y of years) {
          await trx('tax_rates_live').where('year', '=', y).delete();
        }

        const liveRows = records.map((r: any) => ({
          year: r.year,
          raw_category_label: r.raw_category_label,
          category_code: r.category_code,
          band_from: r.band_from,
          band_to: r.band_to,
          rate: r.rate,
          subtract: r.subtract,
          source_url: r.source_url,
          date_created: new Date()
        }));

        await trx('tax_rates_live').insert(liveRows);

        await trx('tax_rates_import')
          .where('batch_id', '=', batch_id)
          .update({ status: 'approved' });
      });

      const processingTime = Date.now() - startTime;

      // Log successful publish to audit trail
      await logAuditEvent(
        database,
        logger,
        batch_id,
        'publish',
        'success',
        year,
        userInfo.user_id,
        userInfo.user_email,
        userInfo.user_name,
        sourceUrl,
        records.length,
        processingTime,
        undefined,
        `Successfully published ${records.length} tax rates for year(s): ${years.join(', ')}`
      );

      res.json({
        status: 'success',
        data: {
          batchId: batch_id,
          publishStatus: 'published',
          yearsAffected: years,
          published_by: {
            user_id: userInfo.user_id,
            user_email: userInfo.user_email,
            user_name: userInfo.user_name,
            timestamp: new Date().toISOString()
          },
          summary: {
            totalRows: records.length,
            published: records.length,
            failed: 0,
            processingTimeMs: processingTime,
            validationPassed: true
          }
        }
      });
    } catch (error) {
      logger.error('Publish error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to publish batch',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /tax/publish/audit/:batch_id
   * Retrieve audit log for a specific batch
   */
  router.get('/tax/publish/audit/:batch_id', async (req: any, res: any) => {
    try {
      const { batch_id } = req.params;

      const auditLogs = await database('tax_publish_audit_log')
        .where('batch_id', '=', batch_id)
        .orderBy('timestamp', 'desc');

      res.json({
        status: 'success',
        data: {
          batchId: batch_id,
          auditEntries: auditLogs
        }
      });
    } catch (error) {
      logger.error('Audit lookup error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to retrieve audit log'
      });
    }
  });

  /**
   * GET /tax/publish/audit/recent/:limit
   * Retrieve recent audit logs
   */
  router.get('/tax/publish/audit/recent/:limit', async (req: any, res: any) => {
    try {
      const limit = Math.min(Number(req.params.limit) || 50, 500);

      const auditLogs = await database('tax_publish_audit_log')
        .orderBy('timestamp', 'desc')
        .limit(limit);

      res.json({
        status: 'success',
        data: {
          recent_audits: auditLogs
        }
      });
    } catch (error) {
      logger.error('Audit lookup error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to retrieve audit logs'
      });
    }
  });
});
