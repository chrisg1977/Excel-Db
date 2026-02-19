<template>
  <div class="payroll-subscriptions-panel">
    <div class="panel-header">
      <h2>Payroll Subscriptions</h2>
      <p>Manage employee payroll types and employment numbers.</p>
    </div>

    <!-- New Subscription Form -->
    <div class="section">
      <h3>Add/Update Subscription</h3>

      <div class="form-group">
        <label>Employee</label>
        <input v-model="newSub.employee_id" type="number" placeholder="Employee ID (e.g., 2018001)" />
      </div>

      <div class="form-group">
        <label>Payroll Type</label>
        <select v-model="newSub.payroll_type">
          <option disabled value="">Choose payroll type...</option>
          <option value="MAIN">Main Payroll</option>
          <option value="PROVIDER">Provider Payroll</option>
          <option value="THIRDPARTY">Third-Party Payroll</option>
        </select>
      </div>

      <div class="form-group">
        <label>Employment Number</label>
        <input v-model="newSub.employment_number" type="text" placeholder="e.g., 2018001, LC, RG" />
      </div>

      <div class="form-group">
        <label>Active From</label>
        <input v-model="newSub.active_from" type="date" />
      </div>

      <div class="form-group">
        <label>Active To (leave empty for ongoing)</label>
        <input v-model="newSub.active_to" type="date" />
      </div>

      <div class="form-group checkbox">
        <input v-model="newSub.is_sync_to_opendental" type="checkbox" id="sync_od" />
        <label for="sync_od">Sync to OpenDental</label>
      </div>

      <button class="btn btn-primary" :disabled="isSaving" @click="addSubscription">
        {{ isSaving ? 'Saving...' : 'Add Subscription' }}
      </button>
    </div>

    <!-- Active Subscriptions List -->
    <div v-if="activeSubscriptions" class="section">
      <h3>Active Subscriptions ({{ activeCount }})</h3>
      <table v-if="activeSubscriptions.length" class="table">
        <thead>
          <tr>
            <th>Employee ID</th>
            <th>Payroll Type</th>
            <th>Employment #</th>
            <th>Active From</th>
            <th>Sync Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="sub in activeSubscriptions" :key="sub.id">
            <td>{{ sub.employee_id }}</td>
            <td><span class="badge">{{ sub.payroll_type }}</span></td>
            <td>{{ sub.employment_number }}</td>
            <td>{{ sub.active_from }}</td>
            <td>
              <span v-if="sub.is_sync_to_opendental" class="status" :class="sub.od_sync_status?.toLowerCase()">
                {{ sub.od_sync_status }}
              </span>
              <span v-else class="status skipped">NO SYNC</span>
            </td>
            <td>
              <button v-if="sub.od_sync_status === 'PENDING'" class="btn-small" @click="syncSubscription(sub.id)">
                Sync OD
              </button>
              <button class="btn-small deactivate" @click="deactivateSubscription(sub.id)">Deactivate</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">No active subscriptions.</p>
    </div>

    <!-- Inactive/History -->
    <div v-if="inactiveSubscriptions?.length" class="section">
      <h3>Inactive Subscriptions History ({{ inactiveCount }})</h3>
      <details>
        <summary>Show history...</summary>
        <table class="table">
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Payroll Type</th>
              <th>Employment #</th>
              <th>Period</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sub in inactiveSubscriptions" :key="sub.id">
              <td>{{ sub.employee_id }}</td>
              <td>{{ sub.payroll_type }}</td>
              <td>{{ sub.employment_number }}</td>
              <td>{{ sub.active_from }} → {{ sub.active_to || 'ongoing' }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>

    <!-- Status Messages -->
    <div v-if="message" class="message success">{{ message }}</div>
    <div v-if="error" class="message error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

type Subscription = {
  id?: number;
  employee_id: number | null;
  payroll_type: string;
  employment_number: string;
  active_from: string;
  active_to: string | null;
  is_sync_to_opendental: boolean;
  od_sync_status?: string;
};

const newSub = ref<Subscription>({
  employee_id: null,
  payroll_type: '',
  employment_number: '',
  active_from: new Date().toISOString().split('T')[0],
  active_to: null,
  is_sync_to_opendental: true
});

const activeSubscriptions = ref<Subscription[]>([]);
const inactiveSubscriptions = ref<Subscription[]>([]);
const activeCount = ref(0);
const inactiveCount = ref(0);
const isSaving = ref(false);
const message = ref('');
const error = ref('');

const loadSubscriptions = async () => {
  try {
    const response = await fetch(`/api/v1/vw_payroll_subscriptions_active`);
    if (!response.ok) throw new Error('Failed to load subscriptions');
    const data = await response.json();
    activeSubscriptions.value = data.data || [];
    activeCount.value = activeSubscriptions.value.length;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load subscriptions';
  }
};

const addSubscription = async () => {
  if (!newSub.value.employee_id || !newSub.value.payroll_type || !newSub.value.employment_number) {
    error.value = 'Please fill in all required fields.';
    return;
  }

  isSaving.value = true;
  try {
    const response = await fetch(`/api/v1/payroll/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: newSub.value.employee_id,
        payroll_type: newSub.value.payroll_type,
        employment_number: newSub.value.employment_number,
        active_from: newSub.value.active_from,
        active_to: newSub.value.active_to,
        is_sync_to_opendental: newSub.value.is_sync_to_opendental
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to create subscription');
    }

    message.value = 'Subscription created successfully!';
    newSub.value = {
      employee_id: null,
      payroll_type: '',
      employment_number: '',
      active_from: new Date().toISOString().split('T')[0],
      active_to: null,
      is_sync_to_opendental: true
    };

    await loadSubscriptions();
    setTimeout(() => (message.value = ''), 3000);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create subscription';
  } finally {
    isSaving.value = false;
  }
};

const deactivateSubscription = async (id: number) => {
  if (!confirm('Deactivate this subscription?')) return;

  try {
    const response = await fetch(`/api/v1/payroll/subscriptions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        active_to: new Date().toISOString().split('T')[0]
      })
    });

    if (!response.ok) throw new Error('Failed to deactivate');
    message.value = 'Subscription deactivated.';
    await loadSubscriptions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to deactivate';
  }
};

const syncSubscription = async (id: number) => {
  try {
    const response = await fetch(`/api/v1/payroll/subscriptions/${id}/sync-opendental`, {
      method: 'POST'
    });

    if (!response.ok) throw new Error('Failed to sync');
    message.value = 'Subscription synced to OpenDental.';
    await loadSubscriptions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to sync';
  }
};

onMounted(loadSubscriptions);
</script>

<style scoped>
.payroll-subscriptions-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
}

.section {
  border: 1px solid #e0e0e0;
  padding: 16px;
  border-radius: 6px;
}

.form-group {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
}

.form-group label {
  font-weight: 600;
  margin-bottom: 4px;
  font-size: 14px;
}

.form-group input,
.form-group select {
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

.form-group.checkbox {
  flex-direction: row;
  align-items: center;
}

.form-group.checkbox input {
  width: auto;
  margin-right: 8px;
}

.btn {
  background: #0e7c86;
  color: #fff;
  border: 0;
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-small {
  padding: 4px 8px;
  font-size: 12px;
  background: #0e7c86;
  color: #fff;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  margin-right: 4px;
}

.btn-small.deactivate {
  background: #c62828;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.table th {
  background: #f5f5f5;
  padding: 8px;
  text-align: left;
  border-bottom: 2px solid #ddd;
}

.table td {
  padding: 8px;
  border-bottom: 1px solid #eee;
}

.badge {
  display: inline-block;
  padding: 4px 8px;
  background: #e3f2fd;
  color: #1976d2;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.status {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.status.pending {
  background: #fff3cd;
  color: #856404;
}

.status.synced {
  background: #d4edda;
  color: #155724;
}

.status.failed {
  background: #f8d7da;
  color: #721c24;
}

.status.skipped {
  background: #e2e3e5;
  color: #383d41;
}

.message {
  padding: 12px;
  border-radius: 6px;
  margin-top: 16px;
}

.message.success {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.message.error {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.empty {
  color: #999;
  font-style: italic;
}

details {
  cursor: pointer;
}

details summary {
  font-weight: 600;
  padding: 8px;
  background: #f9f9f9;
  border-radius: 4px;
  margin: 8px 0;
}
</style>
