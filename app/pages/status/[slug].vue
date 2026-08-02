<script setup lang="ts">
definePageMeta({
  middleware: undefined,
})

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))

const { data, error, pending } = await useFetch(() => `/api/public/status/${slug.value}`, {
  key: () => `public-status-${slug.value}`,
})

type PublicPage = {
  page: {
    slug: string
    monitors: Array<{
      name: string
      status: 'UNKNOWN' | 'UP' | 'DOWN'
      lastCheckedAt: string | null
      lastResponseMs: number | null
    }>
  }
}

const page = computed(() => (data.value as PublicPage | null)?.page ?? null)

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

useHead({
  title: computed(() => (page.value ? `Status — ${page.value.slug}` : 'Status')),
})
</script>

<template>
  <main>
    <header class="site-header">
      <div>
        <p class="page-kicker">Public status</p>
        <h1>Pulse</h1>
        <p class="muted">Live availability for published services.</p>
      </div>
      <NuxtLink to="/login" class="secondary">Sign in</NuxtLink>
    </header>

    <div class="stack">
      <section class="panel stack-sm" aria-labelledby="status-title">
        <div class="section-head">
          <h2 id="status-title">
            <span v-if="page">{{ page.slug }}</span>
            <span v-else>Status page</span>
          </h2>
        </div>

        <p v-if="pending" class="muted" role="status">Loading…</p>
        <p v-else-if="error" class="error" role="alert">Status page not found.</p>

        <template v-else-if="page">
          <EmptyState v-if="page.monitors.length === 0">
            No public monitors are published on this status page.
          </EmptyState>

          <div v-else class="status-grid">
            <article v-for="monitor in page.monitors" :key="monitor.name" class="status-card">
              <div class="row-between">
                <h3>{{ monitor.name }}</h3>
                <StatusBadge :status="monitor.status" />
              </div>
              <p class="muted" style="margin: 0">
                Last checked {{ formatWhen(monitor.lastCheckedAt) }}
              </p>
              <p class="muted" style="margin: 0">
                Response {{ formatResponse(monitor.lastResponseMs) }}
              </p>
            </article>
          </div>
        </template>
      </section>
    </div>
  </main>
</template>
