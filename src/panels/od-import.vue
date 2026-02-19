<template>
  <div class="od-import-panel">
    <div class="panel-header">
      <h2>OpenDental Timesheet Import</h2>
      <p>Import clock events by date range and employee IDs.</p>
    </div>

    <div class="section">
      <label>Service URL</label>
      <input v-model="serviceUrl" type="text" placeholder="http://localhost:4020" />
    </div>

    <div class="section">
      <label>Date From</label>
      <input v-model="dateFrom" type="date" />
    </div>

    <div class="section">
      <label>Date To</label>
      <input v-model="dateTo" type="date" />
    </div>

    <div class="section">
      <label>Employee IDs (comma separated)</label>
      <input v-model="employeeIds" type="text" placeholder="2018001,2018002" />
    </div>

    <div class="section">
      <label>
        <input v-model="dryRun" type="checkbox" />
        Dry run (no inserts)
      </label>
    </div>

    <div class="section">
      <button class="btn" :disabled="isLoading" @click="runImport">
        {{ isLoading ? 'Importing...' : 'Import Timesheets' }}
      </button>
    </div>

    <div v-if="result" class="section result">
      <h3>Result</h3>
      <pre>{{ result }}</pre>
    </div>

    <div v-if="error" class="section error">
      <h3>Error</h3>
      <pre>{{ error }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const serviceUrl = ref('http://localhost:4020');
const dateFrom = ref('');
const dateTo = ref('');
const employeeIds = ref('');
const dryRun = ref(false);
const isLoading = ref(false);
const result = ref('');
const error = ref('');

const parseEmployeeIds = () => {
  const ids = employeeIds.value
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
  return ids.length ? ids : undefined;
};

const runImport = async () => {
  error.value = '';
  result.value = '';

  if (!dateFrom.value || !dateTo.value) {
    error.value = 'Please select date range.';
    return;
  }

  isLoading.value = true;
  try {
    const response = await fetch(`${serviceUrl.value}/api/od/timesheets/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date_from: dateFrom.value,
        date_to: dateTo.value,
        employee_ids: parseEmployeeIds(),
        dry_run: dryRun.value
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Import failed');
    }
    result.value = JSON.stringify(data, null, 2);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error.value = message;
  } finally {
    isLoading.value = false;
  }
};
</script>

<style scoped>
.od-import-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.panel-header h2 {
  margin: 0 0 4px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.btn {
  background: #0e7c86;
  color: #fff;
  border: 0;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.result pre,
.error pre {
  background: #f7f7f7;
  border-radius: 6px;
  padding: 12px;
  white-space: pre-wrap;
}

.error pre {
  border: 1px solid #c62828;
}
</style>
