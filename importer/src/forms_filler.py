"""
Forms Filler Module
Handles filling and generating PDF forms (FS4, Engagement Form) with employee data.
Supports both AcroForm PDFs and creating new PDFs with filled data.
"""

import os
import sys
import json
import base64
from io import BytesIO
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from datetime import datetime
from pdfrw import PdfReader, PdfWriter, PdfObject, PdfName, PdfDict, PageMerge
from reportlab.pdfgen import canvas
import logging

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
handler = logging.StreamHandler()
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
logger.addHandler(handler)


class FormsFiller:
    """
    Fills PDF forms with employee data.
    Supports AcroForm PDFs (fillable forms).
    """
    
    # Form field mappings for different document types
    ENGAGEMENT_FORM_FIELDS = {
        'employee_full_name': 'EmployeeName',
        'employee_id': 'EmployeeID',
        'dob': 'DOB',
        'identity_card': 'IDCard',
        'address': 'Address',
        'position': 'Position',
        'department': 'Department',
        'employment_type': 'EmploymentType',
        'hourly_rate': 'HourlyRate',
        'weekly_hours': 'WeeklyHours',
        'contract_start_date': 'ContractStartDate',
        'contract_end_date': 'ContractEndDate',
        'employment_date': 'EmploymentDate',
        'signature_date': 'SignatureDate'
    }
    
    FS4_FORM_FIELDS_EN = {
        'employee_full_name': 'Name',
        'employee_id': 'EmployeeID',
        'dob': 'DateOfBirth',
        'identity_card': 'IdentityCard',
        'address': 'Address',
        'position': 'Position',
        'ss_class': 'SSClass',
        'tax_category': 'TaxCategory',
        'employment_date': 'EmploymentDate',
        'employment_end_date': 'EmploymentEndDate',
        'signature_date': 'SignatureDate'
    }
    
    FS4_FORM_FIELDS_MT = {
        'employee_full_name': 'Isem',
        'employee_id': 'NumID',
        'dob': 'DataWilada',
        'identity_card': 'CartaIdentita',
        'address': 'Indirizz',
        'position': 'Pożizzjoni',
        'ss_class': 'KlassSS',
        'tax_category': 'KategorjaTax',
        'employment_date': 'DataEmpilment',
        'employment_end_date': 'DataTemminazzjoni',
        'signature_date': 'DataFirma'
    }
    
    def __init__(self, forms_directory: str = None):
        """Initialize forms filler with path to template forms directory."""
        if forms_directory is None:
            forms_directory = os.path.join(
                Path(__file__).parent.parent,
                'forms'
            )
        self.forms_directory = forms_directory
        logger.info(f"Forms directory: {self.forms_directory}")
    
    def get_template_path(self, form_name: str, language: str = 'en') -> str:
        """Get path to form template by name and language."""
        if form_name == 'engagement':
            filename = 'engagement-form-employee.pdf'
        elif form_name == 'fs4':
            filename = '2026-eng-fs4.pdf' if language == 'en' else '2026-maltese-fs4.pdf'
        else:
            raise ValueError(f"Unknown form: {form_name}")
        
        path = os.path.join(self.forms_directory, filename)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Form template not found: {path}")
        return path
    
    def fill_engagement_form(self, employee_data: Dict[str, Any], 
                           output_path: str) -> bool:
        """
        Fill engagement form with employee data.
        
        Args:
            employee_data: Dictionary with employee information
            output_path: Path where filled PDF will be saved
            
        Returns:
            True if successful, False otherwise
        """
        try:
            template_path = self.get_template_path('engagement')
            logger.info(f"Loading engagement form template from {template_path}")
            
            # Read template
            template = PdfReader(template_path)
            
            # Fill form fields (AcroForm or coordinate overlay)
            data = self._prepare_field_data(employee_data, self.ENGAGEMENT_FORM_FIELDS)
            if template.Root.AcroForm is not None:
                self._fill_acroform(template, data)
            else:
                layout_path = self._get_layout_path('engagement')
                self._fill_with_layout(template, employee_data, layout_path)
            
            # Write filled PDF
            PdfWriter().write(output_path, template)
            logger.info(f"Engagement form filled and saved to {output_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error filling engagement form: {str(e)}", exc_info=True)
            return False
    
    def fill_fs4_form(self, employee_data: Dict[str, Any], 
                     language: str = 'en', 
                     output_path: str = None) -> bool:
        """
        Fill FS4 form with employee data.
        
        Args:
            employee_data: Dictionary with employee information
            language: 'en' for English or 'mt' for Maltese
            output_path: Path where filled PDF will be saved
            
        Returns:
            True if successful, False otherwise
        """
        try:
            language = language.lower() if language else 'en'
            if language not in ['en', 'mt']:
                raise ValueError("Language must be 'en' (English) or 'mt' (Maltese)")
            
            template_path = self.get_template_path('fs4', language)
            logger.info(f"Loading FS4 form template ({language}) from {template_path}")
            
            # Read template
            template = PdfReader(template_path)
            
            # Get appropriate field mappings
            field_mappings = self.FS4_FORM_FIELDS_MT if language == 'mt' else self.FS4_FORM_FIELDS_EN
            
            # Fill form fields (AcroForm or coordinate overlay)
            data = self._prepare_field_data(employee_data, field_mappings)
            if template.Root.AcroForm is not None:
                self._fill_acroform(template, data)
            else:
                layout_path = self._get_layout_path('fs4', language)
                self._fill_with_layout(template, employee_data, layout_path)
            
            # Write filled PDF
            PdfWriter().write(output_path, template)
            logger.info(f"FS4 form ({language}) filled and saved to {output_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error filling FS4 form: {str(e)}", exc_info=True)
            return False
    
    def _prepare_field_data(self, employee_data: Dict[str, Any], 
                           field_mappings: Dict[str, str]) -> Dict[str, str]:
        """
        Prepare field data by mapping employee data to form field names.
        
        Args:
            employee_data: Raw employee data dictionary
            field_mappings: Mapping of data keys to form field names
            
        Returns:
            Dictionary of form_field_name -> value
        """
        data = {}
        for data_key, form_field in field_mappings.items():
            if data_key in employee_data:
                value = employee_data[data_key]
                # Convert dates to readable format
                if isinstance(value, str) and data_key in ['dob', 'employment_date', 'employment_end_date', 'signature_date', 'contract_start_date', 'contract_end_date']:
                    try:
                        dt = datetime.fromisoformat(value)
                        value = dt.strftime('%d %b %Y')
                    except (ValueError, AttributeError):
                        pass  # Keep original format if parsing fails
                
                data[form_field] = str(value)
        
        return data
    
    def _fill_acroform(self, template: Any, field_data: Dict[str, str]) -> None:
        """
        Fill AcroForm fields in PDF template.
        
        Args:
            template: PdfReader object with template
            field_data: Dictionary of field_name -> value to fill
        """
        if template.Root.AcroForm is None:
            logger.warning("No AcroForm found in template")
            return
        
        fields = {f.T[1:-1]: f for f in template.Root.AcroForm.Fields}  # Remove quotes from T field
        
        for field_name, value in field_data.items():
            if field_name in fields:
                field = fields[field_name]
                field.V = f'({value})'
                # Also set AS (appearance state) for checkboxes/radio buttons
                if hasattr(field, 'AS'):
                    field.AS = PdfName('Yes') if value.lower() == 'yes' else PdfName('Off')
                logger.debug(f"Filled field '{field_name}' with '{value}'")
            else:
                logger.warning(f"Field '{field_name}' not found in template")

    def _get_layout_path(self, form_name: str, language: str = 'en') -> str:
        """Resolve the layout JSON path for a given form."""
        if form_name == 'engagement':
            layout_filename = 'engagement-form-employee.json'
        elif form_name == 'fs4':
            layout_filename = '2026-eng-fs4.json' if language == 'en' else '2026-maltese-fs4.json'
        else:
            raise ValueError(f"Unknown form: {form_name}")

        layout_path = os.path.join(self.forms_directory, 'layouts', layout_filename)
        if not os.path.exists(layout_path):
            raise FileNotFoundError(f"Layout file not found: {layout_path}")
        return layout_path

    def _fill_with_layout(self, template: Any, employee_data: Dict[str, Any], layout_path: str) -> None:
        """Overlay text on a non-AcroForm PDF using a layout JSON file."""
        with open(layout_path, 'r', encoding='utf-8') as f:
            layout = json.load(f)

        fields = layout.get('fields', [])
        origin = layout.get('origin', 'bottom-left')
        if not fields:
            logger.warning(f"Layout has no fields: {layout_path}")
            return

        normalized_data = self._normalize_employee_data(employee_data)

        fields_by_page: Dict[int, list] = {}
        for field in fields:
            page = int(field.get('page', 1))
            fields_by_page.setdefault(page, []).append(field)

        for idx, page in enumerate(template.pages, start=1):
            if idx not in fields_by_page:
                continue

            media_box = page.MediaBox
            page_width = float(media_box[2])
            page_height = float(media_box[3])

            overlay_page = self._build_overlay_page(
                page_width,
                page_height,
                fields_by_page[idx],
                normalized_data,
                origin=origin
            )
            if overlay_page is not None:
                PageMerge(page).add(overlay_page).render()

    def _build_overlay_page(self, page_width: float, page_height: float, fields: list,
                            employee_data: Dict[str, Any], origin: str = 'bottom-left') -> Optional[Any]:
        """Create a single overlay PDF page with drawn field values."""
        packet = BytesIO()
        c = canvas.Canvas(packet, pagesize=(page_width, page_height))

        for field in fields:
            name = field.get('name')
            x = field.get('x')
            y = field.get('y')
            font_size = field.get('font_size', 10)
            align = field.get('align', 'left')
            field_type = field.get('type', 'text')

            if name is None or x is None or y is None:
                continue

            if origin == 'top-left':
                y = page_height - y

            value = employee_data.get(name, '')
            if isinstance(value, (int, float)):
                value = str(value)
            if value is None:
                value = ''

            c.setFont('Helvetica', font_size)

            if field_type == 'checkbox':
                mark = 'X' if str(value).strip().lower() in ['1', 'true', 'yes', 'y'] else ''
                c.drawString(x, y, mark)
                continue

            if align == 'center':
                c.drawCentredString(x, y, str(value))
            elif align == 'right':
                c.drawRightString(x, y, str(value))
            else:
                c.drawString(x, y, str(value))

        c.save()
        packet.seek(0)
        overlay_pdf = PdfReader(packet)
        return overlay_pdf.pages[0] if overlay_pdf.pages else None

    def generate_grid_overlay(self, template_path: str, output_path: str, step: int = 20,
                              label_step: int = 100, font_size: int = 6) -> None:
        """Generate a grid overlay PDF on top of a template for coordinate mapping."""
        template = PdfReader(template_path)
        for idx, page in enumerate(template.pages, start=1):
            media_box = page.MediaBox
            page_width = float(media_box[2])
            page_height = float(media_box[3])

            overlay_page = self._build_grid_overlay_page(
                page_width,
                page_height,
                step=step,
                label_step=label_step,
                font_size=font_size,
                page_number=idx
            )

            if overlay_page is not None:
                PageMerge(page).add(overlay_page).render()

        PdfWriter().write(output_path, template)

    def _build_grid_overlay_page(self, page_width: float, page_height: float, step: int,
                                 label_step: int, font_size: int, page_number: int) -> Optional[Any]:
        """Create a grid overlay page with coordinate labels."""
        packet = BytesIO()
        c = canvas.Canvas(packet, pagesize=(page_width, page_height))

        c.setStrokeColorRGB(0.75, 0.75, 0.75)
        c.setLineWidth(0.25)

        x = 0
        while x <= page_width:
            c.line(x, 0, x, page_height)
            x += step

        y = 0
        while y <= page_height:
            c.line(0, y, page_width, y)
            y += step

        c.setFont('Helvetica', font_size)
        c.setFillColorRGB(0.2, 0.2, 0.2)

        x = 0
        while x <= page_width:
            if x % label_step == 0:
                c.drawString(x + 2, page_height - 10, str(int(x)))
                c.drawString(x + 2, 2, str(int(x)))
            x += step

        y = 0
        while y <= page_height:
            if y % label_step == 0:
                c.drawString(2, y + 2, str(int(y)))
                c.drawString(page_width - 30, y + 2, str(int(y)))
            y += step

        c.setFont('Helvetica', font_size)
        c.setFillColorRGB(0.2, 0.2, 0.2)
        c.drawString(10, page_height - 20, f"Page {page_number}")

        c.save()
        packet.seek(0)
        overlay_pdf = PdfReader(packet)
        return overlay_pdf.pages[0] if overlay_pdf.pages else None

    def _normalize_employee_data(self, employee_data: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize dates and string values for overlay output."""
        normalized = dict(employee_data)
        date_keys = {
            'dob',
            'employment_date',
            'employment_end_date',
            'signature_date',
            'contract_start_date',
            'contract_end_date',
            'commencement_date',
            'form_submitted_date'
        }

        for key in date_keys:
            value = normalized.get(key)
            if isinstance(value, str):
                try:
                    dt = datetime.fromisoformat(value)
                    normalized[key] = dt.strftime('%d %b %Y')
                except ValueError:
                    pass

        return normalized
    
    def generate_forms_package(self, employee_data: Dict[str, Any],
                              language: str = 'en',
                              output_dir: str = None) -> Tuple[Optional[str], Optional[str]]:
        """
        Generate both engagement form and FS4 form for an employee.
        
        Args:
            employee_data: Employee information dictionary
            language: Language preference for FS4 (en/mt)
            output_dir: Directory to save output files
            
        Returns:
            Tuple of (engagement_form_path, fs4_form_path) or (None, None) if error
        """
        if output_dir is None:
            output_dir = os.path.join(
                Path(__file__).parent.parent.parent,
                'temp', 'forms'
            )
        
        os.makedirs(output_dir, exist_ok=True)
        
        emp_id = employee_data.get('employee_id', 'unknown')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        engagement_path = os.path.join(output_dir, f'engagement_{emp_id}_{timestamp}.pdf')
        fs4_path = os.path.join(output_dir, f'fs4_{language}_{emp_id}_{timestamp}.pdf')
        
        engagement_ok = self.fill_engagement_form(employee_data, engagement_path)
        fs4_ok = self.fill_fs4_form(employee_data, language, fs4_path)
        
        if engagement_ok and fs4_ok:
            logger.info(f"Generated forms package for employee {emp_id}")
            return (engagement_path, fs4_path)
        else:
            logger.error(f"Failed to generate one or more forms for employee {emp_id}")
            return (None, None)


# Convenience functions
def fill_engagement_form(employee_data: Dict[str, Any], output_path: str) -> bool:
    """Fill engagement form with employee data."""
    filler = FormsFiller()
    return filler.fill_engagement_form(employee_data, output_path)


def fill_fs4_form(employee_data: Dict[str, Any], language: str = 'en', 
                 output_path: str = None) -> bool:
    """Fill FS4 form with employee data."""
    filler = FormsFiller()
    return filler.fill_fs4_form(employee_data, language, output_path)


def generate_forms_package(employee_data: Dict[str, Any], language: str = 'en',
                          output_dir: str = None) -> Tuple[Optional[str], Optional[str]]:
    """Generate both engagement and FS4 forms for an employee."""
    filler = FormsFiller()
    return filler.generate_forms_package(employee_data, language, output_dir)


if __name__ == '__main__':
    import argparse
    import json

    parser = argparse.ArgumentParser(description='Fill PDF forms with employee data')
    parser.add_argument('--employee-data', type=str, required=False, help='Employee data as JSON string')
    parser.add_argument('--form-types', type=str, default='engagement,fs4', help='Comma-separated form types to generate')
    parser.add_argument('--language', type=str, default='en', choices=['en', 'mt'], help='Language for FS4 form')
    parser.add_argument('--output-dir', type=str, default=None, help='Output directory for generated PDFs')
    parser.add_argument('--grid-template', type=str, default=None, help='Template PDF to overlay a coordinate grid')
    parser.add_argument('--grid-output', type=str, default=None, help='Output path for grid overlay PDF')
    parser.add_argument('--grid-step', type=int, default=20, help='Grid spacing in points')
    parser.add_argument('--grid-label-step', type=int, default=100, help='Grid label spacing in points')
    
    args = parser.parse_args()
    
    try:
        filler = FormsFiller(forms_directory=os.path.join(Path(__file__).parent.parent, 'forms'))

        if args.grid_template:
            template_path = args.grid_template
            if not os.path.isabs(template_path):
                template_path = os.path.join(filler.forms_directory, template_path)

            if not args.grid_output:
                raise ValueError('grid_output is required when grid_template is set')

            output_path = args.grid_output
            if not os.path.isabs(output_path):
                output_path = os.path.join(Path(__file__).parent.parent.parent, output_path)

            filler.generate_grid_overlay(
                template_path,
                output_path,
                step=args.grid_step,
                label_step=args.grid_label_step,
                font_size=6
            )

            print(json.dumps({
                'ok': True,
                'grid_output': output_path
            }))
            sys.exit(0)

        if not args.employee_data:
            raise ValueError('employee-data is required unless grid-template is provided')

        # Parse employee data
        employee_data = json.loads(args.employee_data)
        form_types = [ft.strip() for ft in args.form_types.split(',') if ft.strip()]

        # Generate requested forms
        output_dir = args.output_dir
        if output_dir is None:
            output_dir = os.path.join(Path(__file__).parent.parent.parent, 'temp', 'forms')

        os.makedirs(output_dir, exist_ok=True)

        emp_id = employee_data.get('employee_id', 'unknown')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

        result = {
            'ok': True,
            'forms': {}
        }

        # Generate engagement form if requested
        if 'engagement' in form_types:
            engagement_path = os.path.join(output_dir, f'engagement_{emp_id}_{timestamp}.pdf')
            if filler.fill_engagement_form(employee_data, engagement_path):
                with open(engagement_path, 'rb') as f:
                    result['forms']['engagement'] = base64.b64encode(f.read()).decode('utf-8')
            else:
                result['ok'] = False
                result['error'] = 'Failed to generate engagement form'

        # Generate FS4 form if requested
        if 'fs4' in form_types and result['ok']:
            fs4_path = os.path.join(output_dir, f'fs4_{args.language}_{emp_id}_{timestamp}.pdf')
            if filler.fill_fs4_form(employee_data, args.language, fs4_path):
                with open(fs4_path, 'rb') as f:
                    result['forms']['fs4'] = base64.b64encode(f.read()).decode('utf-8')
            else:
                result['ok'] = False
                result['error'] = 'Failed to generate FS4 form'

        # Output JSON result
        print(json.dumps(result))

    except Exception as e:
        error_result = {
            'ok': False,
            'forms': {},
            'error': str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)
