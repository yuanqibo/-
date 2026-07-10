<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">AM</div>
        <div>
          <div class="brand-name">资产云管家</div>
          <div class="brand-subtitle">ITAM Portal</div>
        </div>
      </div>
      <nav id="nav" class="nav"></nav>
      <div id="sidebarTools" class="sidebar-tools"></div>
    </aside>

    <aside id="secondarySidebar" class="secondary-sidebar" aria-hidden="true"></aside>

    <main class="workspace">
      <header class="topbar">
        <div class="topbar-actions">
          <button class="icon-button" title="消息中心" aria-label="消息中心">◔</button>
          <button class="icon-button" title="系统设置" aria-label="系统设置">⚙</button>
          <div class="avatar">验</div>
        </div>
      </header>

      <section id="page" class="page"></section>
    </main>
  </div>

  <div id="drawerBackdrop" class="drawer-backdrop"></div>
  <aside id="drawer" class="drawer" aria-hidden="true">
    <div class="drawer-header">
      <div>
        <div id="drawerEyebrow" class="eyebrow">资产详情</div>
        <h2 id="drawerTitle">-</h2>
      </div>
      <button id="drawerClose" class="icon-button" title="关闭" aria-label="关闭">×</button>
    </div>
    <div id="drawerBody" class="drawer-body"></div>
  </aside>

  <div id="modalBackdrop" class="modal-backdrop"></div>
  <section id="modal" class="modal" aria-hidden="true">
    <div class="modal-header">
      <h2 id="modalTitle">新建申请</h2>
      <button id="modalClose" class="icon-button" title="关闭" aria-label="关闭">×</button>
    </div>
    <div id="modalBody"></div>
  </section>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>
</template>
