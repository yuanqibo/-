import type { CatalogNode } from '../types/assets'

export type ManagedCatalogOption = {
  value: string
  label: string
  unit?: string
  usefulLife?: string
}

export type ManagedCatalogTreeOption = ManagedCatalogOption & {
  children?: ManagedCatalogTreeOption[]
}

export const managedCatalogNames = (nodes: CatalogNode[]): string[] => nodes.flatMap((node) => [
  node.name,
  ...managedCatalogNames(node.children || [])
])

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

export const buildManagedCatalogTree = (
  nodes: CatalogNode[],
  parentPath: string[] = [],
  leafOnly = false
): ManagedCatalogTreeOption[] => nodes.map((node) => {
  const path = [...parentPath, node.name]
  const children = buildManagedCatalogTree(node.children || [], path, leafOnly)
  return {
    value: leafOnly ? node.name : path.join(' / '),
    label: node.name,
    unit: node.unit,
    usefulLife: node.usefulLife,
    ...(children.length ? { children } : {})
  }
})
