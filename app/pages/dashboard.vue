<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

type Monitor = {
  id: string
  name: string
  url: string
  intervalSeconds: number
  enabled: boolean
  isPublic: boolean
  status: 'UNKNOWN' | 'UP' | 'DOWN'
  lastCheckedAt: string | null
  lastResponseMs: number | null
  lastStatusCode: number | null
}

type User = {
  id: string
  email: string
  statusPageSlug: string
}

const intervalOptions = [
  { label: '1 minute', value: 60 },
  { label: '5 minutes', value: 300 },
  { label: '15 minutes', value: 900 },
  { label: '30 minutes', value: 1800 },
  { label: '60 minutes', value: 3600 },
]

const { data: meData, error: meError } = await useFetch<{ user: User }>('/api/auth/me')

if (meError.value) {
  await navigateTo('/login')
}

const {
  data: monitorsData,
  refresh: refreshMonitors,
  pending: monitorsPending,
} = await useFetch<{ monitors: Monitor[] }>('/api/monitors')

const {
  data: settingsData,
  refresh: refreshSettings,
  pending: settingsPending,
} = await useFetch<{ settings: { webhookUrl: string | null; enabled: boolean } }>(
  '/api/notification-settings',
)

type HistoryResult = {
  checkedAt: string
  outcome: 'UP' | 'DOWN'
  responseMs: number | null
  statusCode: number | null
  errorCode: string | null
  errorMessage: string | null
}

const formError = ref('')
const formPending = ref(false)
const editingId = ref<string | null>(null)
const selectedMonitorId = ref<string | null>(null)
const historyResults = ref<HistoryResult[] | null>(null)
const historyPending = ref(false)
const historyError = ref('')

const webhookForm = reactive({
  webhookUrl: settingsData.value?.settings.webhookUrl ?? '',
  enabled: settingsData.value?.settings.enabled ?? false,
})
const webhookError = ref('')
const webhookPending = ref(false)
const webhookMessage = ref('')

const form = reactive({
  name: '',
  url: 'https://',
  intervalSeconds: 60,
  enabled: true,
  isPublic: false,
})

function resetForm() {
  editingId.value = null
  form.name = ''
  form.url = 'https://'
  form.intervalSeconds = 60
  form.enabled = true
  form.isPublic = false
  formError.value = ''
}

function startEdit(monitor: Monitor) {
  editingId.value = monitor.id
  form.name = monitor.name
  form.url = monitor.url
  form.intervalSeconds = monitor.intervalSeconds
  form.enabled = monitor.enabled
  form.isPublic = monitor.isPublic
  formError.value = ''
}

function apiErrorMessage(error: unknown): string {
  const data = (error as { data?: { error?: { message?: string } } })?.data
  return data?.error?.message ?? 'Request failed'
}

async function saveMonitor() {
  formError.value = ''
  formPending.value = true
  try {
    const body = {
      name: form.name,
      url: form.url,
      intervalSeconds: form.intervalSeconds,
      enabled: form.enabled,
      isPublic: form.isPublic,
    }

    if (editingId.value) {
      await $fetch(`/api/monitors/${editingId.value}`, {
        method: 'PATCH',
        body,
      })
    } else {
      await $fetch('/api/monitors', {
        method: 'POST',
        body,
      })
    }

    resetForm()
    await refreshMonitors()
  } catch (error) {
    formError.value = apiErrorMessage(error)
  } finally {
    formPending.value = false
  }
}

async function toggleEnabled(monitor: Monitor) {
  formError.value = ''
  try {
    await $fetch(`/api/monitors/${monitor.id}`, {
      method: 'PATCH',
      body: { enabled: !monitor.enabled },
    })
    await refreshMonitors()
  } catch (error) {
    formError.value = apiErrorMessage(error)
  }
}

async function togglePublic(monitor: Monitor) {
  formError.value = ''
  try {
    await $fetch(`/api/monitors/${monitor.id}`, {
      method: 'PATCH',
      body: { isPublic: !monitor.isPublic },
    })
    await refreshMonitors()
  } catch (error) {
    formError.value = apiErrorMessage(error)
  }
}

async function removeMonitor(monitor: Monitor) {
  if (!window.confirm(`Delete monitor “${monitor.name}”?`)) {
    return
  }
  formError.value = ''
  try {
    await $fetch(`/api/monitors/${monitor.id}`, {
      method: 'DELETE',
    })
    if (editingId.value === monitor.id) {
      resetForm()
    }
    await refreshMonitors()
  } catch (error) {
    formError.value = apiErrorMessage(error)
  }
}

async function logout() {
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  } finally {
    await navigateTo('/login')
  }
}

async function saveWebhookSettings() {
  webhookError.value = ''
  webhookMessage.value = ''
  webhookPending.value = true
  try {
    const trimmed = webhookForm.webhookUrl.trim()
    const body = {
      webhookUrl: trimmed.length > 0 ? trimmed : null,
      enabled: webhookForm.enabled,
    }
    const result = await $fetch<{ settings: { webhookUrl: string | null; enabled: boolean } }>(
      '/api/notification-settings',
      { method: 'PUT', body },
    )
    webhookForm.webhookUrl = result.settings.webhookUrl ?? ''
    webhookForm.enabled = result.settings.enabled
    webhookMessage.value = result.settings.enabled
      ? 'Webhook notifications enabled.'
      : result.settings.webhookUrl
        ? 'Webhook saved and disabled. Pending events already queued may still deliver.'
        : 'Webhook settings cleared.'
    await refreshSettings()
  } catch (error) {
    webhookError.value = apiErrorMessage(error)
  } finally {
    webhookPending.value = false
  }
}

function formatInterval(seconds: number): string {
  return intervalOptions.find((option) => option.value === seconds)?.label ?? `${seconds}s`
}

const statusPageAbsoluteUrl = computed(() => {
  const slug = meData.value?.user.statusPageSlug
  if (!slug || !import.meta.client) {
    return slug ? `/status/${slug}` : ''
  }
  return `${window.location.origin}/status/${slug}`
})

function formatWhen(value: string | null): string {
  if (!value) return 'Never'
  return new Date(value).toLocaleString()
}

function formatResponse(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  return `${ms} ms`
}

const selectedMonitor = computed(
  () =>
    monitorsData.value?.monitors.find((monitor) => monitor.id === selectedMonitorId.value) ?? null,
)

async function selectMonitor(monitor: Monitor) {
  selectedMonitorId.value = monitor.id
  historyError.value = ''
  historyPending.value = true
  historyResults.value = null
  try {
    const data = await $fetch<{ results: HistoryResult[] }>(
      `/api/monitors/${monitor.id}/history?limit=20`,
    )
    historyResults.value = data.results
  } catch (error) {
    historyError.value = apiErrorMessage(error)
    historyResults.value = null
  } finally {
    historyPending.value = false
  }
}

function resultDetail(result: HistoryResult): string {
  if (result.outcome === 'UP') {
    return result.statusCode !== null ? `HTTP ${result.statusCode}` : 'OK'
  }
  if (result.statusCode !== null) {
    return `HTTP ${result.statusCode}`
  }
  return result.errorCode ?? result.errorMessage ?? 'Failed'
}
</script>

<template>
  <main>
    <header class="site-header">
      <div>
        <h1>Pulse</h1>
        <p class="muted">Signed in as {{ meData?.user.email }}</p>
      </div>
      <button type="button" class="secondary" @click="logout">Log out</button>
    </header>

    <div class="stack">
      <section
        v-if="meData?.user.statusPageSlug"
        class="panel stack"
        aria-labelledby="status-link-title"
      >
        <h2 id="status-link-title">Public status page</h2>
        <p class="muted">
          Share this unauthenticated page. Only enabled monitors marked public appear there.
        </p>
        <p>
          <NuxtLink :to="`/status/${meData.user.statusPageSlug}`">
            /status/{{ meData.user.statusPageSlug }}
          </NuxtLink>
        </p>
        <label>
          Copyable URL
          <input
            :value="statusPageAbsoluteUrl"
            readonly
            aria-label="Public status page URL"
            @focus="($event.target as HTMLInputElement).select()"
          />
        </label>
      </section>

      <section class="panel stack" aria-labelledby="webhook-settings-title">
        <h2 id="webhook-settings-title">Webhook notifications</h2>
        <p class="muted">
          One destination per account. Disabling stops new events; already-queued notifications keep
          their saved destination and may still deliver.
        </p>
        <form class="stack" @submit.prevent="saveWebhookSettings">
          <label>
            Webhook URL
            <input
              v-model="webhookForm.webhookUrl"
              name="webhookUrl"
              type="url"
              placeholder="https://hooks.example.com/pulse"
              :disabled="settingsPending"
            />
          </label>
          <label class="row">
            <input v-model="webhookForm.enabled" type="checkbox" name="webhookEnabled" />
            Enabled
          </label>
          <p v-if="webhookError" class="error" role="alert">{{ webhookError }}</p>
          <p v-if="webhookMessage" class="muted" role="status">{{ webhookMessage }}</p>
          <button type="submit" :disabled="webhookPending || settingsPending">
            {{ webhookPending ? 'Saving…' : 'Save webhook settings' }}
          </button>
        </form>
      </section>

      <section class="panel stack" aria-labelledby="monitor-form-title">
        <h2 id="monitor-form-title">
          {{ editingId ? 'Edit monitor' : 'Add monitor' }}
        </h2>
        <form class="stack" @submit.prevent="saveMonitor">
          <label>
            Name
            <input v-model="form.name" name="name" required maxlength="200" />
          </label>
          <label>
            URL
            <input v-model="form.url" name="url" type="url" required />
          </label>
          <label>
            Check interval
            <select v-model.number="form.intervalSeconds" name="intervalSeconds">
              <option v-for="option in intervalOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label class="row">
            <input v-model="form.enabled" type="checkbox" name="enabled" />
            Enabled
          </label>
          <label class="row">
            <input v-model="form.isPublic" type="checkbox" name="isPublic" />
            Show on public status page
          </label>
          <p v-if="formError" class="error" role="alert">{{ formError }}</p>
          <div class="row">
            <button type="submit" :disabled="formPending">
              {{ formPending ? 'Saving…' : editingId ? 'Save changes' : 'Create monitor' }}
            </button>
            <button v-if="editingId" type="button" class="secondary" @click="resetForm">
              Cancel
            </button>
          </div>
        </form>
      </section>

      <section class="panel stack" aria-labelledby="monitor-list-title">
        <div class="row" style="justify-content: space-between">
          <h2 id="monitor-list-title">Your monitors</h2>
          <span v-if="monitorsPending" class="muted">Loading…</span>
        </div>

        <div v-if="!monitorsData?.monitors.length" class="muted">
          No monitors yet. Create one above.
        </div>

        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col">Last checked</th>
                <th scope="col">Response</th>
                <th scope="col">Interval</th>
                <th scope="col">Flags</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="monitor in monitorsData.monitors"
                :key="monitor.id"
                :aria-selected="selectedMonitorId === monitor.id"
              >
                <td>
                  <strong>{{ monitor.name }}</strong>
                  <div class="muted">{{ monitor.url }}</div>
                </td>
                <td>
                  <span class="badge" :aria-label="`Status ${monitor.status}`">{{
                    monitor.status
                  }}</span>
                </td>
                <td>{{ formatWhen(monitor.lastCheckedAt) }}</td>
                <td>{{ formatResponse(monitor.lastResponseMs) }}</td>
                <td>{{ formatInterval(monitor.intervalSeconds) }}</td>
                <td>
                  <div>{{ monitor.enabled ? 'Enabled' : 'Disabled' }}</div>
                  <div>{{ monitor.isPublic ? 'Public' : 'Private' }}</div>
                </td>
                <td>
                  <div class="row">
                    <button type="button" class="secondary" @click="selectMonitor(monitor)">
                      History
                    </button>
                    <button type="button" class="secondary" @click="startEdit(monitor)">
                      Edit
                    </button>
                    <button type="button" class="secondary" @click="toggleEnabled(monitor)">
                      {{ monitor.enabled ? 'Disable' : 'Enable' }}
                    </button>
                    <button type="button" class="secondary" @click="togglePublic(monitor)">
                      {{ monitor.isPublic ? 'Make private' : 'Make public' }}
                    </button>
                    <button type="button" class="danger" @click="removeMonitor(monitor)">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="selectedMonitorId" class="panel stack" aria-labelledby="monitor-history-title">
        <h2 id="monitor-history-title">
          Recent checks
          <span v-if="selectedMonitor"> — {{ selectedMonitor.name }}</span>
        </h2>

        <p v-if="selectedMonitor?.status === 'DOWN'" class="error" role="status">
          This monitor is currently DOWN.
        </p>
        <p v-if="selectedMonitor" class="muted">
          Status {{ selectedMonitor.status }}. Last checked
          {{ formatWhen(selectedMonitor.lastCheckedAt) }}. Latest response
          {{ formatResponse(selectedMonitor.lastResponseMs) }}.
        </p>

        <p v-if="historyPending" class="muted" role="status">Loading history…</p>
        <p v-else-if="historyError" class="error" role="alert">{{ historyError }}</p>
        <p v-else-if="historyResults && historyResults.length === 0" class="muted">
          No checks yet for this monitor.
        </p>

        <div v-else-if="historyResults?.length" class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Checked at</th>
                <th scope="col">Outcome</th>
                <th scope="col">Response</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(result, index) in historyResults" :key="`${result.checkedAt}-${index}`">
                <td>{{ formatWhen(result.checkedAt) }}</td>
                <td>
                  <span class="badge" :aria-label="`Outcome ${result.outcome}`">{{
                    result.outcome
                  }}</span>
                </td>
                <td>{{ formatResponse(result.responseMs) }}</td>
                <td>{{ resultDetail(result) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>
</template>
