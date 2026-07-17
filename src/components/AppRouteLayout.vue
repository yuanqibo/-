<template>
  <RouterView v-slot="{ Component }">
    <KeepAlive include="PortalView">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
</template>
