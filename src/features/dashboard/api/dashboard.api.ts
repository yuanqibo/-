import { fetchAssetCatalog, fetchBusinessData } from '../../assets/api/assets.api'

export const fetchDashboardData = async () => {
  const [catalog, business] = await Promise.all([fetchAssetCatalog(), fetchBusinessData()])
  return {
    assets: catalog.items,
    disposedCount: catalog.disposedCount,
    requests: business.values?.requests || []
  }
}
