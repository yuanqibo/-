<script setup lang="ts">
defineProps<{ kind: string }>()
</script>

<template>
  <svg v-if="kind === 'home'" class="nav-home-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <g transform="translate(0 -1.5)">
      <path d="M8.5 22.4 24 9.5l15.5 12.9v16.1a3 3 0 0 1-3 3h-25a3 3 0 0 1-3-3V22.4Z" fill="currentColor" />
      <path d="M20 29.5a4 4 0 0 1 8 0v12h-8v-12Z" fill="#ffffff" />
    </g>
  </svg>
  <svg v-else-if="kind === 'assets'" class="nav-asset-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <g transform="translate(0 -0.5) translate(24 24.5) scale(1.1) translate(-24 -24.5)">
      <rect x="10" y="10" width="28" height="21" rx="3.5" fill="currentColor" />
      <path d="M18.5 20.5h11" stroke="#ffffff" stroke-width="3" stroke-linecap="round" />
      <path d="M22 31h4v5h8v3H14v-3h8v-5Z" fill="currentColor" />
    </g>
  </svg>
  <svg v-else-if="kind === 'requests'" class="nav-approval-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <g transform="translate(-3.1 -0.75) translate(27.1 24.75) scale(1.08 .93) translate(-27.1 -24.75)">
      <path d="M13 7.5h19.5l5.5 5.8V35a3.5 3.5 0 0 1-3.5 3.5h-18A3.5 3.5 0 0 1 13 35V7.5Z" fill="currentColor" />
      <path d="M31.8 7.5v6.2h6.2" fill="#ffffff" opacity=".9" />
      <path d="M18.5 17h11.5M18.5 23h11.5M18.5 29h7.5" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" />
      <circle cx="33.5" cy="33" r="4.8" fill="currentColor" stroke="#ffffff" stroke-width="2.4" />
      <path d="M25.8 42c1.4-4.1 4.3-6 7.7-6s6.3 1.9 7.7 6H25.8Z" fill="currentColor" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round" />
    </g>
  </svg>
  <svg v-else-if="kind === 'signatures'" class="nav-signature-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path d="M33.8 6.8a4.2 4.2 0 0 1 5.9 5.9L20.4 32l-8.1 2.1 2.1-8.1L33.8 6.8Z" fill="currentColor" />
    <path d="m30.3 10.3 5.9 5.9" fill="none" stroke="#fff" stroke-width="2.6" />
    <path d="M8.5 40h31" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" />
  </svg>
  <svg v-else class="nav-system-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <g transform="translate(0 -2) translate(24 26) scale(.8) translate(-24 -26)">
      <path d="M21.1 6h5.8l1.1 5.1c1.2.4 2.3.9 3.3 1.6l4.4-2.8 4.1 4.1-2.8 4.4c.7 1 1.2 2.2 1.6 3.3l5.1 1.1v5.8l-5.1 1.1c-.4 1.2-.9 2.3-1.6 3.3l2.8 4.4-4.1 4.1-4.4-2.8c-1 .7-2.2 1.2-3.3 1.6L26.9 46h-5.8l-1.1-5.1c-1.2-.4-2.3-.9-3.3-1.6l-4.4 2.8-4.1-4.1 2.8-4.4c-.7-1-1.2-2.2-1.6-3.3L4.3 29.2v-5.8l5.1-1.1c.4-1.2.9-2.3 1.6-3.3L8.2 14.6l4.1-4.1 4.4 2.8c1-.7 2.2-1.2 3.3-1.6L21.1 6Z" fill="currentColor" />
      <circle cx="24" cy="26.3" r="6.2" fill="#ffffff" />
    </g>
  </svg>
</template>
