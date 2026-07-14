import { access, readdir, readFile } from 'node:fs/promises'
import { parse } from 'yaml'

const projectRoot = new URL('..', import.meta.url)
const authzDir = new URL('authz/', projectRoot)
const requiredFiles = ['features.yaml', 'menus.yaml', 'permissions.yaml', 'roles.yaml', 'workspace.yaml']
const errors = []
const warnings = []

const fail = (code, message) => errors.push({ code, message })
const warn = (code, message) => warnings.push({ code, message })
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const asArray = (value, path) => {
  if (!Array.isArray(value)) {
    fail('ARRAY_REQUIRED', `${path} must be an array`)
    return []
  }
  return value
}

const actualFiles = (await readdir(authzDir)).filter((name) => /\.(ya?ml|json)$/i.test(name)).sort()
for (const fileName of actualFiles) {
  if (!requiredFiles.includes(fileName)) {
    fail('UNSUPPORTED_AUTHZ_FILE', `authz/${fileName} is not part of the five-file source of truth`)
  }
}
for (const fileName of requiredFiles) {
  if (!actualFiles.includes(fileName)) fail('AUTHZ_FILE_MISSING', `authz/${fileName} is required`)
}

const loadYaml = async (fileName, rootKey) => {
  let document
  try {
    document = parse(await readFile(new URL(fileName, authzDir), 'utf8'))
  } catch (error) {
    fail('YAML_PARSE_ERROR', `${fileName}: ${error instanceof Error ? error.message : String(error)}`)
    return {}
  }
  if (!isObject(document)) {
    fail('DOCUMENT_OBJECT_REQUIRED', `${fileName} must contain a YAML object`)
    return {}
  }
  for (const key of Object.keys(document)) {
    if (key !== rootKey) fail('UNSUPPORTED_ROOT_KEY', `${fileName} contains unsupported root key ${key}`)
  }
  if (!(rootKey in document)) fail('ROOT_KEY_MISSING', `${fileName} must declare ${rootKey}`)
  return document
}

const permissionsDocument = await loadYaml('permissions.yaml', 'resources')
const featuresDocument = await loadYaml('features.yaml', 'features')
const menusDocument = await loadYaml('menus.yaml', 'menus')
const rolesDocument = await loadYaml('roles.yaml', 'roles')
const workspaceDocument = await loadYaml('workspace.yaml', 'workspace')

const resources = asArray(permissionsDocument.resources, 'permissions.yaml resources')
const features = asArray(featuresDocument.features, 'features.yaml features')
const menus = asArray(menusDocument.menus, 'menus.yaml menus')
const roles = asArray(rolesDocument.roles, 'roles.yaml roles')
const workspace = isObject(workspaceDocument.workspace) ? workspaceDocument.workspace : {}
if (!isObject(workspaceDocument.workspace)) fail('WORKSPACE_OBJECT_REQUIRED', 'workspace.yaml workspace must be an object')

const permissionCodes = new Set()
const resourceCodes = new Set()
const allowedActions = new Set(['view', 'list', 'create', 'update', 'delete', 'assign', 'explain'])
const normalizedUpdateIntents = /^(publish|cancel|approve|reject|enable|disable|reset|update_.+)$/i
for (const [resourceIndex, resource] of resources.entries()) {
  const resourceCode = String(resource?.code || '').trim()
  if (!resourceCode) fail('RESOURCE_CODE_REQUIRED', `resources[${resourceIndex}].code is required`)
  if (resourceCodes.has(resourceCode)) fail('RESOURCE_CODE_DUPLICATE', `resource code ${resourceCode} is duplicated`)
  resourceCodes.add(resourceCode)

  for (const [permissionIndex, permission] of asArray(resource?.permissions, `resources[${resourceIndex}].permissions`).entries()) {
    const code = String(permission?.code || '').trim()
    const action = String(permission?.action || '').trim()
    const path = `resources[${resourceIndex}].permissions[${permissionIndex}]`
    const segments = code.split(':').filter(Boolean)
    if (segments.length !== 3) fail('PERMISSION_CODE_FORMAT', `${path}.code must use domain:resource:action`)
    if (segments.length === 3 && `${segments[0]}:${segments[1]}` !== resourceCode) {
      fail('PERMISSION_RESOURCE_MISMATCH', `${code} must belong to parent resource ${resourceCode}`)
    }
    if (permissionCodes.has(code)) fail('PERMISSION_CODE_DUPLICATE', `permission code ${code} is duplicated`)
    permissionCodes.add(code)
    if (!action) fail('PERMISSION_ACTION_REQUIRED', `${path}.action is required`)
    if (action && !allowedActions.has(action)) fail('PERMISSION_ACTION_UNNORMALIZED', `${code} uses unsupported action classification ${action}`)
    if (!/^L[1-4]$/.test(String(permission?.riskLevel || ''))) fail('PERMISSION_RISK_LEVEL', `${code} must declare riskLevel L1-L4`)
    if (typeof permission?.approvalRequired !== 'boolean') fail('PERMISSION_APPROVAL_REQUIRED', `${code} must declare boolean approvalRequired`)
    const intent = segments[2] || ''
    if (intent === 'export' && action !== 'view') fail('PERMISSION_ACTION_NORMALIZATION', `${code} must use action view`)
    if (normalizedUpdateIntents.test(intent) && action !== 'update') {
      fail('PERMISSION_ACTION_NORMALIZATION', `${code} must use action update`)
    }
  }
}

const collectSourceFiles = async (directoryUrl, extensions) => {
  const files = []
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directoryUrl)
    if (entry.isDirectory()) files.push(...await collectSourceFiles(entryUrl, extensions))
    else if (extensions.some((extension) => entry.name.endsWith(extension))) files.push(entryUrl)
  }
  return files
}

const referencedPermissionCodes = new Map()
for (const [directory, extensions] of [
  [new URL('src/', projectRoot), ['.ts', '.vue']],
  [new URL('backend/src/main/java/', projectRoot), ['.java']],
]) {
  for (const fileUrl of await collectSourceFiles(directory, extensions)) {
    const source = await readFile(fileUrl, 'utf8')
    const relativePath = decodeURIComponent(fileUrl.pathname).split(`${decodeURIComponent(projectRoot.pathname)}`).pop()
    for (const match of source.matchAll(/["']((?:asset|authz):[A-Za-z0-9_]+:[A-Za-z0-9_]+)["']/g)) {
      const references = referencedPermissionCodes.get(match[1]) || new Set()
      references.add(relativePath)
      referencedPermissionCodes.set(match[1], references)
    }
  }
}
for (const [code, references] of referencedPermissionCodes) {
  if (!permissionCodes.has(code)) {
    fail('SOURCE_PERMISSION_UNKNOWN', `${code} is referenced by ${[...references].join(', ')} but missing from permissions.yaml`)
  }
}

const featureCodes = new Set()
for (const [index, feature] of features.entries()) {
  const code = String(feature?.code || '').trim()
  if (!code) fail('FEATURE_CODE_REQUIRED', `features[${index}].code is required`)
  if (featureCodes.has(code)) fail('FEATURE_CODE_DUPLICATE', `feature code ${code} is duplicated`)
  featureCodes.add(code)
  for (const permissionCode of asArray(feature?.permissions, `features[${index}].permissions`)) {
    if (!permissionCodes.has(permissionCode)) fail('FEATURE_PERMISSION_UNKNOWN', `${code} references unknown permission ${permissionCode}`)
  }
}

const menuIds = new Set()
const pageKeys = new Set()
for (const [index, menu] of menus.entries()) {
  const id = String(menu?.id || '').trim()
  const pageKey = String(menu?.pageKey || '').trim()
  const path = String(menu?.path || '').trim()
  if (!id) fail('MENU_ID_REQUIRED', `menus[${index}].id is required`)
  if (menuIds.has(id)) fail('MENU_ID_DUPLICATE', `menu id ${id} is duplicated`)
  menuIds.add(id)
  if (!pageKey) fail('MENU_PAGE_KEY_REQUIRED', `menus[${index}].pageKey is required`)
  if (pageKeys.has(pageKey)) fail('MENU_PAGE_KEY_DUPLICATE', `menu pageKey ${pageKey} is duplicated`)
  pageKeys.add(pageKey)
  if (!path.startsWith('/')) fail('MENU_PATH_REQUIRED', `${id || `menus[${index}]`} must declare an absolute path`)
  if (menu?.permissionMode && !['ANY', 'ALL'].includes(menu.permissionMode)) {
    fail('MENU_PERMISSION_MODE', `${id} uses unsupported permissionMode ${menu.permissionMode}`)
  }
  for (const permissionCode of menu?.permissionCodes || []) {
    if (!permissionCodes.has(permissionCode)) fail('MENU_PERMISSION_UNKNOWN', `${id} references unknown permission ${permissionCode}`)
  }
  for (const featureCode of menu?.featureCodes || []) {
    if (!featureCodes.has(featureCode)) fail('MENU_FEATURE_UNKNOWN', `${id} references unknown feature ${featureCode}`)
  }
  if (pageKey === 'authz.workspace' && menu.file) fail('WORKSPACE_FILE_FORBIDDEN', 'authz.workspace must use the SDK page and cannot declare file')
  if (pageKey !== 'authz.workspace') {
    if (!menu.file) {
      fail('MENU_FILE_REQUIRED', `${id} must declare a local Vue file`)
    } else {
      try {
        await access(new URL(`.${menu.file}`, projectRoot))
      } catch {
        fail('MENU_FILE_MISSING', `${id} references missing file ${menu.file}`)
      }
    }
  }
}

for (const menu of menus) {
  const id = String(menu?.id || '').trim()
  const parentId = String(menu?.parentId || '').trim()
  if (parentId && !menuIds.has(parentId)) fail('MENU_PARENT_UNKNOWN', `${id} references unknown parentId ${parentId}`)
  if (parentId && parentId === id) fail('MENU_PARENT_SELF', `${id} cannot be its own parent`)

  const visited = new Set([id])
  let currentParentId = parentId
  while (currentParentId) {
    if (visited.has(currentParentId)) {
      fail('MENU_PARENT_CYCLE', `${id} participates in a parentId cycle`)
      break
    }
    visited.add(currentParentId)
    const parent = menus.find((item) => String(item?.id || '').trim() === currentParentId)
    currentParentId = String(parent?.parentId || '').trim()
  }
}

const roleCodes = new Set()
for (const [index, role] of roles.entries()) {
  const code = String(role?.code || '').trim()
  if (!code) fail('ROLE_CODE_REQUIRED', `roles[${index}].code is required`)
  if (roleCodes.has(code)) fail('ROLE_CODE_DUPLICATE', `role code ${code} is duplicated`)
  roleCodes.add(code)
  for (const forbiddenKey of ['authorings', 'hiddenRole', 'profileSelections']) {
    if (forbiddenKey in (role || {})) fail('ROLE_PRIVATE_FIELD', `${code} cannot declare ${forbiddenKey}`)
  }
  for (const permissionCode of asArray(role?.permissions, `roles[${index}].permissions`)) {
    if (!permissionCodes.has(permissionCode)) fail('ROLE_PERMISSION_UNKNOWN', `${code} references unknown permission ${permissionCode}`)
  }
  for (const featureCode of asArray(role?.features, `roles[${index}].features`)) {
    if (!featureCodes.has(featureCode)) fail('ROLE_FEATURE_UNKNOWN', `${code} references unknown feature ${featureCode}`)
  }
}

if (!String(workspace.mountPath || '').startsWith('/')) fail('WORKSPACE_MOUNT_PATH', 'workspace.mountPath must be an absolute path')
if (!String(workspace.noPermissionPath || '').startsWith('/')) fail('WORKSPACE_NO_PERMISSION_PATH', 'workspace.noPermissionPath must be an absolute path')
if (!menus.some((menu) => menu.pageKey === 'authz.workspace' && menu.path === workspace.mountPath)) {
  fail('WORKSPACE_MENU_MISSING', 'menus.yaml must expose authz.workspace at workspace.mountPath')
}
if (!roles.some((role) => role.code === 'APP_ADMIN' && permissionCodes.size === new Set(role.permissions || []).size)) {
  warn('APP_ADMIN_REVIEW', 'APP_ADMIN does not contain every declared permission')
}

for (const issue of [...warnings, ...errors]) {
  console.log(`[${errors.includes(issue) ? 'ERROR' : 'WARN'}] ${issue.code}: ${issue.message}`)
}

if (errors.length > 0) {
  process.exitCode = 1
} else {
  console.log(`authz bundle validation passed (${resources.length} resources, ${permissionCodes.size} permissions, ${features.length} features, ${menus.length} menus, ${roles.length} roles)`)
}
