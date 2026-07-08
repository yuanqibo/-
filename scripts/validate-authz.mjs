import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBundleFromGlob } from '../node_modules/@acg/ecp-auth-vue/dist/bundle-loader.js'
import { validateAuthzBundle } from '../node_modules/@acg/ecp-auth-vue/dist/bundle-validator.js'

const projectRoot = new URL('..', import.meta.url)
const authzDir = new URL('authz/', projectRoot)
const globResult = {}

for (const fileName of await readdir(authzDir)) {
  if (!/\.(ya?ml|json)$/i.test(fileName)) continue
  const filePath = join(authzDir.pathname, fileName)
  globResult[`../authz/${fileName}`] = await readFile(filePath, 'utf8')
}

globResult['/src/views/LegacyPortalView.vue'] = () => null

const bundle = createBundleFromGlob(globResult)
const report = validateAuthzBundle(bundle)

for (const issue of report.issues) {
  const prefix = issue.level === 'error' ? 'ERROR' : 'WARN'
  const location = issue.path ? ` ${issue.path}` : ''
  console.log(`[${prefix}] ${issue.code}${location}: ${issue.message}`)
}

if (!report.ok) {
  process.exitCode = 1
} else {
  console.log('authz bundle validation passed')
}
