<template>
  <div class="tax-admin-panel">
    <div class="panel-header">
      <h2>Tax Sync Administration</h2>
      <p>Preview staged tax/social-security rates, then publish to live.</p>
    </div>

    <div class="section">
      <h3>1. Fetch Preview</h3>
      <div class="row">
        <input
          v-model.number="selectedYear"
          type="number"
          :min="2020"
          :max="2035"
          placeholder="Tax year"
        />
        <input
          v-model="sourceUrl"
          type="text"
          placeholder="MTCA source URL (optional, supports {year})"
        />
        <button class="btn btn-primary" :disabled="isLoading || !selectedYear" @click="fetchPreview">
          {{ isLoading ? 'Loading...' : 'Fetch Preview' }}
        </button>
      </div>
      <div class="row html-row">
        <textarea
          v-model="sourceHtml"
          placeholder="Optional fallback: paste MTCA page/table HTML here (used as source_html)."
          rows="7"
        />
      </div>
      <small class="hint">URL fetch is primary; pasted HTML is fallback when fetch fails.</small>
      <small v-if="sourceHtml" class="hint">`source_html` is set and will be preferred over URL fetch.</small>
    </div>

    <div v-if="previewData" class="section">
      <h3>2. Preview Result</h3>
      <p><strong>Batch:</strong> <code>{{ previewData.batchId }}</code></p>
      <p><strong>Source:</strong> {{ previewData.sourceType }} <span v-if="previewData.sourceUrl">({{ previewData.sourceUrl }})</span></p>
      <div class="grid">
        <div class="card">
          <span class="label">Rows Inserted</span>
          <span class="value">{{ previewData.summary.rowsInserted }}</span>
        </div>
        <div class="card">
          <span class="label">Mapped</span>
          <span class="value">{{ previewData.summary.mappedRows }}</span>
        </div>
        <div class="card">
          <span class="label">Unknown</span>
          <span class="value" :class="{ error: previewData.summary.unknownCategoryCount > 0 }">
            {{ previewData.summary.unknownCategoryCount }}
          </span>
        </div>
      </div>

      <div v-if="previewData.unknownCategories?.length" class="warn-box">
        <strong>Unknown categories detected:</strong>
        <ul>
          <li v-for="label in previewData.unknownCategories" :key="label">{{ label }}</li>
        </ul>
        <small>Add mappings in <code>tax_category_map</code> before publishing.</small>
      </div>
    </div>

    <div class="section">
      <h3>3. Publish Batch</h3>
      <div class="row">
        <input v-model="batchIdToPublish" type="text" placeholder="Batch ID" />
        <button class="btn btn-success" :disabled="isPublishing || !batchIdToPublish" @click="publishBatch">
          {{ isPublishing ? 'Publishing...' : 'Publish Batch' }}
        </button>
      </div>
    </div>

    <div v-if="publishResult" class="section">
      <h3>Publish Status: {{ publishResult.data.publishStatus }}</h3>
      <div class="grid">
        <div class="card">
          <span class="label">Total Rows</span>
          <span class="value">{{ publishResult.data.summary.totalRows }}</span>
        </div>
        <div class="card">
          <span class="label">Published</span>
          <span class="value success">{{ publishResult.data.summary.published }}</span>
        </div>
        <div class="card">
          <span class="label">Failed</span>
          <span class="value" :class="{ error: publishResult.data.summary.failed > 0 }">
            {{ publishResult.data.summary.failed }}
          </span>
        </div>
      </div>
    </div>

    <div class="section">
      <h3>4. Social Security Fetch Preview</h3>
      <div class="row">
        <input
          v-model.number="socialSecurityYear"
          type="number"
          :min="2020"
          :max="2035"
          placeholder="Social security year"
        />
        <input
          v-model="socialSecuritySourceUrl"
          type="text"
          placeholder="SS source URL (optional, supports {year})"
        />
        <button class="btn btn-primary" :disabled="isSsLoading || !socialSecurityYear" @click="fetchSocialSecurityPreview">
          {{ isSsLoading ? 'Loading...' : 'Fetch SS Preview' }}
        </button>
      </div>
      <div class="row html-row">
        <textarea
          v-model="socialSecuritySourceHtml"
          placeholder="Optional fallback: paste social security HTML here (source_html)."
          rows="7"
        />
      </div>
    </div>

    <div v-if="socialSecurityPreviewData" class="section">
      <h3>5. Social Security Preview Result</h3>
      <p><strong>Batch:</strong> <code>{{ socialSecurityPreviewData.batchId }}</code></p>
      <p><strong>Source:</strong> {{ socialSecurityPreviewData.sourceType }} <span v-if="socialSecurityPreviewData.sourceUrl">({{ socialSecurityPreviewData.sourceUrl }})</span></p>
      <div class="grid">
        <div class="card">
          <span class="label">Rows Inserted</span>
          <span class="value">{{ socialSecurityPreviewData.summary.rowsInserted }}</span>
        </div>
        <div class="card">
          <span class="label">Mapped</span>
          <span class="value">{{ socialSecurityPreviewData.summary.mappedRows }}</span>
        </div>
        <div class="card">
          <span class="label">Unknown</span>
          <span class="value" :class="{ error: socialSecurityPreviewData.summary.unknownCategoryCount > 0 }">
            {{ socialSecurityPreviewData.summary.unknownCategoryCount }}
          </span>
        </div>
      </div>

      <div v-if="socialSecurityPreviewData.unknownCategories?.length" class="warn-box">
        <strong>Unknown social security categories detected:</strong>
        <ul>
          <li v-for="label in socialSecurityPreviewData.unknownCategories" :key="label">{{ label }}</li>
        </ul>
        <small>Add mappings in <code>social_security_category_map</code> before publishing.</small>
      </div>
    </div>

    <div class="section">
      <h3>6. Publish Social Security Batch</h3>
      <div class="row">
        <input v-model="socialSecurityBatchIdToPublish" type="text" placeholder="Social security batch ID" />
        <button class="btn btn-success" :disabled="isSsPublishing || !socialSecurityBatchIdToPublish" @click="publishSocialSecurityBatch">
          {{ isSsPublishing ? 'Publishing...' : 'Publish SS Batch' }}
        </button>
      </div>
    </div>

    <div v-if="socialSecurityPublishResult" class="section">
      <h3>Social Security Publish Status: {{ socialSecurityPublishResult.data.publishStatus }}</h3>
      <div class="grid">
        <div class="card">
          <span class="label">Total Rows</span>
          <span class="value">{{ socialSecurityPublishResult.data.summary.totalRows }}</span>
        </div>
        <div class="card">
          <span class="label">Published</span>
          <span class="value success">{{ socialSecurityPublishResult.data.summary.published }}</span>
        </div>
        <div class="card">
          <span class="label">Failed</span>
          <span class="value" :class="{ error: socialSecurityPublishResult.data.summary.failed > 0 }">
            {{ socialSecurityPublishResult.data.summary.failed }}
          </span>
        </div>
      </div>
    </div>

    <div class="section">
      <h3>Admin Dashboard — Year & Rates</h3>
      <div class="row">
        <input v-model.number="dashboardYear" type="number" :min="2020" :max="2035" placeholder="Year" />
        <button class="btn" @click="loadDashboard">Load Dashboard</button>
      </div>

      <div v-if="dashboard.taxBrackets?.length" class="section-sub">
        <h4>Tax Brackets ({{ dashboardYear }})</h4>
        <table>
          <thead>
            <tr><th>Category</th><th>From</th><th>To</th><th>Rate</th><th>Subtract</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in dashboard.taxBrackets" :key="r.id">
              <td>{{ r.raw_category_label || r.category_code }}</td>
              <td>{{ r.band_from }}</td>
              <td>{{ r.band_to ?? '∞' }}</td>
              <td>{{ r.rate }}</td>
              <td>{{ r.subtract }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="dashboard.ssBrackets?.length" class="section-sub">
        <h4>Social Security Brackets ({{ dashboardYear }})</h4>
        <table>
          <thead>
            <tr><th>From</th><th>To</th><th>Employee Rate</th><th>Employer Rate</th><th>Notes</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in dashboard.ssBrackets" :key="s.id">
              <td>{{ s.band_from }}</td>
              <td>{{ s.band_to ?? '∞' }}</td>
              <td>{{ s.employee_rate }}</td>
              <td>{{ s.employer_rate }}</td>
              <td>{{ s.notes }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="dashboard.ssClasses?.length" class="section-sub">
        <h4>Social Security Classes ({{ dashboardYear }})</h4>
        <table>
          <thead>
            <tr><th>Class</th><th>Cohort / Age</th><th>Wage From</th><th>Wage To</th><th>Employee</th><th>Employer</th><th>MLF</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in dashboard.ssClasses" :key="c.id">
              <td>{{ c.class_code }}</td>
              <td>
                <span v-if="c.dob_from || c.dob_to">DOB: {{ c.dob_from || '-' }} → {{ c.dob_to || '-' }}</span>
                <span v-else>Age: {{ c.min_age ?? '-' }}–{{ c.max_age ?? '∞' }}</span>
              </td>
              <td>{{ c.wage_from }}</td>
              <td>{{ c.wage_to ?? '∞' }}</td>
              <td>
                <span v-if="c.employee_fixed">€{{ c.employee_fixed }}</span>
                <span v-else-if="c.employee_percentage">{{ c.employee_percentage }}%</span>
                <span v-else>-</span>
              </td>
              <td>
                <span v-if="c.employer_fixed">€{{ c.employer_fixed }}</span>
                <span v-else-if="c.employer_percentage">{{ c.employer_percentage }}%</span>
                <span v-else>-</span>
              </td>
              <td>
                <span v-if="c.mlf_fixed">€{{ c.mlf_fixed }}</span>
                <span v-else-if="c.mlf_percentage">{{ c.mlf_percentage }}% (max €{{ c.mlf_max ?? '-' }})</span>
                <span v-else>-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section-sub">
        <h4>Social Security Calculator</h4>
        <div class="row">
          <input v-model.number="ssTest.weekly_wage" type="number" placeholder="Weekly wage (e.g. 300)" />
          <input v-model="ssTest.dob" type="date" placeholder="Date of birth" />
          <button class="btn" @click="computeSsClass">Compute Class</button>
        </div>

        <div v-if="ssTestError" class="error-message">{{ ssTestError }}</div>
        <div v-if="ssTestResult" class="section-sub">
          <h5>Result</h5>
          <div><strong>Class:</strong> {{ ssTestResult.class.class_code }} — {{ ssTestResult.class.description }}</div>
          <div><strong>Employee:</strong> {{ ssTestResult.computed.employee ?? '-' }}</div>
          <div><strong>Employer:</strong> {{ ssTestResult.computed.employer ?? '-' }}</div>
          <div><strong>MLF (employer):</strong> {{ ssTestResult.computed.employer_mlf ?? '-' }}</div>
          <div v-if="ssTestResult.warnings?.length" class="warn-box">
            <strong>Warnings:</strong>
            <ul>
              <li v-for="w in ssTestResult.warnings" :key="w">{{ w }}</li>
            </ul>
          </div>
        </div>
      </div>

      <div v-if="dashboard.leavePolicies?.length" class="section-sub">
        <h4>Leave Policies ({{ dashboardYear }})</h4>
        <table>
          <thead>
            <tr><th>Dept</th><th>Leave Type</th><th>Entitlement (hours)</th><th>Carry %</th></tr>
          </thead>
          <tbody>
            <tr v-for="l in dashboard.leavePolicies" :key="l.id">
              <td>{{ l.department_abbreviation || l.dept_abbrev || l.abbreviation }}</td>
              <td>{{ l.leave_type_name || l.display_name || l.code }}</td>
              <td>{{ l.entitlement_hours }}</td>
              <td>{{ l.carry_forward_percent ?? '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="dashboard.colaRates?.length" class="section-sub">
        <h4>COLA ({{ dashboardYear }})</h4>
        <table>
          <thead>
            <tr><th>Weekly Amount</th><th>Standard Weekly Hours</th><th>Hourly Amount</th><th>Notes</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in dashboard.colaRates" :key="c.id">
              <td>{{ c.weekly_amount }}</td>
              <td>{{ c.standard_weekly_hours }}</td>
              <td>{{ c.hourly_amount }}</td>
              <td>{{ c.notes || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
    <div v-if="successMessage" class="success-message">{{ successMessage }}</div>
  </div>
</template>

<script lang="ts">
export default {
  name: 'TaxAdminPanel',
  data() {
    return {
      selectedYear: new Date().getFullYear(),
      sourceUrl: '',
      sourceHtml: '',
      batchIdToPublish: '',
      socialSecurityYear: new Date().getFullYear(),
      socialSecuritySourceUrl: '',
      socialSecuritySourceHtml: '',
      socialSecurityBatchIdToPublish: '',
      previewData: null as any,
      publishResult: null as any,
      socialSecurityPreviewData: null as any,
      socialSecurityPublishResult: null as any,
      errorMessage: '',
      successMessage: '',
      isLoading: false,
      isPublishing: false,
      isSsLoading: false,
      isSsPublishing: false
      ,dashboardYear: new Date().getFullYear(),
      dashboard: {
        taxBrackets: [] as any[],
        ssBrackets: [] as any[],
        ssClasses: [] as any[],
        leavePolicies: [] as any[],
        colaRates: [] as any[]
      },
      // interactive SS class tester
      ssTest: {
        weekly_wage: null as number | null,
        dob: '' as string
      },
      ssTestResult: null as any,
      ssTestError: '' as string
    };
  },
  methods: {
    async fetchPreview() {
      this.isLoading = true;
      this.errorMessage = '';
      this.successMessage = '';

      try {
        const response = await fetch(`/tax-sync-preview/tax/sync-preview/${this.selectedYear}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_url: this.sourceUrl || undefined,
            source_html: this.sourceHtml || undefined
          })
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || 'Failed to fetch preview');
        }

        this.previewData = result.data;
        this.batchIdToPublish = result.data.batchId;
        this.successMessage = 'Preview staged successfully.';
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      } finally {
        this.isLoading = false;
      }
    },

    async publishBatch() {
      this.isPublishing = true;
      this.errorMessage = '';
      this.successMessage = '';

      try {
        const response = await fetch(`/tax-publish/tax/publish/${this.batchIdToPublish}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();

        if (!response.ok) {
          const unknown = result?.data?.unknownCategories;
          if (Array.isArray(unknown) && unknown.length > 0) {
            throw new Error(`Publish blocked. Unknown categories: ${unknown.join(', ')}`);
          }
          throw new Error(result.message || 'Failed to publish batch');
        }

        this.publishResult = result;
        this.successMessage = 'Batch published to tax_rates_live.';
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      } finally {
        this.isPublishing = false;
      }
    },

    async fetchSocialSecurityPreview() {
      this.isSsLoading = true;
      this.errorMessage = '';
      this.successMessage = '';

      try {
        const response = await fetch(`/social-security-sync-preview/ss/sync-preview/${this.socialSecurityYear}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_url: this.socialSecuritySourceUrl || undefined,
            source_html: this.socialSecuritySourceHtml || undefined
          })
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.message || 'Failed to fetch social security preview');
        }

        this.socialSecurityPreviewData = result.data;
        this.socialSecurityBatchIdToPublish = result.data.batchId;
        this.successMessage = 'Social security preview staged successfully.';
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      } finally {
        this.isSsLoading = false;
      }
    },

    async publishSocialSecurityBatch() {
      this.isSsPublishing = true;
      this.errorMessage = '';
      this.successMessage = '';

      try {
        const response = await fetch(`/social-security-publish/ss/publish/${this.socialSecurityBatchIdToPublish}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();

        if (!response.ok) {
          const unknown = result?.data?.unknownCategories;
          if (Array.isArray(unknown) && unknown.length > 0) {
            throw new Error(`SS publish blocked. Unknown categories: ${unknown.join(', ')}`);
          }
          throw new Error(result.message || 'Failed to publish social security batch');
        }

        this.socialSecurityPublishResult = result;
        this.successMessage = 'Social security batch published to social_security_rates_live.';
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      } finally {
        this.isSsPublishing = false;
      }
    },

    async loadDashboard() {
      this.errorMessage = '';
      this.successMessage = '';
      this.dashboard.taxBrackets = [];
      this.dashboard.ssBrackets = [];
      this.dashboard.ssClasses = [];
      this.dashboard.leavePolicies = [];
      this.dashboard.colaRates = [];

      try {
        const [taxRes, ssRes, leaveRes, ssClassesRes, colaRes] = await Promise.all([
          fetch(`/admin-dashboard/tax-rates-live?year=${this.dashboardYear}`),
          fetch(`/admin-dashboard/ss-brackets?year=${this.dashboardYear}`),
          fetch(`/admin-dashboard/leave-policies?year=${this.dashboardYear}`),
          fetch(`/admin-dashboard/ss-classes?year=${this.dashboardYear}`),
          fetch(`/admin-dashboard/cola-rates?year=${this.dashboardYear}`)
        ]);

        if (taxRes.ok) {
          const t = await taxRes.json();
          this.dashboard.taxBrackets = t.data || t;
        }

        if (ssRes.ok) {
          const s = await ssRes.json();
          this.dashboard.ssBrackets = s.data || s;
        }

        if (leaveRes.ok) {
          const l = await leaveRes.json();
          this.dashboard.leavePolicies = l.data || l;
        }
        if (ssClassesRes.ok) {
          const scls = await ssClassesRes.json();
          this.dashboard.ssClasses = scls.data || scls;
        }
        if (colaRes.ok) {
          const c = await colaRes.json();
          this.dashboard.colaRates = c.data || c;
        }

        this.successMessage = 'Dashboard loaded.';
      } catch (err) {
        this.errorMessage = err instanceof Error ? err.message : 'Failed loading dashboard';
      }
    },

    async computeSsClass() {
      this.ssTestError = '';
      this.ssTestResult = null;
      try {
        const response = await fetch('/admin-dashboard/ss-class-for', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weekly_wage: this.ssTest.weekly_wage, dob: this.ssTest.dob, year: this.dashboardYear })
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.message || body?.status || 'Request failed');
        this.ssTestResult = body.data;
        if (body.warnings) this.ssTestResult.warnings = body.warnings;
      } catch (err) {
        this.ssTestError = err instanceof Error ? err.message : String(err);
      }
    }
  }
};
</script>

<style scoped>
.tax-admin-panel {
  display: grid;
  gap: 14px;
}

.panel-header h2 {
  margin: 0;
}

.panel-header p {
  margin: 4px 0 0;
  opacity: 0.85;
}

.section {
  background: var(--theme--background-subdued);
  border: 1px solid var(--theme--border-color-subdued);
  border-radius: 8px;
  padding: 12px;
}

.section h3 {
  margin: 0 0 10px;
}

.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

input {
  min-width: 200px;
  padding: 8px;
  border: 1px solid var(--theme--border-color);
  border-radius: 6px;
  background: var(--theme--background);
  color: var(--theme--foreground);
}

textarea {
  width: 100%;
  min-height: 140px;
  padding: 8px;
  border: 1px solid var(--theme--border-color);
  border-radius: 6px;
  background: var(--theme--background);
  color: var(--theme--foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  resize: vertical;
}

.html-row {
  margin-top: 8px;
}

.hint {
  display: inline-block;
  margin-top: 6px;
  opacity: 0.85;
}

.btn {
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: #2f6fed;
  color: #fff;
}

.btn-success {
  background: #21864a;
  color: #fff;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.card {
  border: 1px solid var(--theme--border-color-subdued);
  border-radius: 6px;
  padding: 8px;
  display: grid;
}

.label {
  font-size: 12px;
  opacity: 0.8;
}

.value {
  font-size: 16px;
  font-weight: 700;
}

.success {
  color: #21864a;
}

.error {
  color: #b42318;
}

.warn-box {
  margin-top: 10px;
  background: #fff6e0;
  border: 1px solid #f2cf77;
  border-radius: 6px;
  padding: 8px;
  color: #594003;
}

.warn-box ul {
  margin: 6px 0;
  padding-left: 20px;
}

.error-message,
.success-message {
  border-radius: 6px;
  padding: 10px;
  font-weight: 600;
}

.error-message {
  background: #ffe8e6;
  color: #b42318;
}

.success-message {
  background: #e8f7ec;
  color: #17693a;
}
</style>
