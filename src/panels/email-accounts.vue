<template>
  <div class="email-accounts-panel">
    <div class="panel-header">
      <h2>Email Accounts</h2>
      <p>Connect mailboxes for automated reading (invoice import and future email-parsing features). Admin only.</p>
    </div>

    <div class="section actions-row">
      <button class="btn btn-primary" :disabled="connecting" @click="connectNewAccount">
        {{ connecting ? 'Opening Google...' : '+ Connect New Account' }}
      </button>
      <button class="btn-small" :disabled="loading" @click="loadAccounts">Refresh</button>
    </div>

    <div v-if="forbidden" class="message error">
      You need admin access to view or manage email accounts.
    </div>

    <div v-else class="section">
      <table v-if="accounts.length" class="table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Provider</th>
            <th>Status</th>
            <th>Last Success</th>
            <th>Feature Flags</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="acct in accounts" :key="acct.id">
            <td>{{ acct.email_address }}</td>
            <td>{{ acct.provider }}</td>
            <td>
              <span class="status" :class="acct.status">{{ acct.status }}</span>
              <span v-if="acct.needs_reauth" class="badge reauth">needs re-auth</span>
              <div v-if="acct.last_error" class="last-error" :title="acct.last_error">{{ acct.last_error }}</div>
            </td>
            <td>{{ formatDate(acct.last_success_at) }}</td>
            <td>
              <label v-for="flag in availableFlags" :key="flag" class="flag-checkbox">
                <input
                  type="checkbox"
                  :checked="acct.feature_flags?.includes(flag)"
                  :disabled="acct.status === 'disabled'"
                  @change="toggleFlag(acct, flag, ($event.target as HTMLInputElement).checked)"
                />
                {{ flag }}
              </label>
            </td>
            <td class="actions-cell">
              <button class="btn-small" :disabled="busyId === acct.id" @click="checkNow(acct)">Check now</button>
              <button class="btn-small" :disabled="busyId === acct.id" @click="reconnect(acct)">Reconnect</button>
              <button
                v-if="acct.status !== 'disabled'"
                class="btn-small deactivate"
                :disabled="busyId === acct.id"
                @click="deactivate(acct)"
              >
                Deactivate
              </button>
              <button v-else class="btn-small" :disabled="busyId === acct.id" @click="activate(acct)">Activate</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!loading" class="empty">No email accounts connected yet.</p>
    </div>

    <div v-if="message" class="message success">{{ message }}</div>
    <div v-if="error" class="message error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

type EmailAccount = {
  id: number;
  email_address: string;
  provider: string;
  status: 'pending' | 'active' | 'error' | 'disabled';
  needs_reauth: boolean;
  feature_flags: string[];
  last_success_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  has_credentials: boolean;
};

const availableFlags = ['invoice_import'];

const accounts = ref<EmailAccount[]>([]);
const loading = ref(false);
const connecting = ref(false);
const busyId = ref<number | null>(null);
const message = ref('');
const error = ref('');
const forbidden = ref(false);

const showMessage = (text: string) => {
  message.value = text;
  setTimeout(() => (message.value = ''), 4000);
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : 'never');

const loadAccounts = async () => {
  loading.value = true;
  error.value = '';
  try {
    const response = await fetch('/email-accounts/accounts');
    if (response.status === 401 || response.status === 403) {
      forbidden.value = true;
      return;
    }
    forbidden.value = false;
    if (!response.ok) throw new Error('Failed to load email accounts');
    const body = await response.json();
    accounts.value = body.data || [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load email accounts';
  } finally {
    loading.value = false;
  }
};

const connectNewAccount = async () => {
  connecting.value = true;
  error.value = '';
  try {
    const response = await fetch('/email-accounts/oauth/start');
    if (!response.ok) throw new Error('Failed to start the connect flow');
    const body = await response.json();
    window.open(body.data.url, '_blank', 'noopener,width=500,height=650');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to start the connect flow';
  } finally {
    connecting.value = false;
  }
};

const reconnect = async (acct: EmailAccount) => {
  busyId.value = acct.id;
  error.value = '';
  try {
    const response = await fetch(`/email-accounts/oauth/start?reconnect_id=${acct.id}`);
    if (!response.ok) throw new Error('Failed to start the reconnect flow');
    const body = await response.json();
    window.open(body.data.url, '_blank', 'noopener,width=500,height=650');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to start the reconnect flow';
  } finally {
    busyId.value = null;
  }
};

const checkNow = async (acct: EmailAccount) => {
  busyId.value = acct.id;
  error.value = '';
  try {
    const response = await fetch(`/email-accounts/accounts/${acct.id}/health-check`, { method: 'POST' });
    if (!response.ok) throw new Error('Health check failed');
    showMessage(`Checked ${acct.email_address}.`);
    await loadAccounts();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Health check failed';
  } finally {
    busyId.value = null;
  }
};

const deactivate = async (acct: EmailAccount) => {
  if (!confirm(`Deactivate ${acct.email_address}? Polling stops but history is kept.`)) return;
  busyId.value = acct.id;
  try {
    const response = await fetch(`/email-accounts/accounts/${acct.id}/deactivate`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to deactivate');
    showMessage(`Deactivated ${acct.email_address}.`);
    await loadAccounts();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to deactivate';
  } finally {
    busyId.value = null;
  }
};

const activate = async (acct: EmailAccount) => {
  busyId.value = acct.id;
  try {
    const response = await fetch(`/email-accounts/accounts/${acct.id}/activate`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to activate');
    showMessage(`Activated ${acct.email_address}.`);
    await loadAccounts();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to activate';
  } finally {
    busyId.value = null;
  }
};

const toggleFlag = async (acct: EmailAccount, flag: string, enabled: boolean) => {
  const nextFlags = enabled
    ? Array.from(new Set([...(acct.feature_flags || []), flag]))
    : (acct.feature_flags || []).filter((f) => f !== flag);

  try {
    const response = await fetch(`/email-accounts/accounts/${acct.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_flags: nextFlags })
    });
    if (!response.ok) throw new Error('Failed to update feature flags');
    await loadAccounts();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update feature flags';
  }
};

const onOauthMessage = (event: MessageEvent) => {
  if (event.data?.source !== 'email-accounts-oauth') return;
  showMessage(event.data.ok ? 'Account connected.' : 'Connect flow did not complete.');
  loadAccounts();
};

onMounted(() => {
  loadAccounts();
  window.addEventListener('message', onOauthMessage);
});
onBeforeUnmount(() => window.removeEventListener('message', onOauthMessage));
</script>

<style scoped>
.email-accounts-panel {
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

.actions-row {
  display: flex;
  gap: 8px;
  align-items: center;
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

.btn-small:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
  vertical-align: top;
}

.status {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  text-transform: capitalize;
}

.status.active {
  background: #d4edda;
  color: #155724;
}

.status.pending {
  background: #fff3cd;
  color: #856404;
}

.status.error {
  background: #f8d7da;
  color: #721c24;
}

.status.disabled {
  background: #e2e3e5;
  color: #383d41;
}

.badge.reauth {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  background: #721c24;
  color: #fff;
}

.last-error {
  margin-top: 4px;
  font-size: 11px;
  color: #999;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flag-checkbox {
  display: block;
  font-size: 12px;
  margin-bottom: 2px;
}

.actions-cell {
  white-space: nowrap;
}

.message {
  padding: 12px;
  border-radius: 6px;
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
</style>
