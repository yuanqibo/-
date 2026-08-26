<script setup lang="ts">
import { PictureFilled } from '@element-plus/icons-vue'
import { displayAssetCode, type AssetRecord } from '../../assets/types/assets'

defineProps<{
  asset: AssetRecord | null
  assignmentDate: string
  assignmentDateLabel: string
  assignmentLabel: string
  custodian: string
}>()

const emit = defineEmits<{
  close: []
  request: [action: 'return' | 'handover', asset: AssetRecord]
}>()

const text = (value: unknown): string => String(value ?? '').trim() || '-'
const modelLabel = (asset: AssetRecord): string => [asset.brand, asset.model].filter(Boolean).join(' ') || '-'
</script>

<template>
  <el-dialog
    :model-value="Boolean(asset)"
    class="employee-asset-detail-dialog"
    title="资产详情"
    aria-label="资产详情"
    width="min(520px, calc(100vw - 32px))"
    align-center
    append-to-body
    destroy-on-close
    @close="emit('close')"
  >
    <div v-if="asset" class="employee-asset-detail">
      <div class="employee-asset-detail-content">
        <section class="employee-asset-detail-summary">
          <div class="employee-asset-detail-image">
            <img v-if="asset.image" :src="asset.image" :alt="asset.name">
            <div v-else class="employee-asset-detail-image-empty"><el-icon><PictureFilled /></el-icon><span>暂无图片</span></div>
          </div>
          <div class="employee-asset-detail-heading">
            <div class="employee-asset-detail-title">
              <h2>{{ text(asset.name) }}</h2>
              <span class="device-card-status" :class="{ borrowed: ['借用', '借用中'].includes(asset.status) }">{{ assignmentLabel }}</span>
            </div>
            <dl class="employee-asset-detail-key-fields">
              <div><dt>资产编码</dt><dd><span class="asset-code-text">{{ displayAssetCode(asset) }}</span></dd></div>
              <div><dt>品牌/型号</dt><dd>{{ modelLabel(asset) }}</dd></div>
            </dl>
          </div>
        </section>

        <section class="employee-asset-detail-section">
          <h3>基本信息</h3>
          <dl class="employee-asset-detail-grid">
            <div><dt>资产分类</dt><dd>{{ text(asset.category || asset.type) }}</dd></div>
            <div><dt>设备序列号</dt><dd>{{ text(asset.sn) }}</dd></div>
            <div><dt>使用公司</dt><dd>{{ text(asset.company) }}</dd></div>
            <div><dt>所在位置</dt><dd>{{ text(asset.location) }}</dd></div>
            <div><dt>管理员</dt><dd>{{ custodian }}</dd></div>
            <div><dt>{{ assignmentDateLabel }}</dt><dd>{{ assignmentDate }}</dd></div>
            <div><dt>资产状况</dt><dd>{{ text(asset.condition) }}</dd></div>
          </dl>
        </section>
      </div>
    </div>
    <template v-if="asset" #footer>
      <div class="employee-asset-detail-actions">
        <button type="button" @click="emit('request', 'return', asset)">退还</button>
        <button type="button" class="primary" @click="emit('request', 'handover', asset)">交接</button>
      </div>
    </template>
  </el-dialog>
</template>
