export type ProviderInvoiceInput = {
  issuer_name: string;
  issuer_address_lines: string[];
  issuer_phone?: string;
  invoice_number: string; // e.g. 001/2026
  invoice_date: string; // YYYY-MM-DD or dd.mm.yyyy (stored as text)
  bill_to_lines: string[];
  service_period_label: string; // e.g. Jan 2026
  currency?: string; // default EUR
  official_amount: number;
  bank_details: {
    beneficiary: string;
    bank_name: string;
    bic_swift: string;
    iban: string;
  };
};

export type ProviderInvoiceOutput = {
  layout: {
    style: 'THIRDPARTY_PROVIDER_SIMPLE';
    show_logo: false;
    show_employer_info: false;
    title: string;
  };
  header: {
    issuer_name: string;
    issuer_address_lines: string[];
    issuer_phone?: string;
  };
  billing: {
    invoice_number: string;
    invoice_date: string;
    bill_to_lines: string[];
  };
  lines: Array<{
    details: string;
    currency: string;
    amount: number;
  }>;
  totals: {
    currency: string;
    total_due: number;
  };
  remittance: {
    beneficiary: string;
    bank_name: string;
    bic_swift: string;
    iban: string;
  };
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const buildProviderInvoice = (input: ProviderInvoiceInput): ProviderInvoiceOutput => {
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
