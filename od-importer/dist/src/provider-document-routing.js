const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const normalizeRoot = (root) => {
    if (!root || !root.trim())
        return '';
    return root.replace(/[\\/]+$/, '');
};
const withRoot = (root, path) => (root ? `${root}/${path}` : path);
const sanitize = (value) => value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
const validateMonth = (month) => {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new Error('period_month must be an integer from 1 to 12');
    }
};
export const reservedThirdPartyInvoiceNumber = (year, month) => {
    validateMonth(month);
    // Reserve first 12 invoice numbers of each year for this use case.
    return `${String(month).padStart(3, '0')}/${year}`;
};
export const buildProviderDocumentPlan = (input) => {
    validateMonth(input.period_month);
    const monthName = monthNames[input.period_month - 1];
    const mm = String(input.period_month).padStart(2, '0');
    const root = normalizeRoot(input.root_directory);
    const providerSlug = sanitize(input.provider_name || input.provider_id);
    const payslipDirectory = `${input.period_year} Provider Payslips/${monthName}`;
    const payslipCanonical = `PROVIDER_PAYSLIP_${input.provider_id}_${input.period_year}-${mm}_${providerSlug}.pdf`;
    const plan = {
        payslip: {
            directory: payslipDirectory,
            canonical_filename: payslipCanonical,
            full_path: withRoot(root, `${payslipDirectory}/${payslipCanonical}`)
        }
    };
    if (!input.is_subscribed_main_payroll) {
        const invoiceNumber = reservedThirdPartyInvoiceNumber(input.period_year, input.period_month);
        const invoiceDirectory = `${input.period_year} Running Invoices/third party providers/${monthName}`;
        const invoiceCanonical = `THIRDPARTY_PROVIDER_INVOICE_${invoiceNumber.replace('/', '-')}_${input.provider_id}_${providerSlug}.pdf`;
        plan.invoice = {
            required: true,
            invoice_number: invoiceNumber,
            directory: invoiceDirectory,
            canonical_filename: invoiceCanonical,
            full_path: withRoot(root, `${invoiceDirectory}/${invoiceCanonical}`)
        };
    }
    return plan;
};
export const resolveScannedDocumentTarget = (input) => {
    validateMonth(input.period_month);
    const monthName = monthNames[input.period_month - 1];
    const mm = String(input.period_month).padStart(2, '0');
    const root = normalizeRoot(input.root_directory);
    if (input.document_type === 'PROVIDER_PAYSLIP_SIGNED') {
        const directory = `${input.period_year} Provider Payslips/${monthName}/signed`;
        const canonicalFilename = `PROVIDER_PAYSLIP_SIGNED_${input.provider_id}_${input.period_year}-${mm}.pdf`;
        return {
            directory,
            canonical_filename: canonicalFilename,
            full_path: withRoot(root, `${directory}/${canonicalFilename}`)
        };
    }
    const invoiceNumber = input.invoice_number || reservedThirdPartyInvoiceNumber(input.period_year, input.period_month);
    const directory = `${input.period_year} Running Invoices/third party providers/${monthName}/signed`;
    const canonicalFilename = `THIRDPARTY_PROVIDER_INVOICE_SIGNED_${invoiceNumber.replace('/', '-')}_${input.provider_id}.pdf`;
    return {
        directory,
        canonical_filename: canonicalFilename,
        full_path: withRoot(root, `${directory}/${canonicalFilename}`)
    };
};
