import { Router } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

interface FormGenerationRequest {
  employee_id: number;
  employment_type?: string;
  form_types?: ('engagement' | 'fs4')[];
  language?: 'en' | 'mt'; // For FS4 form (default: 'en')
}

interface FormGenerationResponse {
  ok: boolean;
  employee_id: number;
  forms: {
    engagement?: string; // Base64 encoded PDF
    fs4?: string;        // Base64 encoded PDF
  };
  error?: string;
}

export default (router: Router, { database, logger }: any) => {
  /**
   * POST /forms/generate
   * Generate pre-filled PDF forms (engagement form + FS4) for an employee
   */
  router.post('/forms/generate', async (req: any, res: any) => {
    try {
      const { employee_id, form_types = ['engagement', 'fs4'], language = 'en' } = req.body as FormGenerationRequest;

      if (!employee_id) {
        return res.status(400).json({ error: 'employee_id is required' });
      }

      // Fetch employee data
      const empResult = await database('vw_employee_current')
        .where('emp_id', employee_id)
        .first();

      if (!empResult) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      // Fetch wage history (for hourly rate)
      const wageResult = await database('wage_history')
        .where('employee_id', employee_id)
        .orderBy('effective_date', 'desc')
        .first();

      // Fetch employment terms
      const empTerms = await database('employee_employment_terms')
        .where('emp_id', employee_id)
        .first();

      // Fetch payroll subscription to get SS class and tax category
      const subscription = await database('payroll_subscriptions')
        .where('employee_id', employee_id)
        .where('payroll_type', 'MAIN')
        .orderBy('active_from', 'desc')
        .first();

      // Fetch current wage data for SS class and tax info
      const period = new Date();
      const wageCalcData = await database('wage_history')
        .where('employee_id', employee_id)
        .where('effective_date', '<=', period.toISOString().split('T')[0])
        .orderBy('effective_date', 'desc')
        .first();

      const taxCategory = String(wageCalcData?.tax_category || '').toUpperCase();
      const taxStatus = {
        tax_status_single: taxCategory === 'SINGLE' || taxCategory === 'S',
        tax_status_married: taxCategory === 'MAR',
        tax_status_married_one_child: taxCategory === 'MAR1',
        tax_status_married_two_children: taxCategory === 'MAR2',
        tax_status_parent: taxCategory === 'PAR',
        tax_status_parent_one_child: taxCategory === 'PAR1',
        tax_status_parent_two_children: taxCategory === 'PAR2'
      };

      const payerDefaults = {
        payer_pe_number: '474436',
        payer_name: 'Christian Gauci',
        payer_phone: '77826685',
        payer_email: 'chrisgauci@mediatrixmalta.com',
        payer_address_line1: '7, Triq is-Santwarju',
        payer_address_line2: 'Zabbar',
        payer_address_line3: '',
        payer_postcode: 'ZBR1010',
        payer_declaration_full_name_position: 'Christian Gauci - Owner'
      };

      // Build employee data object
      const employeeData = {
        employee_full_name: `${empResult.first_name} ${empResult.surname}`,
        first_name: empResult.first_name || '',
        surname: empResult.surname || '',
        employee_id: String(employee_id),
        dob: empResult.dob,
        identity_card: empResult.id_number || '',
        identity_card_number: empResult.id_number || '',
        social_security_number: empResult.ni_number || empResult.social_security_number || '',
        payee_identity_card_tax_number: empResult.id_number || '',
        payee_spouse_identity_card_tax_number: '',
        payee_marriage_date: '',
        payee_surname: empResult.surname || '',
        payee_name: empResult.first_name || '',
        payee_dob: empResult.dob,
        payee_social_security_number: empResult.ni_number || empResult.social_security_number || '',
        payee_nationality: empResult.nationality || '',
        payee_long_term_resident_status: false,
        address: `${empResult.street_address || ''}, ${empResult.locality || ''}`.trim(),
        residence_number_name: empResult.house_number || empResult.residence_name || '',
        street: empResult.street_address || '',
        locality: empResult.locality || '',
        postcode: empResult.postcode || '',
        email_address: empResult.email || '',
        mobile_number: empResult.mobile || empResult.mobile_number || '',
        telephone_number: empResult.telephone || empResult.phone || '',
        gender: empResult.gender || '',
        nationality: empResult.nationality || '',
        position: empResult.job_title || '',
        department: empResult.department || '',
        employment_type: empTerms?.employment_type || 'Permanent',
        nature_of_employment: empTerms?.employment_nature || '',
        commencement_date: empTerms?.employment_date || empResult.employment_date,
        job_title: empResult.job_title || '',
        working_patterns: empTerms?.working_patterns || '',
        place_of_employment: empTerms?.place_of_employment || '',
        work_arrangement: empTerms?.work_arrangement || '',
        town_city: empResult.locality || '',
        hourly_rate: wageResult?.hourly_rate ? String(wageResult.hourly_rate) : '0.00',
        weekly_hours: String(empTerms?.weekly_hours || 40),
        contract_start_date: empTerms?.employment_date || empResult.employment_date,
        contract_end_date: empTerms?.termination_date || null,
        employment_date: empResult.employment_date,
        employment_end_date: empTerms?.termination_date || null,
        ss_class: wageCalcData?.ss_class || 'A',
        tax_category: wageCalcData?.tax_category || '1',
        part_time_main_income_employer_name: '',
        part_time_main_income_pe_number: '',
        part_time_main_income_pension: false,
        part_time_do_not_deduct: false,
        part_time_deduct_10pct: false,
        scheme_returning_employment_0pct: false,
        scheme_overseas_employment_15pct: false,
        scheme_sport_activity_7_5pct: false,
        scheme_other: false,
        scheme_opt_out_overtime_15pct: false,
        other_emoluments_deduct_20pct: false,
        other_emoluments_higher_rate_pct: '',
        other_emoluments_lower_rate_pensioner_pct: '',
        other_emoluments_lower_rate_non_pensioner_pct: '',
        signature_date: new Date().toISOString().split('T')[0],
        form_submitted_date: new Date().toISOString().split('T')[0],
        employee_declaration_date: new Date().toISOString().split('T')[0],
        employee_declaration_signature: '',
        payer_declaration_signature: '',
        payer_declaration_signature_date: new Date().toISOString().split('T')[0],
        ...payerDefaults,
        ...taxStatus
      };

      // Call Python forms filler
      const formsData = await generateFormsWithPython(employeeData, form_types, language, logger);

      if (!formsData.ok) {
        return res.status(500).json({
          ok: false,
          employee_id,
          error: formsData.error
        });
      }

      res.json({
        ok: true,
        employee_id,
        forms: formsData.forms
      });
    } catch (error) {
      logger.error('Forms generation error:', error);
      res.status(500).json({ error: 'Failed to generate forms' });
    }
  });

  /**
   * GET /forms/generate/:emp_id
   * Get pre-filled forms for employee (preview/download)
   */
  router.get('/forms/generate/:emp_id', async (req: any, res: any) => {
    try {
      const empId = Number(req.params.emp_id);
      const formTypes = req.query.forms ? (req.query.forms as string).split(',') : ['engagement', 'fs4'];
      const language = (req.query.language || 'en') as 'en' | 'mt';

      // Validate parameters
      if (!Number.isFinite(empId)) {
        return res.status(400).json({ error: 'Invalid employee_id' });
      }

      // Fetch employee data (same as POST)
      const empResult = await database('vw_employee_current')
        .where('emp_id', empId)
        .first();

      if (!empResult) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      // Fetch wage history
      const wageResult = await database('wage_history')
        .where('employee_id', empId)
        .orderBy('effective_date', 'desc')
        .first();

      const empTerms = await database('employee_employment_terms')
        .where('emp_id', empId)
        .first();

      const wageCalcData = await database('wage_history')
        .where('employee_id', empId)
        .orderBy('effective_date', 'desc')
        .first();

      const taxCategory = String(wageCalcData?.tax_category || '').toUpperCase();
      const taxStatus = {
        tax_status_single: taxCategory === 'SINGLE' || taxCategory === 'S',
        tax_status_married: taxCategory === 'MAR',
        tax_status_married_one_child: taxCategory === 'MAR1',
        tax_status_married_two_children: taxCategory === 'MAR2',
        tax_status_parent: taxCategory === 'PAR',
        tax_status_parent_one_child: taxCategory === 'PAR1',
        tax_status_parent_two_children: taxCategory === 'PAR2'
      };

      const payerDefaults = {
        payer_pe_number: '474436',
        payer_name: 'Christian Gauci',
        payer_phone: '77826685',
        payer_email: 'chrisgauci@mediatrixmalta.com',
        payer_address_line1: '7, Triq is-Santwarju',
        payer_address_line2: 'Zabbar',
        payer_address_line3: '',
        payer_postcode: 'ZBR1010',
        payer_declaration_full_name_position: 'Christian Gauci - Owner'
      };

      const taxCategory = String(wageCalcData?.tax_category || '').toUpperCase();
      const taxStatus = {
        tax_status_single: taxCategory === 'SINGLE' || taxCategory === 'S',
        tax_status_married: taxCategory === 'MAR',
        tax_status_married_one_child: taxCategory === 'MAR1',
        tax_status_married_two_children: taxCategory === 'MAR2',
        tax_status_parent: taxCategory === 'PAR',
        tax_status_parent_one_child: taxCategory === 'PAR1',
        tax_status_parent_two_children: taxCategory === 'PAR2'
      };

      const payerDefaults = {
        payer_pe_number: '474436',
        payer_name: 'Christian Gauci',
        payer_phone: '77826685',
        payer_email: 'chrisgauci@mediatrixmalta.com',
        payer_address_line1: '7, Triq is-Santwarju',
        payer_address_line2: 'Zabbar',
        payer_address_line3: '',
        payer_postcode: 'ZBR1010',
        payer_declaration_full_name_position: 'Christian Gauci - Owner'
      };

      // Build employee data
      const employeeData = {
        employee_full_name: `${empResult.first_name} ${empResult.surname}`,
        first_name: empResult.first_name || '',
        surname: empResult.surname || '',
        employee_id: String(empId),
        dob: empResult.dob,
        identity_card: empResult.id_number || '',
        identity_card_number: empResult.id_number || '',
        social_security_number: empResult.ni_number || empResult.social_security_number || '',
        payee_identity_card_tax_number: empResult.id_number || '',
        payee_spouse_identity_card_tax_number: '',
        payee_marriage_date: '',
        payee_surname: empResult.surname || '',
        payee_name: empResult.first_name || '',
        payee_dob: empResult.dob,
        payee_social_security_number: empResult.ni_number || empResult.social_security_number || '',
        payee_nationality: empResult.nationality || '',
        payee_long_term_resident_status: false,
        address: `${empResult.street_address || ''}, ${empResult.locality || ''}`.trim(),
        residence_number_name: empResult.house_number || empResult.residence_name || '',
        street: empResult.street_address || '',
        locality: empResult.locality || '',
        postcode: empResult.postcode || '',
        email_address: empResult.email || '',
        mobile_number: empResult.mobile || empResult.mobile_number || '',
        telephone_number: empResult.telephone || empResult.phone || '',
        gender: empResult.gender || '',
        nationality: empResult.nationality || '',
        position: empResult.job_title || '',
        department: empResult.department || '',
        employment_type: empTerms?.employment_type || 'Permanent',
        nature_of_employment: empTerms?.employment_nature || '',
        commencement_date: empTerms?.employment_date || empResult.employment_date,
        job_title: empResult.job_title || '',
        working_patterns: empTerms?.working_patterns || '',
        place_of_employment: empTerms?.place_of_employment || '',
        work_arrangement: empTerms?.work_arrangement || '',
        town_city: empResult.locality || '',
        hourly_rate: wageResult?.hourly_rate ? String(wageResult.hourly_rate) : '0.00',
        weekly_hours: String(empTerms?.weekly_hours || 40),
        contract_start_date: empTerms?.employment_date || empResult.employment_date,
        contract_end_date: empTerms?.termination_date || null,
        employment_date: empResult.employment_date,
        employment_end_date: empTerms?.termination_date || null,
        ss_class: wageCalcData?.ss_class || 'A',
        tax_category: wageCalcData?.tax_category || '1',
        part_time_main_income_employer_name: '',
        part_time_main_income_pe_number: '',
        part_time_main_income_pension: false,
        part_time_do_not_deduct: false,
        part_time_deduct_10pct: false,
        scheme_returning_employment_0pct: false,
        scheme_overseas_employment_15pct: false,
        scheme_sport_activity_7_5pct: false,
        scheme_other: false,
        scheme_opt_out_overtime_15pct: false,
        other_emoluments_deduct_20pct: false,
        other_emoluments_higher_rate_pct: '',
        other_emoluments_lower_rate_pensioner_pct: '',
        other_emoluments_lower_rate_non_pensioner_pct: '',
        signature_date: new Date().toISOString().split('T')[0],
        form_submitted_date: new Date().toISOString().split('T')[0],
        employee_declaration_date: new Date().toISOString().split('T')[0],
        employee_declaration_signature: '',
        payer_declaration_signature: '',
        payer_declaration_signature_date: new Date().toISOString().split('T')[0],
        ...payerDefaults,
        ...taxStatus
      };

      // Generate forms
      const formsData = await generateFormsWithPython(employeeData, formTypes, language, logger);

      if (!formsData.ok) {
        return res.status(500).json({
          ok: false,
          employee_id: empId,
          error: formsData.error
        });
      }

      res.json({
        ok: true,
        employee_id: empId,
        employee_name: employeeData.employee_full_name,
        language,
        forms: formsData.forms
      });
    } catch (error) {
      logger.error('Forms retrieval error:', error);
      res.status(500).json({ error: 'Failed to retrieve forms' });
    }
  });

  /**
   * GET /forms/download/:emp_id/:form_type
   * Download single form as PDF file
   */
  router.get('/forms/download/:emp_id/:form_type', async (req: any, res: any) => {
    try {
      const empId = Number(req.params.emp_id);
      const formType = req.params.form_type as 'engagement' | 'fs4';
      const language = (req.query.language || 'en') as 'en' | 'mt';

      if (!Number.isFinite(empId)) {
        return res.status(400).json({ error: 'Invalid employee_id' });
      }

      if (!['engagement', 'fs4'].includes(formType)) {
        return res.status(400).json({ error: 'Invalid form_type. Must be "engagement" or "fs4"' });
      }

      // Fetch employee data
      const empResult = await database('vw_employee_current')
        .where('emp_id', empId)
        .first();

      if (!empResult) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      const wageResult = await database('wage_history')
        .where('employee_id', empId)
        .orderBy('effective_date', 'desc')
        .first();

      const empTerms = await database('employee_employment_terms')
        .where('emp_id', empId)
        .first();

      const wageCalcData = await database('wage_history')
        .where('employee_id', empId)
        .orderBy('effective_date', 'desc')
        .first();

      // Build employee data
      const employeeData = {
        employee_full_name: `${empResult.first_name} ${empResult.surname}`,
        first_name: empResult.first_name || '',
        surname: empResult.surname || '',
        employee_id: String(empId),
        dob: empResult.dob,
        identity_card: empResult.id_number || '',
        identity_card_number: empResult.id_number || '',
        social_security_number: empResult.ni_number || empResult.social_security_number || '',
        payee_identity_card_tax_number: empResult.id_number || '',
        payee_spouse_identity_card_tax_number: '',
        payee_marriage_date: '',
        payee_surname: empResult.surname || '',
        payee_name: empResult.first_name || '',
        payee_dob: empResult.dob,
        payee_social_security_number: empResult.ni_number || empResult.social_security_number || '',
        payee_nationality: empResult.nationality || '',
        payee_long_term_resident_status: false,
        address: `${empResult.street_address || ''}, ${empResult.locality || ''}`.trim(),
        residence_number_name: empResult.house_number || empResult.residence_name || '',
        street: empResult.street_address || '',
        locality: empResult.locality || '',
        postcode: empResult.postcode || '',
        email_address: empResult.email || '',
        mobile_number: empResult.mobile || empResult.mobile_number || '',
        telephone_number: empResult.telephone || empResult.phone || '',
        gender: empResult.gender || '',
        nationality: empResult.nationality || '',
        position: empResult.job_title || '',
        department: empResult.department || '',
        employment_type: empTerms?.employment_type || 'Permanent',
        nature_of_employment: empTerms?.employment_nature || '',
        commencement_date: empTerms?.employment_date || empResult.employment_date,
        job_title: empResult.job_title || '',
        working_patterns: empTerms?.working_patterns || '',
        place_of_employment: empTerms?.place_of_employment || '',
        work_arrangement: empTerms?.work_arrangement || '',
        town_city: empResult.locality || '',
        hourly_rate: wageResult?.hourly_rate ? String(wageResult.hourly_rate) : '0.00',
        weekly_hours: String(empTerms?.weekly_hours || 40),
        contract_start_date: empTerms?.employment_date || empResult.employment_date,
        contract_end_date: empTerms?.termination_date || null,
        employment_date: empResult.employment_date,
        employment_end_date: empTerms?.termination_date || null,
        ss_class: wageCalcData?.ss_class || 'A',
        tax_category: wageCalcData?.tax_category || '1',
        part_time_main_income_employer_name: '',
        part_time_main_income_pe_number: '',
        part_time_main_income_pension: false,
        part_time_do_not_deduct: false,
        part_time_deduct_10pct: false,
        scheme_returning_employment_0pct: false,
        scheme_overseas_employment_15pct: false,
        scheme_sport_activity_7_5pct: false,
        scheme_other: false,
        scheme_opt_out_overtime_15pct: false,
        other_emoluments_deduct_20pct: false,
        other_emoluments_higher_rate_pct: '',
        other_emoluments_lower_rate_pensioner_pct: '',
        other_emoluments_lower_rate_non_pensioner_pct: '',
        signature_date: new Date().toISOString().split('T')[0],
        form_submitted_date: new Date().toISOString().split('T')[0],
        employee_declaration_date: new Date().toISOString().split('T')[0],
        employee_declaration_signature: '',
        payer_declaration_signature: '',
        payer_declaration_signature_date: new Date().toISOString().split('T')[0],
        ...payerDefaults,
        ...taxStatus
      };

      // Generate requested form only
      const formsData = await generateFormsWithPython(employeeData, [formType], language, logger);

      if (!formsData.ok || !formsData.forms[formType]) {
        return res.status(500).json({ error: `Failed to generate ${formType} form` });
      }

      // Extract base64 and convert back to PDF binary
      const pdfBase64 = formsData.forms[formType];
      const pdfBuffer = Buffer.from(pdfBase64, 'base64');

      // Set response headers for file download
      const filename = formType === 'engagement' 
        ? `engagement_${empId}_${new Date().toISOString().split('T')[0]}.pdf`
        : `fs4_${language}_${empId}_${new Date().toISOString().split('T')[0]}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfBuffer);

    } catch (error) {
      logger.error('Form download error:', error);
      res.status(500).json({ error: 'Failed to download form' });
    }
  });
};

/**
 * Call Python forms filler service to generate filled PDFs
 */
async function generateFormsWithPython(
  employeeData: any,
  formTypes: string[],
  language: string,
  logger: any
): Promise<{ ok: boolean; forms: Record<string, string>; error?: string }> {
  return new Promise((resolve) => {
    const pythonScript = path.join(__dirname, '../..', 'importer/src/forms_filler.py');
    
    // Prepare arguments for Python script
    const args = [
      '--employee-data', JSON.stringify(employeeData),
      '--form-types', formTypes.join(','),
      '--language', language
    ];

    const python = spawn('python', [pythonScript, ...args], {
      cwd: path.join(__dirname, '../..')
    });

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
      logger.warn(`Python stderr: ${data}`);
    });

    python.on('close', (code) => {
      if (code !== 0) {
        logger.error(`Python script failed with code ${code}: ${stderr}`);
        resolve({ ok: false, forms: {}, error: `Form generation failed: ${stderr}` });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        if (result.ok) {
          resolve({ ok: true, forms: result.forms });
        } else {
          resolve({ ok: false, forms: {}, error: result.error });
        }
      } catch (e) {
        logger.error(`Failed to parse Python output: ${stdout}`);
        resolve({ ok: false, forms: {}, error: 'Failed to parse form generation response' });
      }
    });

    python.on('error', (err) => {
      logger.error(`Failed to spawn Python process: ${err}`);
      resolve({ ok: false, forms: {}, error: `Failed to start form generation: ${err.message}` });
    });
  });
}
