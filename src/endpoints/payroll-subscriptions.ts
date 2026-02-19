import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';

export default defineEndpoint((router: Router, { database, logger }: any) => {
  /**
   * GET /payroll/subscriptions/:emp_id
   * List all payroll subscriptions for an employee
   */
  router.get('/payroll/subscriptions/:emp_id', async (req: any, res: any) => {
    try {
      const empId = Number(req.params.emp_id);
      if (!Number.isFinite(empId)) {
        return res.status(400).json({ error: 'Invalid employee ID' });
      }

      const result = await database('payroll_subscriptions')
        .where('employee_id', empId)
        .orderBy(['payroll_type', 'active_from']);

      res.json({
        count: result.length,
        subscriptions: result
      });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
  });

  /**
   * POST /payroll/subscriptions
   * Create or update a subscription
   */
  router.post('/payroll/subscriptions', async (req: any, res: any) => {
    try {
      const { employee_id, payroll_type, employment_number, active_from, active_to, is_sync_to_opendental } = req.body;

      if (!employee_id || !payroll_type || !employment_number) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const validPayrollTypes = ['MAIN', 'PROVIDER', 'THIRDPARTY'];
      if (!validPayrollTypes.includes(payroll_type)) {
        return res.status(400).json({ error: `Invalid payroll_type. Allowed: ${validPayrollTypes.join(', ')}` });
      }

      const result = await database('payroll_subscriptions')
        .insert({
          employee_id,
          payroll_type,
          employment_number,
          active_from: active_from || new Date().toISOString().split('T')[0],
          active_to: active_to || null,
          is_sync_to_opendental: is_sync_to_opendental !== false
        })
        .onConflict(['employee_id', 'payroll_type', 'employment_number'])
        .merge()
        .returning('*');

      res.json({
        ok: true,
        subscription: result[0]
      });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to create subscription' });
    }
  });

  /**
   * PATCH /payroll/subscriptions/:id
   * Update a subscription (e.g., move to different payroll, deactivate)
   */
  router.patch('/payroll/subscriptions/:id', async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid subscription ID' });
      }

      const updateData: Record<string, any> = {};
      if (req.body.payroll_type) updateData.payroll_type = req.body.payroll_type;
      if (req.body.employment_number) updateData.employment_number = req.body.employment_number;
      if (req.body.active_from) updateData.active_from = req.body.active_from;
      if (req.body.active_to) updateData.active_to = req.body.active_to;
      if (req.body.active_to === null) updateData.active_to = null;
      if ('is_sync_to_opendental' in req.body) updateData.is_sync_to_opendental = req.body.is_sync_to_opendental;

      const result = await database('payroll_subscriptions')
        .where('id', id)
        .update(updateData)
        .returning('*');

      if (result.length === 0) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      res.json({
        ok: true,
        subscription: result[0]
      });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to update subscription' });
    }
  });

  /**
   * GET /payroll/subscriptions/pending-sync
   * List all subscriptions pending OpenDental sync
   */
  router.get('/payroll/subscriptions/pending-sync', async (req: any, res: any) => {
    try {
      const result = await database('vw_payroll_subscriptions_pending_sync');
      res.json({
        count: result.length,
        pending: result
      });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to fetch pending syncs' });
    }
  });

  /**
   * POST /payroll/subscriptions/:id/sync-opendental
   * Sync a subscription to OpenDental (placeholder for now)
   * In reality, this would call the OpenDental API or execute a stored proc
   */
  router.post('/payroll/subscriptions/:id/sync-opendental', async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid subscription ID' });
      }

      const sub = await database('payroll_subscriptions').where('id', id).first();
      if (!sub) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      // Placeholder: in production, this would call OpenDental API
      // For now, just mark as SKIPPED
      const result = await database('payroll_subscriptions')
        .where('id', id)
        .update({
          od_sync_status: 'SKIPPED',
          od_sync_error: 'OpenDental sync endpoint not yet implemented',
          od_sync_date: new Date()
        })
        .returning('*');

      res.json({
        ok: true,
        subscription: result[0],
        message: 'Sync marked as SKIPPED (endpoint not yet implemented)'
      });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to sync subscription' });
    }
  });
});
