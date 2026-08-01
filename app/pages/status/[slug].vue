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
  return new Date(value).toLocaleString()
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
        <h1>Pulse</h1>
        <p class="muted">Public status</p>
      </div>
      <NuxtLink to="/login" class="secondary">Sign in</NuxtLink>
    </header>

    <div class="stack">
      <section class="panel stack" aria-labelledby="status-title">
        <h2 id="status-title">
          <span v-if="page">{{ page.slug }}</span>
          <span v-else>Status page</span>
        </h2>

        <p v-if="pending" class="muted" role="status">Loading…</p>
        <p v-else-if="error" class="error" role="alert">Status page not found.</p>

        <template v-else-if="page">
          <p v-if="page.monitors.length === 0" class="muted">
            No public monitors are published on this status page.
          </p>

          <div v-else class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last checked</th>
                  <th scope="col">Response</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="monitor in page.monitors" :key="monitor.name">
                  <td>{{ monitor.name }}</td>
                  <td>
                    <span class="badge" :aria-label="`Status ${monitor.status}`">{{
                      monitor.status
                    }}</span>
                  </td>
                  <td>{{ formatWhen(monitor.lastCheckedAt) }}</td>
                  <td>{{ formatResponse(monitor.lastResponseMs) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
    </div>
  </main>
</template>
