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
const historyCache = ref<Record<string, HistoryResult[]>>({})
const actionPendingId = ref<string | null>(null)
const openMenuId = ref<string | null>(null)

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
  openMenuId.value = null
  editingId.value = monitor.id
  form.name = monitor.name
  form.url = monitor.url
  form.intervalSeconds = monitor.intervalSeconds
  form.enabled = monitor.enabled
  form.isPublic = monitor.isPublic
  formError.value = ''
  if (import.meta.client) {
    nextTick(() => {
      const title = document.getElementById('monitor-form-title')
      title?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      title?.focus({ preventScroll: true })
    })
  }
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
  openMenuId.value = null
  formError.value = ''
  actionPendingId.value = monitor.id
  try {
    await $fetch(`/api/monitors/${monitor.id}`, {
      method: 'PATCH',
      body: { enabled: !monitor.enabled },
    })
    await refreshMonitors()
  } catch (error) {
    formError.value = apiErrorMessage(error)
  } finally {
    actionPendingId.value = null
  }
}

async function togglePublic(monitor: Monitor) {
  openMenuId.value = null
  formError.value = ''
  actionPendingId.value = monitor.id
  try {
    await $fetch(`/api/monitors/${monitor.id}`, {
      method: 'PATCH',
      body: { isPublic: !monitor.isPublic },
    })
    await refreshMonitors()
  } catch (error) {
    formError.value = apiErrorMessage(error)
  } finally {
    actionPendingId.value = null
  }
}

async function removeMonitor(monitor: Monitor) {
  openMenuId.value = null
  if (!window.confirm(`Delete monitor “${monitor.name}”? This cannot be undone.`)) {
    return
  }
  formError.value = ''
  actionPendingId.value = monitor.id
  try {
    await $fetch(`/api/monitors/${monitor.id}`, {
      method: 'DELETE',
    })
    if (editingId.value === monitor.id) {
      resetForm()
    }
    if (selectedMonitorId.value === monitor.id) {
      selectedMonitorId.value = null
      historyResults.value = null
    }
    historyCache.value = Object.fromEntries(
      Object.entries(historyCache.value).filter(([id]) => id !== monitor.id),
    )
    await refreshMonitors()
  } catch (error) {
    formError.value = apiErrorMessage(error)
  } finally {
    actionPendingId.value = null
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
  const date = new Date(value)
  const deltaMs = Date.now() - date.getTime()
  if (Number.isNaN(deltaMs)) return 'Never'
  if (deltaMs < 45_000) return 'Just now'
  if (deltaMs < 90_000) return '1 minute ago'
  if (deltaMs < 3_600_000) return `${Math.round(deltaMs / 60_000)} minutes ago`
  if (deltaMs < 5_400_000) return '1 hour ago'
  if (deltaMs < 86_400_000) return `${Math.round(deltaMs / 3_600_000)} hours ago`
  return date.toLocaleString()
}

function formatResponse(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  return `${ms} ms`
}

const monitorCount = computed(() => monitorsData.value?.monitors.length ?? 0)

function historyInstanceId(monitorId: string, surface: 'desktop' | 'mobile'): string {
  return `${surface}-${monitorId}`
}

function revealHistory(monitorId: string) {
  if (!import.meta.client) return
  nextTick(() => {
    const candidates = [
      historyInstanceId(monitorId, 'desktop'),
      historyInstanceId(monitorId, 'mobile'),
    ]
    for (const instanceId of candidates) {
      const panel = document.getElementById(`history-panel-${instanceId}`)
      if (!panel) continue
      const visible = panel.getClientRects().length > 0
      if (!visible) continue
      const heading = document.getElementById(`history-heading-${instanceId}`)
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      heading?.focus({ preventScroll: true })
      return
    }
  })
}

async function loadHistory(monitor: Monitor) {
  historyError.value = ''
  const cached = historyCache.value[monitor.id]
  if (cached) {
    historyResults.value = cached
    historyPending.value = false
    return
  }

  historyPending.value = true
  historyResults.value = null
  try {
    const data = await $fetch<{ results: HistoryResult[] }>(
      `/api/monitors/${monitor.id}/history?limit=20`,
    )
    historyResults.value = data.results
    historyCache.value = {
      ...historyCache.value,
      [monitor.id]: data.results,
    }
  } catch (error) {
    historyError.value = apiErrorMessage(error)
    historyResults.value = null
  } finally {
    historyPending.value = false
  }
}

async function toggleHistory(monitor: Monitor) {
  openMenuId.value = null
  if (selectedMonitorId.value === monitor.id) {
    selectedMonitorId.value = null
    historyResults.value = null
    historyError.value = ''
    historyPending.value = false
    return
  }

  selectedMonitorId.value = monitor.id
  await nextTick()
  revealHistory(monitor.id)
  await loadHistory(monitor)
  revealHistory(monitor.id)
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

function isBusy(monitorId: string): boolean {
  return actionPendingId.value === monitorId
}

function isExpanded(monitorId: string): boolean {
  return selectedMonitorId.value === monitorId
}

function flagsLabel(monitor: Monitor): string {
  return `${monitor.enabled ? 'Enabled' : 'Disabled'} · ${monitor.isPublic ? 'Public' : 'Private'}`
}

function setMenuOpen(monitorId: string, open: boolean) {
  openMenuId.value = open ? monitorId : openMenuId.value === monitorId ? null : openMenuId.value
}

function runMenuAction(close: () => void, action: () => void | Promise<void>) {
  close()
  void action()
}
</script>

<template>
  <main>
    <header class="site-header">
      <div>
        <p class="page-kicker">Dashboard</p>
        <h1>Pulse</h1>
        <p class="muted">Monitor uptime, review recent checks, and publish a public status page.</p>
        <p class="muted">Signed in as {{ meData?.user.email }}</p>
      </div>
      <button type="button" class="secondary" @click="logout">Log out</button>
    </header>

    <div class="stack">
      <section
        v-if="meData?.user.statusPageSlug"
        class="panel stack-sm"
        aria-labelledby="status-link-title"
      >
        <div class="section-head">
          <h2 id="status-link-title">Public status page</h2>
        </div>
        <p class="muted">
          Share this unauthenticated page. Only enabled monitors marked public appear there.
        </p>
        <p>
          <NuxtLink :to="`/status/${meData.user.statusPageSlug}`">
            /status/{{ meData.user.statusPageSlug }}
          </NuxtLink>
        </p>
        <label class="field" for="status-page-url">
          <span class="field-label">Copyable URL</span>
          <input
            id="status-page-url"
            :value="statusPageAbsoluteUrl"
            readonly
            aria-label="Public status page URL"
            @focus="($event.target as HTMLInputElement).select()"
          />
        </label>
      </section>

      <section class="panel stack-sm" aria-labelledby="webhook-settings-title">
        <div class="section-head">
          <h2 id="webhook-settings-title">Webhook notifications</h2>
        </div>
        <p class="muted">
          One destination per account. Disabling stops new events; already-queued notifications keep
          their saved destination and may still deliver.
        </p>
        <form class="stack-sm" @submit.prevent="saveWebhookSettings">
          <label class="field" for="webhook-url">
            <span class="field-label">Webhook URL</span>
            <input
              id="webhook-url"
              v-model="webhookForm.webhookUrl"
              name="webhookUrl"
              type="url"
              placeholder="https://hooks.example.com/pulse"
              :disabled="settingsPending"
            />
          </label>
          <div class="checkbox-options">
            <CheckboxField
              id="webhook-enabled"
              v-model="webhookForm.enabled"
              name="webhookEnabled"
              :disabled="settingsPending"
            >
              Enabled
            </CheckboxField>
          </div>
          <p v-if="webhookError" class="error" role="alert">{{ webhookError }}</p>
          <p v-if="webhookMessage" class="success" role="status">{{ webhookMessage }}</p>
          <div class="row">
            <button type="submit" :disabled="webhookPending || settingsPending">
              {{ webhookPending ? 'Saving…' : 'Save webhook settings' }}
            </button>
          </div>
        </form>
      </section>

      <section class="panel stack-sm" aria-labelledby="monitor-form-title">
        <div class="section-head">
          <h2 id="monitor-form-title" tabindex="-1">
            {{ editingId ? 'Edit monitor' : 'Create monitor' }}
          </h2>
          <p v-if="editingId" class="muted">Update the selected monitor, then save.</p>
          <p v-else class="muted">Add an HTTP or HTTPS endpoint to check on a schedule.</p>
        </div>

        <form class="stack-sm" @submit.prevent="saveMonitor">
          <div class="form-grid form-grid-2">
            <label class="field" for="monitor-name">
              <span class="field-label">Name</span>
              <input id="monitor-name" v-model="form.name" name="name" required maxlength="200" />
            </label>
            <label class="field" for="monitor-interval">
              <span class="field-label">Check interval</span>
              <select
                id="monitor-interval"
                v-model.number="form.intervalSeconds"
                name="intervalSeconds"
              >
                <option v-for="option in intervalOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label class="field form-span-2" for="monitor-url">
              <span class="field-label">URL</span>
              <input id="monitor-url" v-model="form.url" name="url" type="url" required />
              <p class="field-hint">HTTPS preferred. Credentials in the URL are rejected.</p>
            </label>
          </div>

          <div class="checkbox-options" role="group" aria-label="Monitor options">
            <CheckboxField id="monitor-enabled" v-model="form.enabled" name="enabled">
              Enabled
            </CheckboxField>
            <CheckboxField id="monitor-public" v-model="form.isPublic" name="isPublic">
              Show on public status page
            </CheckboxField>
          </div>

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

      <section class="panel stack-sm" aria-labelledby="monitor-list-title">
        <div class="row-between">
          <div>
            <h2 id="monitor-list-title">Your monitors</h2>
            <p class="muted" style="margin: 0">
              {{ monitorCount }} monitor{{ monitorCount === 1 ? '' : 's' }}
            </p>
          </div>
          <span v-if="monitorsPending" class="muted" role="status">Loading…</span>
        </div>

        <EmptyState
          v-if="!monitorsPending && !monitorsData?.monitors.length"
          title="No monitors yet"
        >
          Create your first monitor above to start checking uptime.
        </EmptyState>

        <template v-else-if="monitorsData?.monitors.length">
          <div class="table-wrap table-desktop">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col" class="col-monitor">Monitor</th>
                  <th scope="col" class="col-status">Status</th>
                  <th scope="col" class="col-checked">Last checked</th>
                  <th scope="col" class="col-response">Response</th>
                  <th scope="col" class="col-interval">Interval</th>
                  <th scope="col" class="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="monitor in monitorsData.monitors" :key="monitor.id">
                  <tr :class="{ 'is-expanded': isExpanded(monitor.id) }">
                    <td class="col-monitor">
                      <div class="monitor-name">
                        <strong>{{ monitor.name }}</strong>
                        <span class="monitor-url" :title="monitor.url">{{ monitor.url }}</span>
                        <p class="monitor-flags">{{ flagsLabel(monitor) }}</p>
                      </div>
                    </td>
                    <td class="col-status">
                      <StatusBadge :status="monitor.status" />
                    </td>
                    <td class="numeric col-checked">{{ formatWhen(monitor.lastCheckedAt) }}</td>
                    <td class="numeric col-response">
                      {{ formatResponse(monitor.lastResponseMs) }}
                    </td>
                    <td class="interval-cell col-interval">
                      {{ formatInterval(monitor.intervalSeconds) }}
                    </td>
                    <td class="col-actions">
                      <div class="monitor-actions">
                        <button
                          type="button"
                          class="secondary"
                          :aria-expanded="isExpanded(monitor.id)"
                          :aria-controls="`history-panel-${historyInstanceId(monitor.id, 'desktop')}`"
                          :disabled="isBusy(monitor.id)"
                          @click="toggleHistory(monitor)"
                        >
                          History
                        </button>
                        <button
                          type="button"
                          class="secondary"
                          :disabled="isBusy(monitor.id)"
                          @click="startEdit(monitor)"
                        >
                          Edit
                        </button>
                        <ActionMenu
                          :open="openMenuId === monitor.id"
                          :disabled="isBusy(monitor.id)"
                          @update:open="setMenuOpen(monitor.id, $event)"
                        >
                          <template #default="{ close }">
                            <button
                              type="button"
                              class="ghost"
                              role="menuitem"
                              @click="runMenuAction(close, () => toggleEnabled(monitor))"
                            >
                              {{ monitor.enabled ? 'Disable' : 'Enable' }}
                            </button>
                            <button
                              type="button"
                              class="ghost"
                              role="menuitem"
                              @click="runMenuAction(close, () => togglePublic(monitor))"
                            >
                              {{ monitor.isPublic ? 'Make private' : 'Make public' }}
                            </button>
                            <button
                              type="button"
                              class="danger"
                              role="menuitem"
                              @click="runMenuAction(close, () => removeMonitor(monitor))"
                            >
                              Delete
                            </button>
                          </template>
                        </ActionMenu>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="isExpanded(monitor.id)" class="history-detail-row">
                    <td colspan="6">
                      <HistoryPanel
                        :instance-id="historyInstanceId(monitor.id, 'desktop')"
                        :monitor-name="monitor.name"
                        :status="monitor.status"
                        :last-checked-at="monitor.lastCheckedAt"
                        :last-response-ms="monitor.lastResponseMs"
                        :pending="historyPending"
                        :error="historyError"
                        :results="historyResults"
                        :format-when="formatWhen"
                        :format-response="formatResponse"
                        :result-detail="resultDetail"
                      />
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div class="monitor-cards" aria-label="Monitor list">
            <article
              v-for="monitor in monitorsData.monitors"
              :key="`card-${monitor.id}`"
              class="monitor-card"
              :class="{ 'is-expanded': isExpanded(monitor.id) }"
            >
              <div class="monitor-card-top">
                <div class="monitor-name">
                  <strong>{{ monitor.name }}</strong>
                  <span class="monitor-url" :title="monitor.url">{{ monitor.url }}</span>
                  <p class="monitor-flags">{{ flagsLabel(monitor) }}</p>
                </div>
                <StatusBadge :status="monitor.status" />
              </div>

              <dl class="monitor-card-meta">
                <div>
                  <dt>Last checked</dt>
                  <dd>{{ formatWhen(monitor.lastCheckedAt) }}</dd>
                </div>
                <div>
                  <dt>Response</dt>
                  <dd>{{ formatResponse(monitor.lastResponseMs) }}</dd>
                </div>
                <div>
                  <dt>Interval</dt>
                  <dd>{{ formatInterval(monitor.intervalSeconds) }}</dd>
                </div>
              </dl>

              <div class="monitor-actions">
                <button
                  type="button"
                  class="secondary"
                  :aria-expanded="isExpanded(monitor.id)"
                  :aria-controls="`history-panel-${historyInstanceId(monitor.id, 'mobile')}`"
                  :disabled="isBusy(monitor.id)"
                  @click="toggleHistory(monitor)"
                >
                  History
                </button>
                <button
                  type="button"
                  class="secondary"
                  :disabled="isBusy(monitor.id)"
                  @click="startEdit(monitor)"
                >
                  Edit
                </button>
                <ActionMenu
                  :open="openMenuId === `card-${monitor.id}`"
                  :disabled="isBusy(monitor.id)"
                  @update:open="setMenuOpen(`card-${monitor.id}`, $event)"
                >
                  <template #default="{ close }">
                    <button
                      type="button"
                      class="ghost"
                      role="menuitem"
                      @click="runMenuAction(close, () => toggleEnabled(monitor))"
                    >
                      {{ monitor.enabled ? 'Disable' : 'Enable' }}
                    </button>
                    <button
                      type="button"
                      class="ghost"
                      role="menuitem"
                      @click="runMenuAction(close, () => togglePublic(monitor))"
                    >
                      {{ monitor.isPublic ? 'Make private' : 'Make public' }}
                    </button>
                    <button
                      type="button"
                      class="danger"
                      role="menuitem"
                      @click="runMenuAction(close, () => removeMonitor(monitor))"
                    >
                      Delete
                    </button>
                  </template>
                </ActionMenu>
              </div>

              <HistoryPanel
                v-if="isExpanded(monitor.id)"
                :instance-id="historyInstanceId(monitor.id, 'mobile')"
                :monitor-name="monitor.name"
                :status="monitor.status"
                :last-checked-at="monitor.lastCheckedAt"
                :last-response-ms="monitor.lastResponseMs"
                :pending="historyPending"
                :error="historyError"
                :results="historyResults"
                :format-when="formatWhen"
                :format-response="formatResponse"
                :result-detail="resultDetail"
              />
            </article>
          </div>
        </template>
      </section>
    </div>
  </main>
</template>
