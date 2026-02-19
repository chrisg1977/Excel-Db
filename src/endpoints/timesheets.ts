import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';
import * as csv from 'csv-parse/sync';

export default defineEndpoint((router: Router, { database, logger }: any) => {
  /**
   * POST /payroll/timesheets/import-csv
   * Import timesheets from CSV (manual upload)
   */
  router.post('/payroll/timesheets/import-csv', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { csv_data, import_source = 'CSV' } = req.body;
      if (!csv_data) return res.status(400).json({ error: 'csv_data required' });

      let records: any[];
      try {
        records = csv.parse(csv_data, { columns: true, trim: true, skip_empty_lines: true });
      } catch (e: any) {
        return res.status(400).json({ error: 'Invalid CSV format', details: e.message });
      }

      if (!records.length) return res.status(400).json({ error: 'No records in CSV' });

      const inserted = [];
      const errors = [];

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const row_num = i + 2;

        try {
          if (!row.emp_id || !row.work_date || !row.hours || !row.hour_type) {
            errors.push({ row: row_num, error: 'Missing required fields' });
            continue;
          }

          const valid_types = ['WORK', 'SICK_LEAVE', 'VACATION_LEAVE', 'UNPAID_LEAVE', 'MATERNITY'];
          if (!valid_types.includes(row.hour_type.toUpperCase())) {
            errors.push({ row: row_num, error: `Invalid hour_type: ${row.hour_type}` });
            continue;
          }

          const emp = await database('employees').where('emp_id', '=', parseInt(row.emp_id)).first();
          if (!emp) {
            errors.push({ row: row_num, error: `Employee ${row.emp_id} not found` });
            continue;
          }

          await database('timesheets').insert({
            emp_id: parseInt(row.emp_id),
            work_date: row.work_date,
            hours: parseFloat(row.hours),
            hour_type: row.hour_type.toUpperCase(),
            notes: row.notes || null,
            source: import_source,
            import_date: new Date(),
          });

          inserted.push({
            emp_id: parseInt(row.emp_id),
            work_date: row.work_date,
            hours: parseFloat(row.hours),
            hour_type: row.hour_type.toUpperCase(),
          });
        } catch (e: any) {
          errors.push({ row: row_num, error: e.message });
          logger.error(`Row ${row_num} error:`, e);
        }
      }

      return res.json({
        status: 'success',
        inserted: inserted.length,
        total_rows: records.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      logger.error('Error importing CSV timesheets:', error);
      return res.status(500).json({ error: 'Failed to import timesheets', details: error.message });
    }
  });

  /**
   * POST /payroll/timesheets/import-opendental
   * Placeholder for OpenDental API integration
   */
  router.post('/payroll/timesheets/import-opendental', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { start_date, end_date, opendental_api_url, api_key } = req.body;
      if (!start_date || !end_date || !opendental_api_url || !api_key) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      logger.info(`OpenDental import requested: ${start_date} to ${end_date}`);

      return res.status(501).json({
        status: 'not_implemented',
        message: 'OpenDental API integration not yet configured',
        instructions: 'Please provide OpenDental API documentation for implementation',
      });
    } catch (error: any) {
      logger.error('Error with OpenDental import:', error);
      return res.status(500).json({ error: 'Failed to import from OpenDental', details: error.message });
    }
  });

  /**
   * GET /payroll/timesheets?emp_id=...&start_date=...&end_date=...&hour_type=...
   */
  router.get('/payroll/timesheets', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { emp_id, start_date, end_date, hour_type } = req.query;
      let query = database('timesheets');

      if (emp_id) query = query.where('emp_id', '=', parseInt(emp_id));
      if (start_date) query = query.where('work_date', '>=', start_date);
      if (end_date) query = query.where('work_date', '<=', end_date);
      if (hour_type) query = query.where('hour_type', '=', hour_type.toUpperCase());

      const timesheets = await query.orderBy('work_date', 'desc');
      return res.json({ count: timesheets.length, timesheets });
    } catch (error: any) {
      logger.error('Error fetching timesheets:', error);
      return res.status(500).json({ error: 'Failed to fetch timesheets', details: error.message });
    }
  });

  /**
   * GET /payroll/timesheets/summary/:emp_id/:year/:month
   */
  router.get('/payroll/timesheets/summary/:emp_id/:year/:month', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const emp_id = parseInt(req.params.emp_id);
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);

      if (isNaN(emp_id) || isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Invalid parameters' });
      }

      const summary = await database('timesheet_summary_monthly')
        .where('emp_id', '=', emp_id)
        .whereRaw(`EXTRACT(YEAR FROM payroll_month) = ?`, [year])
        .whereRaw(`EXTRACT(MONTH FROM payroll_month) = ?`, [month])
        .first();

      if (!summary) {
        return res.json({ message: 'No timesheets found for this period', emp_id, year, month, summary: null });
      }

      const bonus_factor = summary.hours_worked > 0 ? (summary.hours_worked / summary.total_paid_hours) : 0;

      return res.json({
        emp_id,
        payroll_month: summary.payroll_month,
        summary: {
          hours_worked: parseFloat(summary.hours_worked || 0),
          paid_sick_leave_hours: parseFloat(summary.paid_sick_leave_hours || 0),
          unpaid_sick_leave_hours: parseFloat(summary.unpaid_sick_leave_hours || 0),
          paid_vacation_leave_hours: parseFloat(summary.paid_vacation_leave_hours || 0),
          unpaid_vacation_leave_hours: parseFloat(summary.unpaid_vacation_leave_hours || 0),
          unpaid_leave_hours: parseFloat(summary.unpaid_leave_hours || 0),
          total_paid_hours: parseFloat(summary.total_paid_hours || 0),
          total_hours_logged: parseFloat(summary.total_hours_logged || 0),
          bonus_calculation_factor: bonus_factor,
        },
      });
    } catch (error: any) {
      logger.error('Error fetching timesheet summary:', error);
      return res.status(500).json({ error: 'Failed to fetch timesheet summary', details: error.message });
    }
  });

  /**
   * DELETE /payroll/timesheets/:id
   */
  router.delete('/payroll/timesheets/:id', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid timesheet ID' });

      const deleted = await database('timesheets').where('id', '=', id).delete();
      if (deleted === 0) return res.status(404).json({ error: 'Timesheet not found' });

      return res.json({ message: 'Timesheet deleted', id });
    } catch (error: any) {
      logger.error('Error deleting timesheet:', error);
      return res.status(500).json({ error: 'Failed to delete timesheet', details: error.message });
    }
  });

  /**
   * PATCH /payroll/timesheets/:id
   */
  router.patch('/payroll/timesheets/:id', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const id = parseInt(req.params.id);
      const { hours, hour_type, notes } = req.body;

      if (isNaN(id)) return res.status(400).json({ error: 'Invalid timesheet ID' });

      const update_data: any = { updated_at: new Date() };
      if (hours !== undefined) update_data.hours = parseFloat(hours);
      if (hour_type !== undefined) update_data.hour_type = hour_type.toUpperCase();
      if (notes !== undefined) update_data.notes = notes;

      const updated = await database('timesheets').where('id', '=', id).update(update_data);
      if (updated === 0) return res.status(404).json({ error: 'Timesheet not found' });

      const record = await database('timesheets').where('id', '=', id).first();
      return res.json({ message: 'Timesheet updated', timesheet: record });
    } catch (error: any) {
      logger.error('Error updating timesheet:', error);
      return res.status(500).json({ error: 'Failed to update timesheet', details: error.message });
    }
  });
});
