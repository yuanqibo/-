const resourceNames: Record<string, string> = {
  'asset:employee': '员工信息',
  'asset:department': '组织架构',
  'asset:item': '资产',
  'asset:inbound': '资产入库',
  'asset:receive_return': '领用退库',
  'asset:borrow_return': '借用归还',
  'asset:request': '审批申请',
  'asset:stocktake': '资产盘点',
  'asset:consumable': '耗材库存',
  'asset:repair': '故障维修',
  'asset:contract': '合同供应商',
  'asset:location_settings': '位置管理',
  'asset:category_settings': '资产分类',
  'asset:code_rules': '资产编码规则',
  'asset:label_template_settings': '标签模板设置',
  'asset:self_service': '员工自助',
  'asset:integration': '系统对接',
  'asset:form': '表单管理',
  'authz:application': '应用信息',
  'authz:model': '权限模型',
  'authz:app_role': '角色与授权'
}

const exactPermissionNames: Record<string, string> = {
  'asset:item:receive': '领用资产',
  'asset:item:return': '退库资产',
  'asset:item:borrow': '借用资产',
  'asset:item:borrowReturn': '归还借用资产',
  'asset:item:handover': '交接资产',
  'asset:item:copy': '复制资产',
  'asset:item:batchUpdate': '批量编辑资产',
  'asset:item:assetImport': '导入新增资产',
  'asset:item:updateImport': '导入更新资产',
  'asset:item:receiveImport': '导入领用资产',
  'asset:item:printLabel': '打印资产标签',
  'asset:item:advancedSearch': '资产高级搜索',
  'asset:item:columnSettings': '资产列设置',
  'asset:inbound:cancel': '取消资产入库',
  'asset:inbound:printOrder': '打印入库单',
  'asset:inbound:printLabel': '打印入库标签',
  'asset:receive_return:receive': '领用资产',
  'asset:receive_return:return': '资产退库',
  'asset:receive_return:handover': '交接资产',
  'asset:receive_return:sign': '领用退库签字',
  'asset:receive_return:cancel': '取消领用退库',
  'asset:borrow_return:borrow': '借用资产',
  'asset:borrow_return:return': '归还资产',
  'asset:borrow_return:extend': '借用延期',
  'asset:request:review': '审批申请',
  'asset:consumable:adjust': '调整耗材库存',
  'asset:location_settings:toggleCode': '切换位置编码',
  'asset:category_settings:toggleCode': '切换分类编码',
  'asset:location_settings:template': '下载位置模板',
  'asset:category_settings:template': '下载分类模板',
  'asset:label_template_settings:save': '保存标签模板',
  'asset:label_template_settings:reset': '重置标签模板',
  'authz:app_role:assign': '分配角色',
  'authz:app_role:explain': '查询权限原因'
}

const actionNames: Record<string, string> = {
  view: '查看',
  create: '新增',
  update: '编辑',
  delete: '删除',
  import: '导入',
  export: '导出',
  print: '打印',
  sync: '同步'
}

export const formatPermissionDisplayName = (code: string, resourceName?: string): string => {
  const normalizedCode = String(code || '').trim()
  if (!normalizedCode) return ''
  if (exactPermissionNames[normalizedCode]) return exactPermissionNames[normalizedCode]

  const segments = normalizedCode.split(':')
  if (segments.length < 3) return normalizedCode
  const action = segments.pop() || ''
  const resourceCode = segments.join(':')
  const resolvedResourceName = String(resourceName || resourceNames[resourceCode] || '').trim()
  const actionName = actionNames[action]
  return actionName && resolvedResourceName ? `${actionName}${resolvedResourceName}` : normalizedCode
}
