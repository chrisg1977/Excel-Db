const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const buildProviderInvoice = (input) => {
    const currency = input.currency ?? 'EUR';
    const officialAmount = round2(input.official_amount);
    if (officialAmount < 0) {
        throw new Error('official_amount must be non-negative');
    }
    return {
        layout: {
            style: 'THIRDPARTY_PROVIDER_SIMPLE',
            show_logo: false,
            show_employer_info: false,
            title: 'Invoice'
        },
        header: {
            issuer_name: input.issuer_name,
            issuer_address_lines: input.issuer_address_lines,
            issuer_phone: input.issuer_phone
        },
        billing: {
            invoice_number: input.invoice_number,
            invoice_date: input.invoice_date,
            bill_to_lines: input.bill_to_lines
        },
        lines: [
            {
                details: `Services provided during ${input.service_period_label}`,
                currency,
                amount: officialAmount
            }
        ],
        totals: {
            currency,
            total_due: officialAmount
        },
        remittance: {
            beneficiary: input.bank_details.beneficiary,
            bank_name: input.bank_details.bank_name,
            bic_swift: input.bank_details.bic_swift,
            iban: input.bank_details.iban
        }
    };
};
