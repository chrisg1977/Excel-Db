# HR Employee Dashboard

A web-based HR employee dashboard for a dental practice, built with Node.js/Express and connected to a PostgreSQL database.

## Overview

The dashboard provides a read-friendly view of employee data sourced from the `vw_hr_employee_dashboard` database view. It supports:

- Tabbed navigation (Current / Dentists / FT employees)
- Filters by employment type (FT/PT), nationality, and status
- Colour-coded rows by role (dentists, managers, assistants, receptionists)
- Employee detail view with leave balances and action buttons
- PREV / NEXT navigation between employees
- Print audit logging via `log_print_activity()` stored function
- HTTP Basic Authentication

## Prerequisites

- **Node.js** ≥ 18
- **PostgreSQL** ≥ 13 with the HR schema already set up (see [Database Setup](#database-setup))

## Database Setup

Run the HR dashboard SQL setup script before starting the app:

```bash
psql -U app_directus -d your_database -f ../sql/hr_dashboard_system.sql
```

This creates the required views and stored function:

| Object | Type | Purpose |
|---|---|---|
| `vw_hr_employee_dashboard` | View | Main employee list with colour codes |
| `vw_dashboard_filter_options` | View | Dropdown/filter option values |
| `log_print_activity()` | Function | Audit trail for print events |

## Setup

1. **Clone the repository and navigate to the dashboard directory:**

   ```bash
   git clone https://github.com/chrisg1977/Excel-Db.git
   cd Excel-Db/dashboard
   ```

   > **Windows PowerShell users:** use the same commands above — Git Bash, PowerShell,
   > and Windows Terminal all support `git clone` and `cd` with forward slashes.
   > Make sure you run every subsequent command from inside `Excel-Db\dashboard`.

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Create your environment file:**

   ```bash
   # Linux / macOS / Git Bash
   cp .env.example .env

   # Windows PowerShell
   Copy-Item .env.example .env
   ```

   Then open `.env` in a text editor and fill in your actual values (see
   [Environment Variables](#environment-variables) below).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | *(required)* | Database name |
| `DB_USER` | `app_directus` | Database user |
| `DB_PASSWORD` | *(required)* | Database password |
| `DASHBOARD_USER` | *(required)* | HTTP Basic Auth username |
| `DASHBOARD_PASSWORD` | *(required)* | HTTP Basic Auth password |
| `PORT` | `3000` | HTTP port the server listens on |

## How to Run

```bash
# Production
npm start

# Development (same — add nodemon manually if desired)
npm run dev
```

The dashboard will be available at: **http://localhost:3000**

Your browser will prompt for the HTTP Basic Auth credentials (`DASHBOARD_USER` / `DASHBOARD_PASSWORD`).

## API Endpoints

### `GET /api/employees`

Returns a paginated list of employees from `vw_hr_employee_dashboard`.

| Query param | Example | Description |
|---|---|---|
| `tab` | `current`, `dentists`, `ft` | Preset tab filter |
| `status` | `CURRENT`, `TERMINATED` | Employment status |
| `type` | `FT`, `PT` | Employment type |
| `nat_cat` | `MALTESE`, `EU`, `OTHER` | Nationality group |
| `page` | `1` | Page number (default 1) |
| `limit` | `20` | Records per page (max 200) |

**Response:**

```json
{
  "data": [ { "id": 2018001, "surname": "Smith", ... } ],
  "pagination": { "page": 1, "limit": 20, "total": 42, "pages": 3 }
}
```

---

### `GET /api/employees/:id`

Returns full details for a single employee by joining:
- `employees`
- `employee_current`
- `employee_pay_private`

**Response:** single employee object.

---

### `GET /api/filter-options`

Returns available filter values from `vw_dashboard_filter_options`.

---

### `POST /api/print-audit`

Logs a print event by calling `log_print_activity()`.

**Request body (JSON):**

```json
{
  "employee_id": 2018001,
  "print_type": "EMPLOYEE_DETAIL",
  "printed_by": "admin",
  "notes": null
}
```

Allowed `print_type` values: `EMPLOYEE_LIST`, `EMPLOYEE_DETAIL`, `PAYROLL`, `CONTRACT`.

## Integration with Directus

If the Directus admin panel is running on the same host, ensure it uses a **different port** (typically `8055`) so there is no conflict:

| Service | Default Port |
|---|---|
| HR Dashboard | `3000` |
| Directus | `8055` |

Both connect to the same PostgreSQL database using the `app_directus` role.

## File Structure

```
dashboard/
├── public/
│   ├── css/
│   │   ├── dashboard.css        # Main dashboard styles
│   │   └── employee-form.css    # Employee detail form styles
│   └── js/
│       ├── dashboard.js         # Dashboard logic
│       └── employee-form.js     # Employee detail logic
├── views/
│   ├── dashboard.html           # Main dashboard page
│   └── employee-detail.html     # Employee detail / edit page
├── server.js                    # Express server
├── package.json
├── .env.example
└── README.md
```
