import { apiRequest } from '../../../shared/api/http'
import type { LegacyAssetSyncHistoryPage, LegacyAssetSyncStatus, SelfServiceSettings, SystemFormDefinition, SystemIntegration } from '../types/system-settings'

export const fetchIntegrations = async (): Promise<SystemIntegration[]> =>
  (await apiRequest<{ items: SystemIntegration[] }>('/api/system/integrations')).items || []

export const saveIntegration = (value: Omit<SystemIntegration, 'id' | 'secretConfigured' | 'updatedAt'> & { id?: string; secret?: string; clearSecret?: boolean }): Promise<SystemIntegration> => {
  const { id, ...body } = value
  return apiRequest<SystemIntegration>(id ? `/api/system/integrations/${encodeURIComponent(id)}` : '/api/system/integrations', { method: id ? 'PUT' : 'POST', body })
}

export const fetchLegacyAssetSyncStatus = (): Promise<LegacyAssetSyncStatus> =>
  apiRequest<LegacyAssetSyncStatus>('/api/system/legacy-asset-sync/status')

export const fetchLegacyAssetSyncHistory = (page = 1, pageSize = 10): Promise<LegacyAssetSyncHistoryPage> =>
  apiRequest<LegacyAssetSyncHistoryPage>(`/api/system/legacy-asset-sync/history?page=${page}&pageSize=${pageSize}`)

export const fetchForms = async (): Promise<SystemFormDefinition[]> =>
  (await apiRequest<{ items: SystemFormDefinition[] }>('/api/system/forms')).items || []

export const saveForm = (value: Omit<SystemFormDefinition, 'id' | 'updatedAt'> & { id?: string }): Promise<SystemFormDefinition> => {
  const { id, ...body } = value
  return apiRequest<SystemFormDefinition>(id ? `/api/system/forms/${encodeURIComponent(id)}` : '/api/system/forms', { method: id ? 'PUT' : 'POST', body })
}

export const deleteForm = (id: string, expectedVersion: number): Promise<void> =>
  apiRequest(`/api/system/forms/${encodeURIComponent(id)}?expectedVersion=${expectedVersion}`, { method: 'DELETE' })

export const fetchSelfServiceSettings = async (): Promise<SelfServiceSettings> => {
  const payload = await apiRequest<{ values?: { assetPortalSelfServiceSettingsV9?: SelfServiceSettings } }>('/api/store')
  return payload.values?.assetPortalSelfServiceSettingsV9 || {}
}

export const saveSelfServiceSettings = (value: SelfServiceSettings): Promise<unknown> =>
  apiRequest('/api/config/settings/self-service', { method: 'PUT', body: { value } })
