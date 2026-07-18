<script setup lang="ts">
import { useRouter } from 'vue-router'
import { CollectionTag, Location, Postcard, Tickets } from '@element-plus/icons-vue'

const router = useRouter()
const items = [
  { title: '位置管理', description: '维护公司、仓库、楼层等资产存放位置。', path: '/assets/settings/locations', icon: Location },
  { title: '资产分类', description: '维护资产大类、默认字段和分类启用状态。', path: '/assets/settings/categories', icon: CollectionTag },
  { title: '资产编码规则', description: '配置资产编码前缀、流水号位数和生成规则。', path: '/assets/settings/code-rules', icon: Postcard },
  { title: '标签模板设置', description: '配置资产标签尺寸、打印字段和二维码内容。', path: '/assets/settings/label-templates', icon: Tickets }
]
</script>

<template>
  <section class="standard-business-view"><header class="standard-page-header"><div><h1>资产设置</h1><p>统一维护资产基础目录、编码规则和标签模板。</p></div></header>
    <div class="standard-setting-grid"><button v-for="item in items" :key="item.path" type="button" class="standard-setting-item" @click="router.push(item.path)"><el-icon :size="26"><component :is="item.icon" /></el-icon><span><strong>{{ item.title }}</strong><small>{{ item.description }}</small></span></button></div>
  </section>
</template>
