import type { CatalogNode } from '../types/assets'

type CatalogNodeLike = {
  name?: unknown
  children?: unknown
}

const catalogNodes = (value: unknown): CatalogNode[] => {
  if (!Array.isArray(value)) return []
  return value.filter((node): node is CatalogNode => Boolean(
    node && typeof node === 'object' && typeof (node as CatalogNodeLike).name === 'string'
  ))
}

const catalogChildren = (node: CatalogNode): CatalogNode[] => catalogNodes((node as CatalogNodeLike).children)

export type ManagedCatalogOption = {
  value: string
  label: string
  unit?: string
  usefulLife?: string
}

export type ManagedCatalogTreeOption = ManagedCatalogOption & {
  children?: ManagedCatalogTreeOption[]
}

export const managedCatalogNames = (nodes: CatalogNode[]): string[] => catalogNodes(nodes).flatMap((node) => [
  node.name,
  ...managedCatalogNames(catalogChildren(node))
])

export const flattenManagedCatalog = (
  nodes: CatalogNode[],
  parentPath: string[] = [],
  leafOnly = false
): ManagedCatalogOption[] => catalogNodes(nodes).flatMap((node) => {
  const path = [...parentPath, node.name]
  const childNodes = catalogChildren(node)
  const children = flattenManagedCatalog(childNodes, path, leafOnly)
  if (leafOnly && childNodes.length) return children
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
): ManagedCatalogTreeOption[] => catalogNodes(nodes).map((node) => {
  const path = [...parentPath, node.name]
  const children = buildManagedCatalogTree(catalogChildren(node), path, leafOnly)
  return {
    value: leafOnly ? node.name : path.join(' / '),
    label: node.name,
    unit: node.unit,
    usefulLife: node.usefulLife,
    ...(children.length ? { children } : {})
  }
})
