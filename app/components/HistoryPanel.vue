<script setup lang="ts">
type HistoryResult = {
  checkedAt: string
  outcome: 'UP' | 'DOWN'
  responseMs: number | null
  statusCode: number | null
  errorCode: string | null
  errorMessage: string | null
}

const props = defineProps<{
  instanceId: string
  monitorName: string
  status: 'UNKNOWN' | 'UP' | 'DOWN'
  lastCheckedAt: string | null
  lastResponseMs: number | null
  pending: boolean
  error: string
  results: HistoryResult[] | null
  formatWhen: (value: string | null) => string
  formatResponse: (ms: number | null) => string
  resultDetail: (result: HistoryResult) => string
}>()

const headingId = computed(() => `history-heading-${props.instanceId}`)
const panelId = computed(() => `history-panel-${props.instanceId}`)
</script>

<template>
  <div :id="panelId" class="history-panel" role="region" :aria-labelledby="headingId" tabindex="-1">
    <h3 :id="headingId" class="history-panel-heading" tabindex="-1">History — {{ monitorName }}</h3>

    <div class="history-summary">
      <span>
        Status
        <StatusBadge :status="status" />
      </span>
      <span>
        Last checked <strong>{{ formatWhen(lastCheckedAt) }}</strong>
      </span>
      <span>
        Response <strong>{{ formatResponse(lastResponseMs) }}</strong>
      </span>
    </div>

    <p v-if="status === 'DOWN'" class="error" role="status">This monitor is currently Down.</p>

    <p v-if="pending" class="muted" role="status">Loading history…</p>
    <p v-else-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="results && results.length === 0" class="history-empty">
      No checks yet. The first result will appear after the next scheduled check.
    </p>

    <div v-else-if="results?.length" class="table-wrap history-inner-table">
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
          <tr v-for="(result, index) in results" :key="`${result.checkedAt}-${index}`">
            <td class="numeric">{{ formatWhen(result.checkedAt) }}</td>
            <td>
              <StatusBadge :status="result.outcome" />
            </td>
            <td class="numeric">{{ formatResponse(result.responseMs) }}</td>
            <td>{{ resultDetail(result) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
