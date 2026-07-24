import type { CatalogNode } from '../types/assets'

export type ManagedCatalogOption = {
  value: string
  label: string
  unit?: string
  usefulLife?: string
}

export const flattenManagedCatalog = (
  nodes: CatalogNode[],
  parentPath: string[] = [],
  leafOnly = false
): ManagedCatalogOption[] => nodes.flatMap((node) => {
  const path = [...parentPath, node.name]
  const children = flattenManagedCatalog(node.children || [], path, leafOnly)
  if (leafOnly && (node.children || []).length) return children
  return [{
    value: leafOnly ? node.name : path.join(' / '),
    label: path.join(' / '),
    unit: node.unit,
    usefulLife: node.usefulLife
  }, ...children]
})
