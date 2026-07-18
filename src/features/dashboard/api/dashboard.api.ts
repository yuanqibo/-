import { fetchAssets, fetchBusinessData } from '../../assets/api/assets.api'

export const fetchDashboardData = async () => {
  const [assets, business] = await Promise.all([fetchAssets(), fetchBusinessData()])
  return { assets, requests: business.values?.requests || [] }
}
