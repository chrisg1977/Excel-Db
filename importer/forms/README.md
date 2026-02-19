# Forms Generation System

## Overview
This system automatically fills PDF employment forms with employee data from the payroll database. It supports:
- **Engagement Form**: Employee contract/engagement document
- **FS4 Forms**: Malta statutory employment declaration forms (English & Maltese versions)

## Setup Requirements

### 1. PDF Templates
Place the following PDF template files in the `importer/forms/` directory:

#### File: `engagement-form-employee.pdf`
- **Description**: Base engagement/employment contract form
- **Requirements**: Must be an AcroForm PDF with fillable fields
- **Expected Fields** (optional - will fill if present):
  - `EmployeeName`, `EmployeeID`, `DOB`, `IDCard`, `Address`
  - `Position`, `Department`, `EmploymentType`
  - `HourlyRate`, `WeeklyHours`
  - `ContractStartDate`, `ContractEndDate`, `EmploymentDate`, `SignatureDate`

#### File: `fs4-en.pdf`
- **Description**: FS4 English version (Malta employment form)
- **Requirements**: Must be an AcroForm PDF
- **Expected Fields**:
  - `Name`, `EmployeeID`, `DateOfBirth`, `IdentityCard`, `Address`
  - `Position`, `SSClass`, `TaxCategory`
  - `EmploymentDate`, `EmploymentEndDate`, `SignatureDate`

#### File: `fs4-mt.pdf`
- **Description**: FS4 Maltese version
- **Requirements**: Must be an AcroForm PDF
- **Expected Fields** (Maltese names):
  - `Isem`, `NumID`, `DataWilada`, `CartaIdentita`, `Indirizz`
  - `Pożizzjoni`, `KlassSS`, `KategorjaTax`
  - `DataEmpilment`, `DataTemminazzjoni`, `DataFirma`

### 2. Python Dependencies
Required packages (already installed):
```bash
pip install pdfrw reportlab pillow
```

## API Endpoints

### POST `/forms/generate`
Generate pre-filled forms for an employee (returns base64-encoded PDFs).

**Request:**
```json
{
  "employee_id": 2018001,
  "form_types": ["engagement", "fs4"],
  "language": "en"
}
```

**Response:**
```json
{
  "ok": true,
  "employee_id": 2018001,
  "forms": {
    "engagement": "JVBERi0xLjQKJeLj...",  // Base64 encoded PDF
    "fs4": "JVBERi0xLjQKJeLj..."
  }
}
```

**Parameters:**
- `employee_id` (required): Employee ID number
- `form_types` (optional): Array of `["engagement", "fs4"]`. Default: both
- `language` (optional): `"en"` or `"mt"` for FS4 form. Default: `"en"`

---

### GET `/forms/generate/:emp_id`
Get pre-filled forms for employee (query parameters).

**URL:** `GET /forms/generate/2018001?forms=engagement,fs4&language=en`

**Response:** Same as POST endpoint

---

### GET `/forms/download/:emp_id/:form_type`
Download single form as PDF file.

**URL Examples:**
- `GET /forms/download/2018001/engagement`
- `GET /forms/download/2018001/fs4?language=mt`

**Response:** PDF file download

**Parameters:**
- `form_type`: `"engagement"` or `"fs4"`
- `language` (query): `"en"` or `"mt"` (only for FS4)

---

## Data Mapping

The system automatically maps employee database fields to form fields:

### Engagement Form
```
Database Field          → Form Field
employee.first_name/surname → EmployeeName
employee.emp_id         → EmployeeID
employee.dob            → DOB
employee.id_number      → IDCard
employee.address        → Address
employee.job_title      → Position
employee.department     → Department
employment_terms.employment_type → EmploymentType
wage_history.hourly_rate → HourlyRate
employment_terms.weekly_hours → WeeklyHours
employment_terms.employment_date → ContractStartDate/EmploymentDate
employment_terms.termination_date → ContractEndDate
current_date            → SignatureDate
```

### FS4 Form (English)
```
Database Field          → Form Field (EN) → Form Field (MT)
employee.first_name/surname → Name              → Isem
employee.emp_id         → EmployeeID         → NumID
employee.dob            → DateOfBirth        → DataWilada
employee.id_number      → IdentityCard       → CartaIdentita
employee.address        → Address            → Indirizz
employee.job_title      → Position           → Pożizzjoni
wage_history.ss_class   → SSClass            → KlassSS
wage_history.tax_category → TaxCategory      → KategorjaTax
employment.employment_date → EmploymentDate  → DataEmpilment
employment.termination_date → EmploymentEndDate → DataTemminazzjoni
current_date            → SignatureDate      → DataFirma
```

---

## Usage Examples

### JavaScript/Node.js (Directus Extension)
```typescript
// Generate both forms
const response = await fetch('/forms/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    employee_id: 2018001,
    form_types: ['engagement', 'fs4'],
    language: 'en'
  })
});

const data = await response.json();
// data.forms.engagement = base64 PDF
// data.forms.fs4 = base64 PDF
```

### Download PDF to File
```typescript
// Get download link for engagement form
const url = '/forms/download/2018001/engagement';
const link = document.createElement('a');
link.href = url;
link.download = 'engagement_2018001.pdf';
link.click();
```

### Python (Direct Usage)
```python
from importer.src.forms_filler import FormsFiller

filler = FormsFiller()

employee_data = {
    'employee_full_name': 'John Doe',
    'employee_id': '2018001',
    'dob': '1990-05-15',
    'identity_card': '590123A',
    'address': '123 Main St, Valletta',
    'position': 'Software Engineer',
    'ss_class': 'A',
    'tax_category': '1'
}

# Generate engagement form
filler.fill_engagement_form(employee_data, '/path/to/output/engagement.pdf')

# Generate FS4 form (English or Maltese)
filler.fill_fs4_form(employee_data, language='en', output_path='/path/to/output/fs4.pdf')

# Generate both at once
engagement_path, fs4_path = filler.generate_forms_package(
    employee_data,
    language='mt',
    output_dir='/path/to/forms'
)
```

---

## Form Field Format Notes

### Date Fields
All dates are automatically converted from ISO format (YYYY-MM-DD) to readable format: `DD MMM YYYY`

Example: `1990-05-15` → `15 May 1990`

### Currency Fields
Hourly rates and other monetary values are converted to strings with appropriate formatting.

### Enum Fields
Employment types, SS classes, and tax categories are converted to appropriate string representations.

---

## Creating PDF Templates with AcroForm

### Using Adobe Acrobat
1. Open or create your base form (DOCX, etc.)
2. Export as PDF
3. Use Acrobat's "Prepare Form" tool
4. Add form fields and name them according to the field mappings above
5. Export as PDF (save to `importer/forms/`)

### Using Online Tools
- ilovepdf.com form editor
- smallpdf.com/form filler
- pdf.io

### Using Python (reportlab)
```python
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

# Create base PDF, then convert to AcroForm using pdfrw
```

---

## Troubleshooting

### "Form template not found" Error
- Verify PDF files exist in `importer/forms/`
- Check file names match exactly: `engagement-form-employee.pdf`, `fs4-en.pdf`, `fs4-mt.pdf`

### "No AcroForm found in template"
- The PDF file is not a fillable form
- Ensure fields were added using PDF form editor
- Re-export/recreate the PDF with AcroForm capability

### Field Values Not Populated
- Check field names in PDF match the expected field names listed above
- Use PDF inspection tool to verify field names in template
- Ensure `pdfrw` can read the PDF (try opening in Python REPL)

### Python Script Fails
- Check Python path is correct
- Verify `pdfrw`, `reportlab`, `pillow` are installed
- Run Python script directly to see error messages:
  ```bash
  python importer/src/forms_filler.py --employee-data '{"employee_id":"123", ...}' --form-types engagement,fs4
  ```

---

## File Structure
```
Excel-Db/
├── importer/
│   ├── forms/                          # PDF templates go here
│   │   ├── engagement-form-employee.pdf
│   │   ├── fs4-en.pdf
│   │   └── fs4-mt.pdf
│   └── src/
│       └── forms_filler.py            # Form filling service
├── src/
│   └── endpoints/
│       └── forms-generator.ts         # REST endpoints
└── temp/
    └── forms/                         # Generated PDFs (temporary)
```

---

## Future Enhancements
- [ ] Store generated PDFs with timestamp for audit trail
- [ ] Add digital signature support
- [ ] Support for additional form templates
- [ ] Batch form generation for multiple employees
- [ ] Email delivery of forms
- [ ] Scan & import filled forms back
- [ ] Archive filled forms with employee records
