const roleMeta = {
  super_admin: {
    name: "超级管理员",
    policy: "手机号注册",
    scope: "系统初始化、管理员分配、全量资产与系统配置",
    tone: "green",
  },
  admin: {
    name: "普通管理员",
    policy: "超管分配",
    scope: "资产台账、员工信息、审批处理和盘点执行",
    tone: "blue",
  },
  employee: {
    name: "普通员工",
    policy: "管理员添加",
    scope: "本人资产、个人申请和审批状态",
    tone: "amber",
  },
};

const roleDefinitionsStorageKey = "assetPortalRoleDefinitionsV3";
const selfServiceSettingsStorageKey = "assetPortalSelfServiceSettingsV9";
const assetCodeRuleStorageKey = "assetPortalAssetCodeRuleSettingsV1";
const deletedRoleUsersStorageKey = "assetPortalDeletedRoleUsersV1";
const sharedStoreKeys = [
  "assetPortalAssets",
  "assetLabelPrintSettingsV2",
  "assetLabelCustomTemplatesV1",
  "assetPortalRegisteredUsers",
  roleDefinitionsStorageKey,
  deletedRoleUsersStorageKey,
  "assetCategoryTree",
  "assetCategoryTreeVersion",
  "assetLocationTree",
  assetCodeRuleStorageKey,
  selfServiceSettingsStorageKey,
];
let sharedStoreReady = false;
let sharedStoreLoaded = false;
let sharedStoreServerKeys = new Set();
let sharedStoreServerValues = {};
const selfServiceNoticeContentLimit = 500;

function isSharedStoreKey(key) {
  return sharedStoreKeys.includes(key);
}

async function loadSharedStore() {
  try {
    const response = await fetch("/api/store", { cache: "no-store" });
    if (!response.ok) return false;
    const data = await response.json();
    const values = data.values && typeof data.values === "object" ? data.values : {};
    sharedStoreServerValues = values;
    sharedStoreServerKeys = new Set(Object.keys(values).filter(isSharedStoreKey));
    Object.entries(values).forEach(([key, value]) => {
      if (!isSharedStoreKey(key)) return;
      if (value === undefined) return;
      if (key === "assetPortalAssets" && Array.isArray(value) && value.length === 0) {
        try {
          const localAssets = JSON.parse(localStorage.getItem(key) || "[]");
          if (Array.isArray(localAssets) && localAssets.length) return;
        } catch {
          // Ignore malformed local cache and use server value.
        }
      }
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    });
    sharedStoreReady = true;
    sharedStoreLoaded = true;
    return true;
  } catch (error) {
    console.warn("[asset-portal] shared store unavailable", error);
    return false;
  }
}

function saveSharedStoreItem(key, value) {
  if (!isSharedStoreKey(key) || !sharedStoreLoaded) return;
  fetch("/api/store", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ key, value }),
  }).catch((error) => console.warn("[asset-portal] shared store save failed", key, error));
}

function saveSharedLocalStorage(key, value) {
  localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  saveSharedStoreItem(key, value);
}

function seedSharedStoreFromLocalStorage() {
  if (!sharedStoreReady || !sharedStoreLoaded) return;
  const items = {};
  sharedStoreKeys.forEach((key) => {
    const rawValue = localStorage.getItem(key);
    if (rawValue === null) return;
    const serverValue = sharedStoreServerValues[key];
    try {
      const value = JSON.parse(rawValue);
      if (key === "assetPortalAssets") {
        if (!Array.isArray(value) || !value.length) return;
        if (!sharedStoreServerKeys.has(key) || (Array.isArray(serverValue) && serverValue.length === 0)) {
          items[key] = value;
        }
        return;
      }
      if (sharedStoreServerKeys.has(key)) return;
      items[key] = value;
    } catch {
      if (sharedStoreServerKeys.has(key)) return;
      items[key] = rawValue;
    }
  });
  if (!Object.keys(items).length) return;
  fetch("/api/store", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ items }),
  }).catch((error) => console.warn("[asset-portal] shared store seed failed", error));
}

async function forceUploadLocalSharedStore() {
  const items = {};
  sharedStoreKeys.forEach((key) => {
    const rawValue = localStorage.getItem(key);
    if (rawValue === null) return;
    try {
      items[key] = JSON.parse(rawValue);
    } catch {
      items[key] = rawValue;
    }
  });
  if (!Object.keys(items).length) return false;
  const response = await fetch("/api/store", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ items }),
  });
  return response.ok;
}

window.assetPortalSyncLocalData = forceUploadLocalSharedStore;

function reloadAssetLabelCustomTemplatesFromStorage() {
  for (let index = assetLabelTemplates.length - 1; index >= 0; index -= 1) {
    if (assetLabelTemplates[index].custom) assetLabelTemplates.splice(index, 1);
  }
  assetLabelTemplates.push(...loadAssetLabelCustomTemplates());
}

function applySharedStoreState() {
  if (!sharedStoreLoaded || typeof state === "undefined") return;
  assetLocationTree = loadAssetLocationTree();
  assetLocationOptions = buildAssetLocationOptions(assetLocationTree);
  assetCategoryTree = loadAssetCategoryTree();
  reloadAssetLabelCustomTemplatesFromStorage();
  state.deletedRoleUserAccounts = loadDeletedRoleUsers();
  state.users = loadUsers();
  state.roles = loadRoleDefinitions();
  state.assetCodeRuleSettings = loadAssetCodeRuleSettings();
  state.assetLabelSettings = loadAssetLabelSettings();
  state.selfServiceSettings = loadSelfServiceSettings();
  state.assets = loadSavedAssets();
  state.selectedAssetIds = state.selectedAssetIds.filter((id) => state.assets.some((asset) => asset.id === id));
}

const rolePermissionModules = [
  { code: "employee", name: "员工信息", actions: [["view", "查看"], ["create", "新增"], ["update", "编辑"], ["delete", "删除"]] },
  { code: "department", name: "组织架构", actions: [["view", "查看"], ["create", "新增"], ["update", "编辑"], ["delete", "删除"]] },
  { code: "role", name: "角色管理", actions: [["view", "查看"], ["create", "新增"], ["update", "编辑"], ["delete", "删除"]] },
  { code: "asset", name: "资产管理", actions: [["view", "查看"], ["create", "新增"], ["update", "编辑"], ["delete", "删除"], ["export", "导出"]] },
  { code: "request", name: "审批申请", actions: [["view", "查看"], ["review", "审批"], ["export", "导出"]] },
  { code: "stocktake", name: "盘点任务", actions: [["view", "查看"], ["create", "新增"], ["update", "编辑"], ["review", "复核"]] },
  { code: "consumable", name: "耗材库存", actions: [["view", "查看"], ["create", "新增"], ["update", "编辑"], ["delete", "删除"]] },
  { code: "selfService", name: "员工自助", actions: [["view", "查看"], ["update", "配置"]] },
  { code: "integration", name: "系统对接", actions: [["view", "查看"], ["create", "新增"], ["update", "编辑"], ["sync", "同步"]] },
  { code: "form", name: "表单管理", actions: [["view", "查看"], ["create", "新增"], ["update", "编辑"], ["delete", "删除"]] },
];

function allRolePermissionCodes() {
  return rolePermissionModules.flatMap((module) => module.actions.map(([action]) => `${module.code}:${action}`));
}

function defaultRoleDefinitions() {
  const allPermissions = allRolePermissionCodes();
  return [
    {
      id: "super_admin",
      name: "超级管理员",
      type: "super_admin",
      builtIn: true,
      description: "系统初始化、管理员分配、全量资产与系统配置。",
      permissions: allPermissions,
    },
    {
      id: "admin",
      name: "普通管理员",
      type: "admin",
      builtIn: true,
      description: "由超级管理员分配，可处理资产台账、员工信息、审批和盘点。",
      permissions: allPermissions.filter((code) => code !== "role:delete"),
    },
    {
      id: "employee",
      name: "普通员工",
      type: "employee",
      builtIn: true,
      description: "管理员添加员工信息后使用，仅查看本人资产和申请状态。",
      permissions: ["asset:view", "request:view", "selfService:view"],
    },
  ];
}

const terminalMeta = {
  web_pc: {
    label: "网页PC端",
    shortLabel: "PC",
    icon: "▣",
    note: "适合资产台账、审批配置和批量管理。",
  },
  ios_app: {
    label: "iOS APP",
    shortLabel: "iOS",
    icon: "◌",
    note: "适合移动扫码、现场盘点和员工自助。",
  },
  android_app: {
    label: "Android APP",
    shortLabel: "Android",
    icon: "◍",
    note: "适合移动扫码、现场盘点和员工自助。",
  },
};

const assetCategoryOptions = ["终端设备", "基础设施", "办公外设", "网络设备", "软件与许可", "耗材", "其他"];
const assetCategoryTreeStorageVersion = "20260617-reference-category-v1";
const defaultAssetCategoryTree = [
  {
    id: "cat-it",
    code: "01",
    name: "IT设备",
    usefulLife: "0",
    unit: "台",
    enabled: true,
    children: [
      { id: "cat-laptop", code: "0101", name: "笔记本电脑", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-desktop", code: "0102", name: "台式主机", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-imac", code: "0103", name: "苹果一体机", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-digitizer", code: "0104", name: "数位板", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-display", code: "0105", name: "显示器", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-server", code: "0106", name: "服务器", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-cloud", code: "0107", name: "云主机", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-network", code: "0108", name: "网络设备", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-workstation", code: "0109", name: "苹果工作站", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-collector", code: "0110", name: "数据采集器", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-ssd", code: "0111", name: "固态硬盘", usefulLife: "0", unit: "块", enabled: true, children: [] },
      { id: "cat-video", code: "0505", name: "视讯设备", usefulLife: "0", unit: "台", enabled: true, children: [] },
    ],
  },
  {
    id: "cat-rent",
    code: "02",
    name: "租赁设备",
    usefulLife: "",
    unit: "",
    enabled: true,
    children: [{ id: "cat-rent-laptop", code: "0201", name: "租赁笔记本", usefulLife: "", unit: "", enabled: true, children: [] }],
  },
  {
    id: "cat-mobile",
    code: "03",
    name: "移动设备",
    usefulLife: "0",
    unit: "个",
    enabled: true,
    children: [
      { id: "cat-tablet", code: "0302", name: "平板", usefulLife: "", unit: "", enabled: true, children: [] },
      {
        id: "cat-phone",
        code: "0303",
        name: "手机",
        usefulLife: "0",
        unit: "台",
        enabled: true,
        children: [
          { id: "cat-android-phone", code: "030301", name: "安卓手机", usefulLife: "0", unit: "台", enabled: true, children: [] },
          { id: "cat-iphone", code: "030303", name: "苹果手机", usefulLife: "0", unit: "台", enabled: true, children: [] },
        ],
      },
    ],
  },
  {
    id: "cat-software",
    code: "04",
    name: "软件权限",
    usefulLife: "0",
    unit: "套",
    enabled: true,
    children: [
      { id: "cat-office-license", code: "0401", name: "办公软件", usefulLife: "0", unit: "套", enabled: true, children: [] },
      { id: "cat-design-license", code: "0402", name: "设计软件", usefulLife: "0", unit: "套", enabled: true, children: [] },
      { id: "cat-dev-license", code: "0403", name: "研发工具", usefulLife: "0", unit: "套", enabled: true, children: [] },
      { id: "cat-security-license", code: "0404", name: "安全软件", usefulLife: "0", unit: "套", enabled: true, children: [] },
    ],
  },
  {
    id: "cat-supply",
    code: "05",
    name: "供应链设备",
    usefulLife: "0",
    unit: "台",
    enabled: true,
    children: [
      { id: "cat-printer", code: "0501", name: "打印机", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-scanner", code: "0502", name: "扫描仪", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-barcode", code: "0503", name: "条码设备", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-label", code: "0504", name: "标签设备", usefulLife: "0", unit: "台", enabled: true, children: [] },
    ],
  },
  {
    id: "cat-camera",
    code: "06",
    name: "摄影摄像直播设备",
    usefulLife: "0",
    unit: "台",
    enabled: true,
    children: [
      { id: "cat-camera-body", code: "0601", name: "相机机身", usefulLife: "0", unit: "台", enabled: true, children: [] },
      { id: "cat-lens", code: "0602", name: "镜头", usefulLife: "0", unit: "个", enabled: true, children: [] },
      { id: "cat-light", code: "0603", name: "灯光设备", usefulLife: "0", unit: "台", enabled: true, children: [] },
    ],
  },
  {
    id: "cat-archive",
    code: "07",
    name: "封存资产",
    usefulLife: "",
    unit: "件",
    enabled: true,
    children: [],
  },
  {
    id: "cat-admin",
    code: "08",
    name: "行政资产",
    usefulLife: "0",
    unit: "件",
    enabled: true,
    children: [],
  },
];
const defaultAssetLocationTree = [
  {
    id: "loc-hangzhou",
    name: "杭州公司",
    code: "access",
    enabled: true,
    children: [
      { id: "loc-archive", name: "封存仓库", code: "FC", enabled: false, children: [] },
      { id: "loc-19-1", name: "19幢1楼", code: "19-1", enabled: true, children: [] },
      { id: "loc-19-2", name: "19幢2楼", code: "19-2", enabled: true, children: [] },
      { id: "loc-19-3", name: "19幢3楼", code: "19-3", enabled: true, children: [] },
      { id: "loc-19-4", name: "19幢4楼", code: "19-4", enabled: true, children: [] },
      { id: "loc-19-5", name: "19幢5楼", code: "19-5", enabled: true, children: [] },
      { id: "loc-19-6", name: "19幢6楼", code: "19-6", enabled: true, children: [] },
      { id: "loc-11-6", name: "11幢6楼", code: "11-6", enabled: true, children: [] },
      { id: "loc-lhtj", name: "下沙龙湖天街", code: "LHTJ", enabled: true, children: [] },
    ],
  },
  { id: "loc-ningbo", name: "宁波仓库", code: "CK", enabled: true, children: [] },
  {
    id: "loc-sea",
    name: "东南亚",
    code: "NTX",
    enabled: true,
    children: [
      { id: "loc-malaysia", name: "马来西亚", code: "0-1", enabled: true, children: [] },
      { id: "loc-singapore", name: "新加坡", code: "0-2", enabled: true, children: [] },
    ],
  },
];
let assetLocationTree = loadAssetLocationTree();
let assetLocationOptions = buildAssetLocationOptions(assetLocationTree);
saveAssetLocationTree();
let assetCategoryTree = loadAssetCategoryTree();
saveAssetCategoryTree();
const defaultCompanyOptions = ["默认公司"];
const defaultDepartmentOptions = ["默认部门"];
const assetConditionOptions = ["正常", "全新", "良好", "维修中", "待验收"];
const purchaseMethodOptions = ["采购", "租赁", "自购", "调拨入库"];
const workflowStatusOptions = ["待提交", "审批中", "审批通过", "审批驳回", "待确认", "执行中", "部分完成", "已完成", "已取消", "已撤销", "待签字"];

function defaultAdvancedAssetFilters() {
  return {
    status: "全部",
    id: "",
    name: "",
    category: "全部",
    type: "全部",
    model: "",
    sn: "",
    owner: "",
    department: "全部",
    location: "",
    supplier: "",
    risk: "全部",
    tag: "全部",
  };
}

function defaultAdvancedInboundFilters() {
  return {
    status: "",
    id: "",
    type: "",
    dateStart: "",
    dateEnd: "",
    operator: "",
    purchaser: "",
    company: "",
  };
}

function defaultAdvancedReceiveReturnFilters() {
  return {
    status: "",
    id: "",
    dateStart: "",
    dateEnd: "",
    handler: "",
    receiver: "",
    company: "",
    department: "",
    location: "",
    note: "",
    assetId: "",
    assetName: "",
    brand: "",
    model: "",
    sn: "",
    owner: "",
    manager: "",
    ownerCompany: "",
  };
}

function defaultAdvancedBorrowReturnFilters() {
  return {
    status: "",
    id: "",
    handler: "",
    borrower: "",
    borrowDateStart: "",
    borrowDateEnd: "",
    expectedReturnDateStart: "",
    expectedReturnDateEnd: "",
    assetId: "",
    sn: "",
    company: "",
    department: "",
    employeeCode: "",
    phone: "",
    email: "",
    location: "",
  };
}

function loadSavedAdvancedAssetFilters() {
  try {
    return JSON.parse(localStorage.getItem("assetAdvancedFilters") || "null");
  } catch {
    return null;
  }
}

function loadRegisteredUsers() {
  try {
    return JSON.parse(localStorage.getItem("assetPortalRegisteredUsers") || "[]");
  } catch {
    return [];
  }
}

function loadDeletedRoleUsers() {
  try {
    return JSON.parse(localStorage.getItem(deletedRoleUsersStorageKey) || "[]");
  } catch {
    return [];
  }
}

function saveRegisteredUsers() {
  const registered = state.users.filter((user) => ["本地注册", "角色管理新增"].includes(user.identitySource));
  saveSharedLocalStorage("assetPortalRegisteredUsers", registered);
}

function saveDeletedRoleUsers() {
  saveSharedLocalStorage(deletedRoleUsersStorageKey, state.deletedRoleUserAccounts || []);
}

function normalizeRoleDefinition(role = {}) {
  const allPermissions = new Set(allRolePermissionCodes());
  const id = String(role.id || `role-${Date.now().toString(36)}`).trim();
  const type = role.type === "super_admin" || role.type === "employee" ? role.type : "admin";
  return {
    id,
    name: String(role.name || role.roleName || "普通管理员").trim(),
    type,
    builtIn: Boolean(role.builtIn),
    description: String(role.description || "").trim(),
    permissions: Array.from(new Set(role.permissions || [])).filter((permission) => allPermissions.has(permission)),
  };
}

function loadRoleDefinitions() {
  try {
    const saved = JSON.parse(localStorage.getItem(roleDefinitionsStorageKey) || "null");
    if (Array.isArray(saved) && saved.length) {
      const builtinIds = new Set(defaultRoleDefinitions().map((role) => role.id));
      const merged = [...defaultRoleDefinitions(), ...saved.filter((role) => !builtinIds.has(role.id))];
      return merged.map(normalizeRoleDefinition);
    }
  } catch {
    // fall back to defaults
  }
  return defaultRoleDefinitions().map(normalizeRoleDefinition);
}

function saveRoleDefinitions() {
  saveSharedLocalStorage(roleDefinitionsStorageKey, state.roles.filter((role) => !role.builtIn));
}

function createRoleId() {
  return `role-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createUserIdFragment(value = "admin") {
  return String(value || "admin")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 24) || "admin";
}

function createLocationId() {
  return `loc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createAssetCategoryId() {
  return `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cloneAssetCategoryTree(tree = defaultAssetCategoryTree) {
  return tree.map((node) => ({
    id: node.id || createAssetCategoryId(),
    code: String(node.code || "").trim(),
    name: String(node.name || node.label || "").trim(),
    usefulLife: String(node.usefulLife ?? "0").trim(),
    unit: String(node.unit || "").trim(),
    enabled: node.enabled !== false,
    children: cloneAssetCategoryTree(node.children || []).filter((child) => child.name),
  }));
}

function normalizeAssetCategoryTree(tree = defaultAssetCategoryTree) {
  const normalized = cloneAssetCategoryTree(Array.isArray(tree) && tree.length ? tree : defaultAssetCategoryTree).filter((node) => node.name);
  return normalized.length ? normalized : cloneAssetCategoryTree(defaultAssetCategoryTree);
}

function loadAssetCategoryTree() {
  try {
    if (localStorage.getItem("assetCategoryTreeVersion") !== assetCategoryTreeStorageVersion) {
      return normalizeAssetCategoryTree(defaultAssetCategoryTree);
    }
    return normalizeAssetCategoryTree(JSON.parse(localStorage.getItem("assetCategoryTree") || "null"));
  } catch {
    return normalizeAssetCategoryTree(defaultAssetCategoryTree);
  }
}

function saveAssetCategoryTree() {
  saveSharedLocalStorage("assetCategoryTree", assetCategoryTree);
  saveSharedLocalStorage("assetCategoryTreeVersion", assetCategoryTreeStorageVersion);
}

function flattenAssetCategoryTree(tree = assetCategoryTree, parent = null, parentPath = []) {
  return tree.flatMap((node, index) => {
    const pathParts = [...parentPath, node.name];
    const row = {
      ...node,
      parentId: parent?.id || "",
      parentName: parent?.name || "",
      path: pathParts.join(" / "),
      level: parentPath.length,
      index,
    };
    return [row, ...flattenAssetCategoryTree(node.children || [], node, pathParts)];
  });
}

function findAssetCategoryNodeById(id, tree = assetCategoryTree, parent = null) {
  for (const node of tree) {
    if (node.id === id) return { node, parent, siblings: tree };
    const found = findAssetCategoryNodeById(id, node.children || [], node);
    if (found) return found;
  }
  return null;
}

function findAssetCategoryNodeByName(name) {
  const target = String(name || "").trim();
  if (!target) return null;
  return flattenAssetCategoryTree().find((node) => node.name === target) || null;
}

function assetCategoryCodeForName(name) {
  const category = findAssetCategoryNodeByName(name);
  return category?.enabled === false ? "" : category?.code || "";
}

function assetCategoryDefaultsForName(name) {
  const category = findAssetCategoryNodeByName(name);
  return {
    code: category?.enabled === false ? "" : category?.code || "",
    unit: category?.unit || "",
    usefulLife: category?.usefulLife || "",
  };
}

const assetCodeRuleFieldDefinitions = [
  { key: "companyCode", label: "公司编码", width: 4 },
  { key: "purchaseDate", label: "购置/起租日期", width: 8 },
  { key: "customText", label: "自定义文本", width: 0, help: true },
  { key: "locationCode", label: "位置编码", width: 4 },
  { key: "departmentCode", label: "部门编码", width: 4 },
  { key: "categoryCode", label: "资产分类编号", width: 6 },
];

const assetCodeRuleDateFormats = [
  { value: "yyyymmdd", label: "yyyymmdd(例:20190801)", width: 8 },
  { value: "yyyymm", label: "yyyymm(例:201908)", width: 6 },
  { value: "yymmdd", label: "yymmdd(例:190801)", width: 6 },
  { value: "yymm", label: "yymm(例:1908)", width: 4 },
];

function defaultAssetCodeRuleSettings() {
  return {
    selectedFields: ["categoryCode"],
    serialLength: 5,
    fieldOptions: {
      categoryCode: "none",
    },
    customTexts: {
      customText: "",
    },
    dateFormats: {
      purchaseDate: "yyyymmdd",
    },
  };
}

function normalizeAssetCodeRuleSettings(settings = {}) {
  const knownFields = new Set(assetCodeRuleFieldDefinitions.map((field) => field.key));
  const selectedFields = Array.from(new Set(Array.isArray(settings.selectedFields) ? settings.selectedFields : []))
    .filter((field) => knownFields.has(field));
  const defaults = defaultAssetCodeRuleSettings();
  const fieldOptions = {
    ...defaults.fieldOptions,
    ...(settings.fieldOptions || {}),
  };
  const customTexts = {
    ...defaults.customTexts,
    ...(settings.customTexts || {}),
  };
  const validDateFormats = new Set(assetCodeRuleDateFormats.map((format) => format.value));
  const dateFormats = {
    ...defaults.dateFormats,
    ...(settings.dateFormats || {}),
  };
  Object.keys(dateFormats).forEach((key) => {
    if (!validDateFormats.has(dateFormats[key])) dateFormats[key] = defaults.dateFormats[key] || assetCodeRuleDateFormats[0].value;
  });
  return {
    selectedFields: selectedFields.length ? selectedFields : defaults.selectedFields,
    serialLength: Math.round(clampNumber(settings.serialLength, defaults.serialLength, 3, 7)),
    fieldOptions,
    customTexts,
    dateFormats,
  };
}

function loadAssetCodeRuleSettings() {
  try {
    return normalizeAssetCodeRuleSettings(JSON.parse(localStorage.getItem(assetCodeRuleStorageKey) || "null") || defaultAssetCodeRuleSettings());
  } catch {
    return defaultAssetCodeRuleSettings();
  }
}

function saveAssetCodeRuleSettings() {
  saveSharedLocalStorage(assetCodeRuleStorageKey, state.assetCodeRuleSettings);
}

function selfServiceCategoryOptions() {
  return flattenAssetCategoryTree()
    .filter((item) => item.enabled !== false)
    .map((item) => item.name)
    .filter(Boolean);
}

function defaultSelfServiceAssetCategories() {
  const options = selfServiceCategoryOptions();
  return options.length ? options : ["IT设备", "笔记本电脑", "台式主机", "显示器"];
}

function normalizeSelfServiceBasicSettings(settings = {}, extraSwitches = []) {
  const normalized = {
    enabled: settings.enabled === undefined ? true : Boolean(settings.enabled),
    remarkRequired: Boolean(settings.remarkRequired),
    remarkPrompt: String(settings.remarkPrompt || "").slice(0, 300),
  };
  extraSwitches.forEach((item) => {
    normalized[item.key] = settings[item.key] === undefined ? Boolean(item.defaultValue) : Boolean(settings[item.key]);
  });
  return normalized;
}

function normalizeSelfServiceAssetRequestSettings(settings = {}) {
  const options = selfServiceCategoryOptions();
  const optionSet = new Set(options);
  const selected = Array.isArray(settings.categories) ? settings.categories : defaultSelfServiceAssetCategories();
  const categories = Array.from(new Set(selected.map((item) => String(item || "").trim()).filter((item) => optionSet.has(item))));
  return {
    ...normalizeSelfServiceBasicSettings(settings),
    categories: categories.length ? categories : defaultSelfServiceAssetCategories(),
  };
}

function selfServiceSignPages() {
  return [
    {
      key: "assetReceive",
      menu: "资产领用",
      items: [
        {
          key: "assetReceive",
          title: "资产领用",
          help: "管理员操作资产领用后，系统会自动生成一个领用单，员工接收时需签字确认为本人领用",
          noticeLabel: "领用须知",
          defaultNoticeContent: "请核对资产名称、编号、配置和附件状态。确认无误后完成签字，系统将记录为本人领用。",
        },
        {
          key: "selfReceiveAsset",
          title: "自助领用资产",
          help: "员工在申请领用资产时，可查阅领用须知",
          noticeLabel: "领用须知",
          defaultNoticeContent: "请确认申请资产用于真实办公需要，并在接收时核对资产信息。领用后请妥善保管，按公司要求使用。",
          defaultNoticeEnabled: false,
          timingOptions: [
            { key: "start", label: "发起时", defaultValue: false },
            { key: "receive", label: "接收时", defaultValue: false },
          ],
        },
        {
          key: "assetHandover",
          title: "资产交接",
          help: "操作资产交接后，系统会自动生成一个领用单，员工接收时需签字确认为本人领用",
          noticeLabel: "交接须知",
          defaultNoticeContent: "交接双方需确认资产状态、配件和使用责任。接收人签字后，资产责任人将同步变更。",
        },
        {
          key: "selfHandoverAsset",
          title: "自助交接资产",
          help: "员工在交接资产时，领用员工可查阅交接须知",
          noticeLabel: "交接须知",
          defaultNoticeContent: "请与接收员工确认资产实物、编号和状态。接收方确认后，系统将完成资产交接记录。",
          defaultNoticeEnabled: false,
          timingOptions: [{ key: "receive", label: "接收时", defaultValue: true, disabled: true }],
        },
      ],
    },
    {
      key: "assetBorrow",
      menu: "资产借用",
      items: [
        {
          key: "assetBorrow",
          title: "资产借用",
          help: "管理员操作资产借用后，系统会自动生成一个借用单，员工接收时需签字确认为本人借用",
          noticeLabel: "借用须知",
          defaultNoticeContent: "请确认借用资产、预计归还日期和使用责任。借用期间请妥善保管，并按时归还。",
        },
        {
          key: "selfBorrowAsset",
          title: "自助借用资产",
          help: "员工在申请借用资产时，可查阅借用须知",
          noticeLabel: "借用须知",
          defaultNoticeContent: "请根据实际办公需要发起借用申请，填写预计归还时间。借用资产仅限本人使用，不得私自转借。",
          defaultNoticeEnabled: false,
          timingOptions: [
            { key: "start", label: "发起时", defaultValue: false },
            { key: "receive", label: "接收时", defaultValue: false },
          ],
        },
        {
          key: "assetGiveBack",
          title: "资产归还",
          help: "管理员操作资产归还后，员工归还时需签字确认",
          noticeLabel: "归还须知",
          defaultNoticeContent: "归还前请清点资产及配件，确认外观和功能状态。管理员确认后，资产将恢复为可用状态。",
        },
        {
          key: "selfGiveBackAsset",
          title: "自助归还资产",
          help: "员工在归还资产时，可查阅归还须知",
          noticeLabel: "归还须知",
          defaultNoticeContent: "请选择本人名下借用资产并确认归还信息。归还前请清理个人数据并交回相关配件。",
          defaultNoticeEnabled: false,
          timingOptions: [{ key: "return", label: "归还时", defaultValue: true, disabled: true }],
        },
      ],
    },
    {
      key: "materialReceive",
      menu: "物料领用",
      items: [
        {
          key: "materialReceive",
          title: "物料领用",
          help: "管理员操作物料领用后，系统会自动生成一个领用单，员工接收时需签字确认为本人领用",
          noticeLabel: "领用须知",
          defaultNoticeContent: "请核对物料名称、规格和数量。确认无误后完成签字，系统将记录本次物料领用。",
        },
        {
          key: "selfMaterialReceive",
          title: "自助领用物料",
          help: "员工在申请领用物料时，可查阅领用须知",
          noticeLabel: "领用须知",
          defaultNoticeContent: "请按实际办公消耗申请物料，确认名称、规格和数量。领取后请合理使用，避免浪费。",
          defaultNoticeEnabled: false,
          timingOptions: [
            { key: "start", label: "发起时", defaultValue: false },
            { key: "receive", label: "领取时", defaultValue: false },
          ],
        },
      ],
    },
  ];
}

function selfServiceSignItemDefinitions() {
  return selfServiceSignPages().flatMap((page) => page.items);
}

function normalizeSelfServiceSignItemSettings(settings = {}, item = {}) {
  const timingOptions = item.timingOptions || [];
  const sourceTimings = settings.timings || {};
  const timings = Object.fromEntries(
    timingOptions.map((option) => [
      option.key,
      option.disabled ? true : sourceTimings[option.key] === undefined ? Boolean(option.defaultValue) : Boolean(sourceTimings[option.key]),
    ])
  );
  return {
    employeeSign: settings.employeeSign === undefined ? true : Boolean(settings.employeeSign),
    noticeEnabled: settings.noticeEnabled === undefined ? Boolean(item.defaultNoticeEnabled) : Boolean(settings.noticeEnabled),
    noticeContent: String(settings.noticeContent ?? item.defaultNoticeContent ?? "").slice(0, selfServiceNoticeContentLimit),
    timings,
  };
}

function defaultSelfServiceSignSettings() {
  return Object.fromEntries(
    selfServiceSignItemDefinitions().map((item) => [item.key, normalizeSelfServiceSignItemSettings({}, item)])
  );
}

function normalizeSelfServiceSignSettings(settings = {}) {
  const defaults = defaultSelfServiceSignSettings();
  return Object.fromEntries(
    selfServiceSignItemDefinitions().map((item) => [
      item.key,
      normalizeSelfServiceSignItemSettings(settings[item.key] || defaults[item.key], item),
    ])
  );
}

function defaultSelfServiceSettings() {
  return {
    receiveAsset: normalizeSelfServiceAssetRequestSettings({
      enabled: true,
      categories: defaultSelfServiceAssetCategories(),
      remarkRequired: false,
      remarkPrompt: "",
    }),
    borrowAsset: normalizeSelfServiceAssetRequestSettings({
      enabled: true,
      categories: defaultSelfServiceAssetCategories(),
      remarkRequired: false,
      remarkPrompt: "",
    }),
    giveBackAsset: normalizeSelfServiceBasicSettings({
      enabled: true,
      remarkRequired: false,
      remarkPrompt: "",
    }),
    handoverAsset: normalizeSelfServiceBasicSettings({
      enabled: true,
      remarkRequired: false,
      remarkPrompt: "",
    }),
    returnAsset: normalizeSelfServiceBasicSettings({
      enabled: true,
      remarkRequired: false,
      remarkPrompt: "",
    }),
    deviceRequest: normalizeSelfServiceBasicSettings(
      {
        enabled: false,
        allowEmployeeAddDevice: true,
        remarkRequired: false,
        remarkPrompt: "",
      },
      [{ key: "allowEmployeeAddDevice", defaultValue: true }]
    ),
    signSettings: defaultSelfServiceSignSettings(),
  };
}

function normalizeSelfServiceSettings(settings = {}) {
  const defaults = defaultSelfServiceSettings();
  return {
    receiveAsset: normalizeSelfServiceAssetRequestSettings(settings.receiveAsset || defaults.receiveAsset),
    borrowAsset: normalizeSelfServiceAssetRequestSettings(settings.borrowAsset || defaults.borrowAsset),
    giveBackAsset: normalizeSelfServiceBasicSettings(settings.giveBackAsset || defaults.giveBackAsset),
    handoverAsset: normalizeSelfServiceBasicSettings(settings.handoverAsset || defaults.handoverAsset),
    returnAsset: normalizeSelfServiceBasicSettings(settings.returnAsset || defaults.returnAsset),
    deviceRequest: normalizeSelfServiceBasicSettings(settings.deviceRequest || defaults.deviceRequest, [
      { key: "allowEmployeeAddDevice", defaultValue: true },
    ]),
    signSettings: normalizeSelfServiceSignSettings(settings.signSettings || defaults.signSettings),
  };
}

function loadSelfServiceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(selfServiceSettingsStorageKey) || "null");
    return normalizeSelfServiceSettings(saved || defaultSelfServiceSettings());
  } catch {
    return defaultSelfServiceSettings();
  }
}

function saveSelfServiceSettings() {
  saveSharedLocalStorage(selfServiceSettingsStorageKey, state.selfServiceSettings);
}

function descendantCategoryRows(node) {
  return node ? [flattenAssetCategoryTree([node])[0], ...flattenAssetCategoryTree(node.children || [])].filter(Boolean) : [];
}

function descendantLocationRows(node, parentPath = []) {
  return node ? flattenLocationTree([node], null, parentPath) : [];
}

function locationPathById(id) {
  return flattenLocationTree().find((node) => node.id === id)?.path || "";
}

function locationParentPathById(id) {
  const found = findLocationNodeById(id);
  return found?.parent ? locationPathById(found.parent.id).split(" / ").filter(Boolean) : [];
}

function assetReferencesCategoryNames(names) {
  const targets = new Set(names.filter(Boolean));
  return state.assets.filter((asset) => targets.has(asset.category));
}

function assetReferencesLocationPaths(paths) {
  const targets = new Set(paths.filter(Boolean));
  return state.assets.filter((asset) => targets.has(normalizeLocationValue(asset.location)));
}

function updateAssetCategoryReferences(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  updateAssetCategoryReferenceMap(new Map([[oldName, newName]]));
}

function updateAssetCategoryReferenceMap(referenceMap) {
  if (!referenceMap?.size) return;
  let changed = false;
  state.assets.forEach((asset) => {
    const newName = referenceMap.get(asset.category);
    if (!newName || newName === asset.category) return;
    const oldName = asset.category;
    asset.category = newName;
    asset.type = newName;
    asset.lifecycle = [...(asset.lifecycle || []), [todayValue(), "分类联动", `资产分类由 ${oldName} 更新为 ${newName}`]];
    asset.completeness = calculateAssetCompleteness(asset);
    changed = true;
  });
  if (changed) saveAssets();
}

function updateAssetLocationReferences(oldPath, newPath) {
  if (!oldPath || !newPath || oldPath === newPath) return;
  updateAssetLocationReferenceMap(new Map([[oldPath, newPath]]));
}

function updateAssetLocationReferenceMap(referenceMap) {
  if (!referenceMap?.size) return;
  let changed = false;
  state.assets.forEach((asset) => {
    const oldPath = normalizeLocationValue(asset.location);
    const newPath = referenceMap.get(oldPath);
    if (!newPath || newPath === oldPath) return;
    asset.location = newPath;
    asset.lifecycle = [...(asset.lifecycle || []), [todayValue(), "位置联动", `所在位置由 ${oldPath} 更新为 ${newPath}`]];
    asset.completeness = calculateAssetCompleteness(asset);
    changed = true;
  });
  if (changed) saveAssets();
}

function cloneLocationTree(tree = defaultAssetLocationTree) {
  return tree.map((node) => {
    if (typeof node === "string") {
      return {
        id: createLocationId(),
        name: node.trim(),
        code: "",
        enabled: true,
        children: [],
      };
    }
    return {
      id: node.id || createLocationId(),
      name: String(node.name || node.label || "").trim(),
      code: String(node.code || "").trim(),
      enabled: node.enabled !== false,
      children: cloneLocationTree(node.children || []).filter((child) => child.name),
    };
  });
}

function normalizeLocationTree(tree = defaultAssetLocationTree) {
  const normalized = cloneLocationTree(Array.isArray(tree) && tree.length ? tree : defaultAssetLocationTree).filter((node) => node.name);
  return normalized.length ? normalized : cloneLocationTree(defaultAssetLocationTree);
}

function detachLocationByName(tree, name) {
  for (let index = 0; index < tree.length; index += 1) {
    if (tree[index].name === name) return tree.splice(index, 1)[0];
    const found = detachLocationByName(tree[index].children || [], name);
    if (found) return found;
  }
  return null;
}

function normalizeLocationHierarchy(tree) {
  const normalized = normalizeLocationTree(tree);
  const ningbo = detachLocationByName(normalized, "宁波仓库") || {
    id: "loc-ningbo",
    name: "宁波仓库",
    code: "CK",
    enabled: true,
    children: [],
  };
  ningbo.id = ningbo.id || "loc-ningbo";
  ningbo.code = ningbo.code || "CK";
  ningbo.children = ningbo.children || [];
  const insertIndex = normalized.findIndex((node) => node.name === "东南亚");
  normalized.splice(insertIndex >= 0 ? insertIndex : normalized.length, 0, ningbo);
  return normalized;
}

function loadAssetLocationTree() {
  try {
    return normalizeLocationHierarchy(JSON.parse(localStorage.getItem("assetLocationTree") || "null"));
  } catch {
    return normalizeLocationHierarchy(defaultAssetLocationTree);
  }
}

function saveAssetLocationTree() {
  saveSharedLocalStorage("assetLocationTree", assetLocationTree);
}

function flattenLocationTree(tree = assetLocationTree, parent = null, parentPath = []) {
  return tree.flatMap((node, index) => {
    const pathParts = [...parentPath, node.name];
    const row = {
      ...node,
      parentId: parent?.id || "",
      parentName: parent?.name || "暂无上级",
      path: pathParts.join(" / "),
      level: parentPath.length,
      index,
    };
    return [row, ...flattenLocationTree(node.children || [], node, pathParts)];
  });
}

function buildAssetLocationOptions(tree = assetLocationTree) {
  return flattenLocationTree(tree)
    .filter((node) => node.enabled !== false)
    .map((node) => node.path);
}

function refreshAssetLocationOptions() {
  assetLocationOptions = buildAssetLocationOptions(assetLocationTree);
}

function locationTemplateRowsFromTree() {
  return flattenLocationTree().map((node) => ({
    result: "",
    code: node.code || "",
    name: node.name || "",
    parent: node.parentId ? node.parentName : "",
  }));
}

function sharedStringXml(values) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${values.length}" uniqueCount="${values.length}">${values
    .map((value) => `<si><t>${escapeXml(value)}</t></si>`)
    .join("")}</sst>`;
}

function columnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    const mod = (current - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    current = Math.floor((current - mod) / 26);
  }
  return name;
}

function worksheetXml(rows) {
  const shared = new Map();
  const strings = [];
  const sharedIndex = (value) => {
    const text = String(value ?? "");
    if (!shared.has(text)) {
      shared.set(text, strings.length);
      strings.push(text);
    }
    return shared.get(text);
  };
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, colIndex) => `<c r="${columnName(colIndex + 1)}${rowIndex + 1}" t="s"><v>${sharedIndex(cell)}</v></c>`)
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return {
    strings,
    sheet: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="24" customWidth="1"/><col min="4" max="4" width="28" customWidth="1"/></cols><sheetData>${rowXml}</sheetData></worksheet>`,
  };
}

async function buildLocationWorkbookBlob(rows) {
  if (!window.JSZip) throw new Error("Excel 组件未加载");
  const zip = new JSZip();
  const data = [
    ["验证结果", "位置编码", "位置名称*", "上级位置名称"],
    ["请勿填写", "非必填项，不可重复", "必填项，不可重复", "①请确保上级名称在系统或表格内已存在\n②若新建一级位置，此项为空"],
    ...rows.map((row) => [row.result || "", row.code || "", row.name || "", row.parent || ""]),
  ];
  const { strings, sheet } = worksheetXml(data);
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  zip.folder("xl").folder("worksheets").file("sheet1.xml", sheet);
  zip.folder("xl").file("sharedStrings.xml", sharedStringXml(strings));
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function readLocationWorkbookRows(file) {
  if (!window.JSZip) throw new Error("Excel 组件未加载");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const sharedText = await zip.file("xl/sharedStrings.xml")?.async("text");
  const shared = sharedText
    ? Array.from(new DOMParser().parseFromString(sharedText, "application/xml").querySelectorAll("si")).map((si) =>
        Array.from(si.querySelectorAll("t"))
          .map((t) => t.textContent || "")
          .join("")
      )
    : [];
  const sheetName = zip.file("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : Object.keys(zip.files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error("未找到工作表");
  const sheetXml = await zip.file(sheetName).async("text");
  const sheet = new DOMParser().parseFromString(sheetXml, "application/xml");
  const valueOf = (cell) => {
    if (cell.getAttribute("t") === "inlineStr") {
      return Array.from(cell.querySelectorAll("is t"))
        .map((item) => item.textContent || "")
        .join("");
    }
    const raw = cell.querySelector("v")?.textContent || "";
    if (cell.getAttribute("t") === "s") return shared[Number(raw)] || "";
    return raw;
  };
  return Array.from(sheet.querySelectorAll("row"))
    .map((row) => {
      const values = [];
      row.querySelectorAll("c").forEach((cell) => {
        const ref = cell.getAttribute("r") || "";
        const letters = ref.replace(/\d+/g, "");
        const index = letters.split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
        values[index] = valueOf(cell);
      });
      return values;
    })
    .slice(2)
    .map((row, index) => ({
      rowNumber: index + 3,
      code: String(row[1] || "").trim(),
      name: String(row[2] || "").trim(),
      parent: String(row[3] || "").trim(),
    }))
    .filter((row) => row.code || row.name || row.parent);
}

function findLocationNodeByName(name, tree = assetLocationTree, parent = null) {
  const target = String(name || "").trim();
  if (!target) return null;
  for (const node of tree) {
    if (node.name === target) return { node, parent, siblings: tree };
    const found = findLocationNodeByName(target, node.children || [], node);
    if (found) return found;
  }
  return null;
}

function removeLocationNodeByName(name, tree = assetLocationTree) {
  const target = String(name || "").trim();
  const index = tree.findIndex((node) => node.name === target);
  if (index >= 0) return tree.splice(index, 1)[0];
  for (const node of tree) {
    const removed = removeLocationNodeByName(target, node.children || []);
    if (removed) return removed;
  }
  return null;
}

function insertLocationNodeByParentName(tree, node, parentName = "") {
  if (!parentName) {
    tree.push(node);
    return true;
  }
  const parent = findLocationNodeByName(parentName, tree)?.node;
  if (!parent) return false;
  parent.children = parent.children || [];
  parent.children.push(node);
  return true;
}

function validateImportedLocationRows(rows) {
  const errors = [];
  const importedNames = new Map();
  const importedCodes = new Map();
  rows.forEach((row) => {
    if (!row.name) errors.push(`第 ${row.rowNumber} 行缺少位置名称`);
    if (row.name && importedNames.has(row.name)) {
      errors.push(`第 ${row.rowNumber} 行位置名称与第 ${importedNames.get(row.name)} 行重复`);
    }
    if (row.code && importedCodes.has(row.code)) {
      errors.push(`第 ${row.rowNumber} 行位置编码与第 ${importedCodes.get(row.code)} 行重复`);
    }
    if (row.parent && row.parent === row.name) errors.push(`第 ${row.rowNumber} 行上级位置不能等于自身`);
    if (row.name) importedNames.set(row.name, row.rowNumber);
    if (row.code) importedCodes.set(row.code, row.rowNumber);
  });

  const existingRows = flattenLocationTree();
  const knownNames = new Set([...existingRows.map((item) => item.name), ...rows.map((item) => item.name).filter(Boolean)]);
  rows.forEach((row) => {
    if (row.parent && !knownNames.has(row.parent)) {
      errors.push(`第 ${row.rowNumber} 行上级位置“${row.parent}”不存在`);
    }
  });

  const codeOwners = new Map(existingRows.filter((item) => item.code).map((item) => [item.code, item.name]));
  rows.forEach((row) => {
    if (!row.code) return;
    const owner = codeOwners.get(row.code);
    if (owner && owner !== row.name && !importedNames.has(owner)) {
      errors.push(`第 ${row.rowNumber} 行位置编码已被“${owner}”使用`);
    }
    codeOwners.set(row.code, row.name);
  });

  return errors;
}

function applyImportedLocationRows(rows) {
  const errors = validateImportedLocationRows(rows);
  if (errors.length) throw new Error(errors.slice(0, 3).join("；"));

  const nextTree = cloneLocationTree(assetLocationTree);
  const rowsByName = new Map(rows.map((row) => [row.name, row]));
  const nodesByName = new Map();

  rows.forEach((row) => {
    const existing = removeLocationNodeByName(row.name, nextTree);
    const node = existing || { id: createLocationId(), name: row.name, code: "", enabled: true, children: [] };
    node.name = row.name;
    node.code = row.code || node.code || "";
    node.enabled = node.enabled !== false;
    node.children = node.children || [];
    if (row.parent && flattenLocationTree(node.children || []).some((child) => child.name === row.parent)) {
      throw new Error(`第 ${row.rowNumber} 行不能把位置移动到自己的下级`);
    }
    nodesByName.set(row.name, node);
  });

  const inserted = new Set();
  let progressed = true;
  while (inserted.size < rows.length && progressed) {
    progressed = false;
    rows.forEach((row) => {
      if (inserted.has(row.name)) return;
      const parentIsImported = row.parent && rowsByName.has(row.parent);
      if (parentIsImported && !inserted.has(row.parent)) return;
      const node = nodesByName.get(row.name);
      if (!insertLocationNodeByParentName(nextTree, node, row.parent)) {
        throw new Error(`第 ${row.rowNumber} 行上级位置“${row.parent}”不存在`);
      }
      inserted.add(row.name);
      progressed = true;
    });
  }

  if (inserted.size < rows.length) throw new Error("导入位置层级存在循环关系");

  assetLocationTree = normalizeLocationHierarchy(nextTree);
  state.locationTreeOpen = {};
  refreshAssetLocationOptions();
  saveAssetLocationTree();
  migrateAssetLocations();
  render();
  return rows.length;
}

async function downloadLocationTemplate() {
  const response = await fetch("./assets/位置导入模版_2026-06-16.xlsx");
  if (!response.ok) throw new Error("模板文件读取失败");
  const blob = await response.blob();
  downloadBlob(`位置导入模版_${todayValue()}.xlsx`, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  showToast("已下载位置导入模板");
}

async function exportLocationWorkbook() {
  const rows = locationTemplateRowsFromTree();
  const blob = await buildLocationWorkbookBlob(rows);
  downloadBlob(`位置导出_${todayValue()}.xlsx`, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  showToast(`已导出 ${rows.length} 条位置`);
}

async function importLocationWorkbook(file) {
  if (!file) return;
  const rows = await readLocationWorkbookRows(file);
  if (!rows.length) throw new Error("模板中没有可导入的位置");
  const count = applyImportedLocationRows(rows);
  showToast(`已导入 ${count} 条位置`);
}

function runLocationWorkbookAction(action) {
  Promise.resolve()
    .then(action)
    .catch((error) => {
      console.error(error);
      showToast(error?.message || "导入/导出失败");
    });
}

function triggerLocationWorkbookAction(action) {
  if (state.locationImportBusy) return;
  if (action === "template") {
    runLocationWorkbookAction(downloadLocationTemplate);
    return;
  }
  if (action === "export") {
    runLocationWorkbookAction(exportLocationWorkbook);
    return;
  }
  if (action === "import") {
    const input = document.querySelector("[data-location-import-file]");
    if (!input) return;
    input.value = "";
    input.click();
  }
}

function syncRoleFormFromDom(root = document) {
  if (!state.roleForm) currentRoleForm();
  const formRoot = root.querySelector?.(".role-config-form") || document.querySelector(".role-config-form");
  if (!formRoot || !state.roleForm) return;
  formRoot.querySelectorAll("[data-role-field]").forEach((field) => {
    state.roleForm[field.dataset.roleField] = field.value.trim();
  });
  state.roleForm.permissions = Array.from(formRoot.querySelectorAll("[data-role-permission]:checked")).map((input) => input.dataset.rolePermission);
  if (state.roleForm.name && state.roleForm.permissions.length) {
    state.roleError = "";
  }
}

function selectRoleDefinition(roleId) {
  const role = state.roles.find((item) => item.id === roleId);
  if (!role) return;
  state.selectedRoleId = role.id;
  state.pendingRoleDeleteId = "";
  state.roleError = "";
  state.roleForm = null;
  render();
}

function createRoleDefinitionDraft() {
  state.selectedRoleId = "";
  state.pendingRoleDeleteId = "";
  state.roleError = "";
  state.roleForm = {
    id: "",
    name: "",
    type: "admin",
    description: "",
    permissions: ["employee:view", "asset:view"],
  };
  openRoleDefinitionModal();
}

function setRoleFormError(message, root = document) {
  state.roleError = message;
  const error = root.querySelector?.("[data-role-form-error]");
  if (error) {
    error.textContent = message;
    error.hidden = false;
  }
  showToast(message);
}

function saveRoleDefinitionFromForm(root = document) {
  syncRoleFormFromDom(root);
  const form = state.roleForm || {};
  if (!form.name) {
    setRoleFormError("请填写角色名称", root);
    return false;
  }
  if (!form.permissions?.length) {
    setRoleFormError("请至少选择一个功能权限", root);
    return false;
  }
  const existing = state.roles.find((role) => role.id === form.id);
  const duplicate = state.roles.find((role) => role.name === form.name && role.id !== form.id);
  if (duplicate) {
    setRoleFormError("角色名称已存在", root);
    return false;
  }
  if (existing) {
    existing.name = form.name;
    existing.type = form.type || "admin";
    existing.description = form.description || "";
    existing.permissions = [...form.permissions];
    state.selectedRoleId = existing.id;
  } else {
    const role = normalizeRoleDefinition({
      id: createRoleId(),
      name: form.name,
      type: form.type || "admin",
      builtIn: false,
      description: form.description || "",
      permissions: form.permissions,
    });
    state.roles.push(role);
    state.selectedRoleId = role.id;
  }
  saveRoleDefinitions();
  state.roleForm = null;
  state.roleError = "";
  state.pendingRoleDeleteId = "";
  return true;
}

function deleteRoleDefinition(roleId) {
  const role = state.roles.find((item) => item.id === roleId);
  if (!role) return;
  if (role.builtIn) {
    showToast("内置角色不能删除");
    return;
  }
  const assigned = roleAssignedUsers(role).length;
  if (assigned > 0) {
    showToast("该角色已绑定账号，无法删除");
    return;
  }
  if (state.pendingRoleDeleteId !== roleId) {
    state.pendingRoleDeleteId = roleId;
    render();
    showToast(`再次点击确认删除“${role.name}”`);
    return;
  }
  state.roles = state.roles.filter((item) => item.id !== roleId);
  state.selectedRoleId = state.roles.find((item) => item.id === "admin")?.id || state.roles[0]?.id || "";
  state.roleForm = null;
  state.pendingRoleDeleteId = "";
  saveRoleDefinitions();
  closeModal();
  render();
  showToast("角色已删除");
}

function setRoleCheckboxState(input, checkedCount, totalCount) {
  if (!input) return;
  input.checked = totalCount > 0 && checkedCount === totalCount;
  input.indeterminate = checkedCount > 0 && checkedCount < totalCount;
}

function refreshRoleModuleState(root = document) {
  const formRoot = root.querySelector?.(".role-config-form") || document.querySelector(".role-config-form");
  if (!formRoot) return;
  const groups = rolePermissionGroups();
  const actionInputs = Array.from(formRoot.querySelectorAll("[data-role-permission]"));
  const permissions = new Set(actionInputs.filter((input) => input.checked).map((input) => input.dataset.rolePermission));
  if (state.roleForm) state.roleForm.permissions = Array.from(permissions);

  let activeGroup = groups.find((group) => group.id === state.rolePermissionGroup) || groups[0];
  if (!activeGroup) return;
  let activeModule = activeGroup.modules.find((module) => module.code === state.rolePermissionModule);
  if (!activeModule) activeModule = activeGroup.modules[0];
  state.rolePermissionGroup = activeGroup.id;
  state.rolePermissionModule = activeModule?.code || "";

  const allCodes = groups.flatMap(roleGroupCodes);
  const allChecked = roleCheckedCount(allCodes, permissions);
  setRoleCheckboxState(formRoot.querySelector("[data-role-all-permissions]"), allChecked, allCodes.length);

  const summaryCount = formRoot.querySelector(".role-permission-section summary em");
  if (summaryCount) summaryCount.textContent = `${permissions.size} / ${allCodes.length}`;

  groups.forEach((group) => {
    const codes = roleGroupCodes(group);
    const checkedCount = roleCheckedCount(codes, permissions);
    const isActiveGroup = group.id === activeGroup.id;
    formRoot.querySelectorAll(`[data-role-permission-group="${group.id}"]`).forEach((row) => row.classList.toggle("active", isActiveGroup));
    formRoot.querySelectorAll(`[data-role-module-group="${group.id}"]`).forEach((row) => {
      row.hidden = !isActiveGroup;
    });
    const count = formRoot.querySelector(`[data-role-group-count="${group.id}"]`);
    if (count) count.textContent = `(${checkedCount}/${codes.length})`;
    setRoleCheckboxState(formRoot.querySelector(`[data-role-group-check="${group.id}"]`), checkedCount, codes.length);
  });

  const activeGroupCodes = roleGroupCodes(activeGroup);
  setRoleCheckboxState(formRoot.querySelector("[data-role-active-group-check]"), roleCheckedCount(activeGroupCodes, permissions), activeGroupCodes.length);
  const activeGroupTitle = formRoot.querySelector("[data-role-active-group-title]");
  if (activeGroupTitle) activeGroupTitle.textContent = activeGroup.name;

  rolePermissionModules.forEach((module) => {
    const codes = roleModuleCodes(module);
    const checkedCount = roleCheckedCount(codes, permissions);
    const isActiveModule = module.code === activeModule?.code;
    const moduleRow = formRoot.querySelector(`[data-role-module-row="${module.code}"]`);
    moduleRow?.classList.toggle("active", isActiveModule);
    const count = formRoot.querySelector(`[data-role-module-count="${module.code}"]`);
    if (count) count.textContent = `(${checkedCount}/${codes.length})`;
    setRoleCheckboxState(formRoot.querySelector(`[data-role-module="${module.code}"]`), checkedCount, codes.length);
    const actionPanel = formRoot.querySelector(`[data-role-action-panel="${module.code}"]`);
    if (actionPanel) actionPanel.hidden = !isActiveModule;
  });

  const activeModuleCodes = activeModule ? roleModuleCodes(activeModule) : [];
  setRoleCheckboxState(formRoot.querySelector("[data-role-active-module-check]"), roleCheckedCount(activeModuleCodes, permissions), activeModuleCodes.length);
  const activeModuleTitle = formRoot.querySelector("[data-role-active-module-title]");
  if (activeModuleTitle) activeModuleTitle.textContent = activeModule?.name || "-";

  actionInputs.forEach((input) => input.closest(".role-permission-action")?.classList.toggle("checked", input.checked));
}

function setRolePermissionCodes(codes, checked, root = document) {
  const formRoot = root.querySelector?.(".role-config-form") || document.querySelector(".role-config-form");
  if (!formRoot) return;
  const codeSet = new Set(codes);
  formRoot.querySelectorAll("[data-role-permission]").forEach((input) => {
    if (codeSet.has(input.dataset.rolePermission)) input.checked = checked;
  });
  syncRoleFormFromDom(root);
  refreshRoleModuleState(root);
}

function selectRolePermissionGroup(groupId, root = document) {
  syncRoleFormFromDom(root);
  const group = rolePermissionGroups().find((item) => item.id === groupId);
  if (!group) return;
  state.rolePermissionGroup = group.id;
  if (!group.modules.some((module) => module.code === state.rolePermissionModule)) {
    state.rolePermissionModule = group.modules[0]?.code || "";
  }
  refreshRoleModuleState(root);
}

function selectRolePermissionModule(moduleCode, root = document) {
  syncRoleFormFromDom(root);
  const group = rolePermissionGroups().find((item) => item.modules.some((module) => module.code === moduleCode));
  if (!group) return;
  state.rolePermissionGroup = group.id;
  state.rolePermissionModule = moduleCode;
  refreshRoleModuleState(root);
}

function toggleRoleGroup(groupId, checked, root = document) {
  const group = rolePermissionGroups().find((item) => item.id === groupId);
  if (!group) return;
  state.rolePermissionGroup = group.id;
  if (!group.modules.some((module) => module.code === state.rolePermissionModule)) {
    state.rolePermissionModule = group.modules[0]?.code || "";
  }
  setRolePermissionCodes(roleGroupCodes(group), checked, root);
}

function toggleRoleModule(moduleCode, checked, root = document) {
  const group = rolePermissionGroups().find((item) => item.modules.some((module) => module.code === moduleCode));
  const module = group?.modules.find((item) => item.code === moduleCode);
  if (!module) return;
  state.rolePermissionGroup = group.id;
  state.rolePermissionModule = module.code;
  setRolePermissionCodes(roleModuleCodes(module), checked, root);
}

function submitRoleSearch(type = "role") {
  if (type === "user") {
    state.roleUserQuery = ((state.roleUserQueryDraft ?? state.roleUserQuery) || "").trim();
  } else {
    state.roleQuery = ((state.roleQueryDraft ?? state.roleQuery) || "").trim();
  }
  state.pendingRoleDeleteId = "";
  render();
}

function handleLocationImportFile(file) {
  if (!file || state.locationImportBusy) return;
  if (!/\.xlsx$/i.test(file.name || "")) {
    showToast("请上传 .xlsx 位置导入模板");
    return;
  }
  state.locationImportBusy = true;
  showToast("正在导入位置...");
  runLocationWorkbookAction(async () => {
    try {
      await importLocationWorkbook(file);
    } finally {
      state.locationImportBusy = false;
    }
  });
}

function findLocationNodeById(id, tree = assetLocationTree, parent = null) {
  for (const node of tree) {
    if (node.id === id) return { node, parent, siblings: tree };
    const found = findLocationNodeById(id, node.children || [], node);
    if (found) return found;
  }
  return null;
}

function removeLocationNodeById(id, tree = assetLocationTree) {
  const index = tree.findIndex((node) => node.id === id);
  if (index >= 0) return tree.splice(index, 1)[0];
  for (const node of tree) {
    const removed = removeLocationNodeById(id, node.children || []);
    if (removed) return removed;
  }
  return null;
}

function insertLocationNode(node, parentId = "") {
  if (!parentId) {
    assetLocationTree.push(node);
    return true;
  }
  const parent = findLocationNodeById(parentId)?.node;
  if (!parent) return false;
  parent.children = parent.children || [];
  parent.children.push(node);
  state.locationTreeOpen[parent.id] = true;
  return true;
}

const assetTableColumns = [
  { key: "status", label: "资产状态", width: 86, minWidth: 62, render: (item) => assetListStatus(item.status) },
  { key: "code", label: "资产编码", width: 112, minWidth: 82, render: (item) => `<button class="link" data-detail="${item.id}">${item.id}</button>` },
  { key: "name", label: "资产名称", width: 118, minWidth: 78, render: (item) => item.name },
  { key: "category", label: "资产分类", width: 92, minWidth: 62, render: (item) => item.category },
  { key: "phone", label: "手机号", width: 92, minWidth: 68, render: (item) => item.phone || "-" },
  { key: "email", label: "电子邮箱", width: 118, minWidth: 82, render: (item) => item.email || "-" },
  { key: "date", label: "领用日期", width: 90, minWidth: 70, render: (item) => item.receiveDate || "-" },
  { key: "location", label: "所在位置", width: 92, minWidth: 64, render: (item) => item.location || "-" },
  { key: "price", label: "金额", width: 64, minWidth: 48, render: (item) => item.price },
  { key: "purchase", label: "购置方式", width: 82, minWidth: 58, render: (item) => item.purchaseMethod || "-" },
  { key: "rent", label: "租金", width: 56, minWidth: 42, render: (item) => item.rent || 0 },
  { key: "supplier", label: "供应商", width: 104, minWidth: 68, render: (item) => item.supplier || "-" },
  { key: "owner", label: "使用人", width: 78, minWidth: 54, render: (item) => item.owner },
  { key: "usage", label: "使用信息", width: 110, minWidth: 72, render: (item) => `${item.status} / ${item.department}` },
];

const defaultAssetTableColumnKeys = assetTableColumns.map((column) => column.key);
const assetTableColumnLayoutVersion = "compact-v2";

function normalizeAssetTableColumnWidths(widths = {}) {
  return assetTableColumns.reduce((result, column) => {
    const saved = Number(widths[column.key]);
    if (!Number.isFinite(saved)) return result;
    result[column.key] = Math.max(Number(column.minWidth) || 48, Math.round(saved));
    return result;
  }, {});
}

function normalizeAssetListSettings(settings = {}) {
  const validKeys = new Set(assetTableColumns.map((column) => column.key));
  const visibleColumns = Array.isArray(settings.visibleColumns)
    ? settings.visibleColumns.filter((key) => validKeys.has(key))
    : defaultAssetTableColumnKeys;
  const columnWidths =
    settings.columnLayoutVersion === assetTableColumnLayoutVersion
      ? normalizeAssetTableColumnWidths(settings.columnWidths || {})
      : {};
  return {
    visibleColumns: visibleColumns.length ? visibleColumns : defaultAssetTableColumnKeys,
    density: ["compact", "standard", "roomy"].includes(settings.density) ? settings.density : "compact",
    columnWidths,
    columnLayoutVersion: assetTableColumnLayoutVersion,
  };
}

function defaultAssetListSettings() {
  return normalizeAssetListSettings({
    visibleColumns: defaultAssetTableColumnKeys,
    density: "compact",
    columnWidths: {},
    columnLayoutVersion: assetTableColumnLayoutVersion,
  });
}

function loadAssetListSettings() {
  try {
    return normalizeAssetListSettings(JSON.parse(localStorage.getItem("assetListSettings") || "null") || {});
  } catch {
    return defaultAssetListSettings();
  }
}

const borrowReturnTableColumns = [
  { key: "select", label: "", width: 36, minWidth: 36, resizable: false },
  { key: "status", label: "借用状态", width: 78, minWidth: 58 },
  { key: "order", label: "借用单号", width: 116, minWidth: 86 },
  { key: "handler", label: "经办人", width: 72, minWidth: 50 },
  { key: "borrower", label: "借用人", width: 72, minWidth: 50 },
  { key: "borrowDate", label: "借用日期", width: 92, minWidth: 74 },
  { key: "company", label: "借用人公司", width: 104, minWidth: 72 },
  { key: "department", label: "借用人部门", width: 104, minWidth: 72 },
  { key: "employeeCode", label: "工号", width: 60, minWidth: 48 },
  { key: "phone", label: "手机号", width: 94, minWidth: 72 },
  { key: "email", label: "邮箱", width: 116, minWidth: 82 },
  { key: "location", label: "借用后位置", width: 108, minWidth: 74 },
  { key: "signer", label: "签字人", width: 70, minWidth: 50 },
  { key: "signImage", label: "签字图片", width: 78, minWidth: 60 },
  { key: "note", label: "借用备注", width: 96, minWidth: 66 },
  { key: "assetCode", label: "资产编码", width: 104, minWidth: 76 },
  { key: "category", label: "资产分类", width: 86, minWidth: 60 },
  { key: "assetName", label: "资产名称", width: 104, minWidth: 72 },
  { key: "brand", label: "品牌", width: 66, minWidth: 48 },
  { key: "model", label: "型号", width: 78, minWidth: 56 },
  { key: "sn", label: "设备序列号", width: 112, minWidth: 78 },
  { key: "action", label: "操作", width: 86, minWidth: 70, resizable: false },
];

const inboundOrderTableColumns = [
  { key: "select", label: "", width: 36, minWidth: 36, resizable: false },
  { key: "status", label: "入库状态", width: 92, minWidth: 66 },
  { key: "id", label: "入库单号", width: 150, minWidth: 98 },
  { key: "type", label: "入库类型", width: 100, minWidth: 70 },
  { key: "date", label: "入库日期", width: 104, minWidth: 78 },
  { key: "operator", label: "入库人", width: 82, minWidth: 58 },
  { key: "purchaser", label: "采购人", width: 82, minWidth: 58 },
  { key: "createdDate", label: "创建日期", width: 104, minWidth: 78 },
  { key: "company", label: "所属公司", width: 120, minWidth: 82 },
  { key: "note", label: "入库备注", width: 116, minWidth: 76 },
  { key: "action", label: "操作", width: 94, minWidth: 78, resizable: false },
];

const receiveReturnStandardColumns = [
  { key: "select", label: "", width: 36, minWidth: 36, resizable: false },
  { key: "status", label: "状态", width: 92, minWidth: 66 },
  { key: "id", label: "单号", width: 150, minWidth: 98 },
  { key: "date", label: "日期", width: 104, minWidth: 78 },
  { key: "handler", label: "经办人", width: 82, minWidth: 58 },
  { key: "receiver", label: "领用人", width: 82, minWidth: 58 },
  { key: "employeeCode", label: "工号", width: 68, minWidth: 50 },
  { key: "location", label: "位置", width: 110, minWidth: 76 },
  { key: "company", label: "所属公司", width: 110, minWidth: 76 },
  { key: "assetId", label: "资产编码", width: 112, minWidth: 82 },
  { key: "action", label: "操作", width: 94, minWidth: 78, resizable: false },
];

const receiveReturnHandoverColumns = [
  { key: "select", label: "", width: 36, minWidth: 36, resizable: false },
  { key: "status", label: "交接状态", width: 92, minWidth: 66 },
  { key: "id", label: "交接单号", width: 150, minWidth: 98 },
  { key: "handler", label: "经办人", width: 82, minWidth: 58 },
  { key: "receiver", label: "接收人", width: 82, minWidth: 58 },
  { key: "company", label: "接收公司", width: 110, minWidth: 76 },
  { key: "department", label: "接收部门", width: 110, minWidth: 76 },
  { key: "action", label: "操作", width: 116, minWidth: 92, resizable: false },
];

const inboundColumnLayoutVersion = "compact-v1";
const receiveReturnColumnLayoutVersion = "compact-v1";
const borrowReturnColumnLayoutVersion = "compact-v2";

function normalizeInboundColumnWidths(widths = {}) {
  return inboundOrderTableColumns.reduce((result, column) => {
    const saved = Number(widths[column.key]);
    if (!Number.isFinite(saved)) return result;
    result[column.key] = Math.max(Number(column.minWidth) || 48, Math.round(saved));
    return result;
  }, {});
}

function loadInboundColumnWidths() {
  try {
    if (localStorage.getItem("inboundColumnLayoutVersion") !== inboundColumnLayoutVersion) {
      return {};
    }
    const saved = JSON.parse(localStorage.getItem("inboundColumnWidths") || "{}");
    return saved && typeof saved === "object" ? normalizeInboundColumnWidths(saved) : {};
  } catch {
    return {};
  }
}

function normalizeReceiveReturnColumnWidths(widths = {}) {
  const columns = [...receiveReturnStandardColumns, ...receiveReturnHandoverColumns];
  return columns.reduce((result, column) => {
    const saved = Number(widths[column.key]);
    if (!Number.isFinite(saved)) return result;
    result[column.key] = Math.max(Number(column.minWidth) || 48, Math.round(saved));
    return result;
  }, {});
}

function loadReceiveReturnColumnWidths() {
  try {
    if (localStorage.getItem("receiveReturnColumnLayoutVersion") !== receiveReturnColumnLayoutVersion) {
      return {};
    }
    const saved = JSON.parse(localStorage.getItem("receiveReturnColumnWidths") || "{}");
    return saved && typeof saved === "object" ? normalizeReceiveReturnColumnWidths(saved) : {};
  } catch {
    return {};
  }
}

function normalizeBorrowReturnColumnWidths(widths = {}) {
  return borrowReturnTableColumns.reduce((result, column) => {
    const saved = Number(widths[column.key]);
    if (!Number.isFinite(saved)) return result;
    result[column.key] = Math.max(Number(column.minWidth) || 48, Math.round(saved));
    return result;
  }, {});
}

function loadBorrowReturnColumnWidths() {
  try {
    if (localStorage.getItem("borrowReturnColumnLayoutVersion") !== borrowReturnColumnLayoutVersion) {
      return {};
    }
    const saved = JSON.parse(localStorage.getItem("borrowReturnColumnWidths") || "{}");
    return saved && typeof saved === "object" ? normalizeBorrowReturnColumnWidths(saved) : {};
  } catch {
    return {};
  }
}

const assetLabelFieldOptions = [
  { key: "id", label: "资产编码" },
  { key: "name", label: "资产名称" },
  { key: "category", label: "资产分类" },
  { key: "status", label: "资产状态" },
  { key: "owner", label: "使用人" },
  { key: "employeeCode", label: "工号" },
  { key: "department", label: "所属部门" },
  { key: "location", label: "所在位置" },
  { key: "brand", label: "品牌" },
  { key: "model", label: "型号" },
  { key: "sn", label: "序列号" },
  { key: "phone", label: "手机号" },
  { key: "email", label: "电子邮箱" },
  { key: "receiveDate", label: "领用日期" },
  { key: "assetTag", label: "资产标签" },
  { key: "price", label: "金额" },
  { key: "supplier", label: "供应商" },
  { key: "purchaseMethod", label: "购置方式" },
];

const assetLabelTemplates = [
  {
    key: "standard",
    name: "标准资产标签",
    sampleLayout: "fields3",
    settings: {
      labelWidth: 40,
      labelHeight: 30,
      logoWidth: 14,
      logoHeight: 8,
      logoScale: 80,
      logoText: "AM",
      logoImage: "",
      qrSize: 13,
      qrTextGap: 2,
      contentScale: 80,
      offsetX: 0,
      offsetY: 0,
      fontSize: 12,
      columns: 1,
      rows: 1,
      columnGap: 0,
      rowGap: 0,
      fields: ["name", "id", "category"],
      scanFields: [],
      customFields: "",
      showLogo: false,
    },
  },
  {
    key: "compact",
    name: "小型二维码标签",
    sampleLayout: "fields4",
    settings: {
      labelWidth: 60,
      labelHeight: 40,
      logoWidth: 10,
      logoHeight: 6,
      logoScale: 100,
      logoText: "IT",
      logoImage: "",
      qrSize: 15,
      qrTextGap: 10,
      contentScale: 100,
      offsetX: 0,
      offsetY: 0,
      fontSize: 7,
      columns: 1,
      rows: 1,
      columnGap: 5,
      rowGap: 5,
      fields: ["id", "name", "category", "owner"],
      scanFields: [],
      customFields: "",
      showLogo: false,
    },
  },
  {
    key: "full",
    name: "大号信息标签",
    sampleLayout: "topField",
    settings: {
      labelWidth: 60,
      labelHeight: 40,
      logoWidth: 18,
      logoHeight: 10,
      logoScale: 100,
      logoText: "资产云",
      logoImage: "",
      qrSize: 24,
      qrTextGap: 6,
      contentScale: 100,
      offsetX: 0,
      offsetY: 0,
      fontSize: 12,
      columns: 1,
      rows: 1,
      columnGap: 5,
      rowGap: 5,
      fields: ["name", "id"],
      scanFields: [],
      customFields: "管理员=custodian",
      showLogo: false,
    },
  },
  {
    key: "defaultAsset",
    name: "默认资产标签",
    previewMode: "label",
    settings: {
      labelWidth: 60,
      labelHeight: 40,
      logoWidth: 14,
      logoHeight: 8,
      logoScale: 100,
      logoText: "AM",
      logoImage: "",
      qrSize: 18,
      qrTextGap: 2,
      contentScale: 100,
      offsetX: 0,
      offsetY: 0,
      fontSize: 9,
      columns: 3,
      rows: 8,
      columnGap: 3,
      rowGap: 2,
      fields: ["id", "name", "category", "owner", "location"],
      scanFields: ["id", "name", "owner", "phone", "location"],
      customFields: "",
      showLogo: true,
    },
  },
];

const assetLabelStorageKey = "assetLabelPrintSettingsV2";
const assetLabelCustomTemplateStorageKey = "assetLabelCustomTemplatesV1";

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function normalizeAssetLabelFieldFontSizes(values, fallback = 12) {
  if (!Array.isArray(values) && !String(values || "").trim()) return [];
  const rawValues = Array.isArray(values) ? values : String(values || "").split(",");
  return rawValues
    .map((value) => Math.round(clampNumber(String(value || "").trim() ? value : fallback, fallback, 5, 22)))
    .filter((value) => Number.isFinite(value))
    .slice(0, 12);
}

function assetLabelFieldFontSize(settings = state.assetLabelSettings, index = 0) {
  const fallback = Math.round(clampNumber(settings?.fontSize, 12, 5, 22));
  return Math.round(clampNumber(settings?.fieldFontSizes?.[index], fallback, 5, 22));
}

function assetLabelLogoScale(settings = state.assetLabelSettings) {
  const defaults = assetLabelTemplateDefaults(settings?.templateKey);
  return Math.round(clampNumber(settings?.logoScale, defaults.logoScale ?? 100, 50, 160));
}

function assetLabelTemplateDefaults(templateKey = "standard") {
  const template = assetLabelTemplates.find((item) => item.key === templateKey) || assetLabelTemplates[0];
  return { templateKey: template.key, ...template.settings };
}

function normalizeFieldList(values, fallback = []) {
  const validKeys = new Set(assetLabelFieldOptions.map((item) => item.key));
  const list = Array.isArray(values) ? values : String(values || "").split(",");
  const normalized = list.map((item) => String(item || "").trim()).filter((item) => validKeys.has(item));
  return normalized.length ? normalized : fallback;
}

function normalizeOpenFieldList(values, fallback = []) {
  const list = Array.isArray(values) ? values : String(values || "").split(",");
  const normalized = Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
  return normalized.length ? normalized : fallback;
}

function normalizeAssetLabelSettings(settings = {}) {
  const template = assetLabelTemplates.find((item) => item.key === settings.templateKey) || assetLabelTemplates[0];
  const templateKey = template.key;
  const baseTemplateKey = template.baseTemplateKey || template.key;
  const defaults = assetLabelTemplateDefaults(templateKey);
  const fontSize = clampNumber(settings.fontSize, defaults.fontSize, 5, 22);
  const legacyFullTemplateFields =
    baseTemplateKey === "full" &&
    Array.isArray(settings.fields) &&
    String(settings.fields[0] || "").trim() === "" &&
    settings.fields.slice(1).some((item) => String(item || "").trim());
  const fieldFontSizeValues = legacyFullTemplateFields && Array.isArray(settings.fieldFontSizes) ? settings.fieldFontSizes.slice(1) : settings.fieldFontSizes;
  const fields =
    baseTemplateKey === "compact" && Array.isArray(settings.fields) && settings.fields.length
      ? settings.fields.map((item) => String(item || ""))
      : baseTemplateKey === "full"
        ? normalizeFieldList(settings.fields, defaults.fields).slice(0, 2)
        : normalizeFieldList(settings.fields, defaults.fields);
  return {
    templateKey,
    labelWidth: clampNumber(settings.labelWidth, defaults.labelWidth, 20, 160),
    labelHeight: clampNumber(settings.labelHeight, defaults.labelHeight, 12, 120),
    logoWidth: clampNumber(settings.logoWidth, defaults.logoWidth, 0, 60),
    logoHeight: clampNumber(settings.logoHeight, defaults.logoHeight, 0, 40),
    logoScale: Math.round(clampNumber(settings.logoScale, defaults.logoScale ?? 100, 50, 160)),
    logoText: String(settings.logoText ?? defaults.logoText ?? "").slice(0, 12),
    logoImage: String(settings.logoImage ?? defaults.logoImage ?? "").slice(0, 700000),
    qrSize: clampNumber(settings.qrSize, defaults.qrSize, 8, 60),
    qrTextGap: clampNumber(settings.qrTextGap, defaults.qrTextGap ?? 2, 0, 30),
    contentScale: clampNumber(settings.contentScale, defaults.contentScale, 50, 160),
    offsetX: clampNumber(settings.offsetX, defaults.offsetX, -30, 30),
    offsetY: clampNumber(settings.offsetY, defaults.offsetY, -30, 30),
    fontSize,
    fieldFontSizes: normalizeAssetLabelFieldFontSizes(fieldFontSizeValues, fontSize),
    columns: Math.round(clampNumber(settings.columns, defaults.columns, 1, 8)),
    rows: Math.round(clampNumber(settings.rows, defaults.rows, 1, 14)),
    columnGap: clampNumber(settings.columnGap, defaults.columnGap, 0, 30),
    rowGap: clampNumber(settings.rowGap, defaults.rowGap, 0, 30),
    fields,
    scanFields: normalizeOpenFieldList(settings.scanFields, defaults.scanFields),
    customFields: String(settings.customFields ?? defaults.customFields ?? "").slice(0, 600),
    showLogo: settings.showLogo === undefined ? Boolean(defaults.showLogo) : Boolean(settings.showLogo),
  };
}

function assetLabelTemplatePersistedSettings(settings = {}) {
  const normalized = normalizeAssetLabelSettings(settings);
  const { templateKey, ...persisted } = normalized;
  return persisted;
}

function normalizeAssetLabelCustomTemplate(template = {}) {
  const key = String(template.key || "").trim();
  if (!key || assetLabelTemplates.some((item) => item.key === key)) return null;
  const baseTemplateKey = assetLabelTemplates.some((item) => item.key === template.baseTemplateKey) ? template.baseTemplateKey : "standard";
  const baseTemplate = assetLabelTemplates.find((item) => item.key === baseTemplateKey) || assetLabelTemplates[0];
  const name = String(template.name || "").trim().slice(0, 18) || `配置${assetLabelTemplates.length + 1}`;
  const settings = {
    ...assetLabelTemplateDefaults(baseTemplateKey),
    ...(template.settings && typeof template.settings === "object" ? template.settings : {}),
    templateKey: baseTemplateKey,
  };
  return {
    key,
    name,
    custom: true,
    baseTemplateKey,
    sampleLayout: template.sampleLayout || baseTemplate.sampleLayout,
    previewMode: template.previewMode || baseTemplate.previewMode,
    settings: assetLabelTemplatePersistedSettings(settings),
  };
}

function loadAssetLabelCustomTemplates() {
  try {
    const saved = JSON.parse(localStorage.getItem(assetLabelCustomTemplateStorageKey) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.map(normalizeAssetLabelCustomTemplate).filter(Boolean);
  } catch {
    return [];
  }
}

function saveAssetLabelCustomTemplates() {
  const customTemplates = assetLabelTemplates
    .filter((template) => template.custom)
    .map((template) => ({
      key: template.key,
      name: template.name,
      baseTemplateKey: template.baseTemplateKey,
      sampleLayout: template.sampleLayout,
      previewMode: template.previewMode,
      settings: template.settings,
    }));
  saveSharedLocalStorage(assetLabelCustomTemplateStorageKey, customTemplates);
}

function persistAssetLabelTemplateSettings(settings) {
  if (!settings) return;
  const template = assetLabelTemplates.find((item) => item.key === settings?.templateKey);
  if (!template?.custom) return;
  template.settings = assetLabelTemplatePersistedSettings(settings);
  saveAssetLabelCustomTemplates();
}

assetLabelTemplates.push(...loadAssetLabelCustomTemplates());

function defaultAssetLabelSettings() {
  return normalizeAssetLabelSettings(assetLabelTemplateDefaults("standard"));
}

function nextAssetLabelCustomTemplateName() {
  const existingNames = new Set(assetLabelTemplates.map((template) => template.name));
  for (let index = 1; index <= 99; index += 1) {
    const name = `配置${index + 1}`;
    if (!existingNames.has(name)) return name;
  }
  return `配置${assetLabelTemplates.length + 1}`;
}

function createAssetLabelCustomTemplate(settings = state.assetLabelSettings) {
  const sourceTemplate = assetLabelTemplateByKey(settings.templateKey);
  const baseTemplateKey = sourceTemplate.baseTemplateKey || sourceTemplate.key;
  const key = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const normalized = normalizeAssetLabelSettings({ ...settings, templateKey: sourceTemplate.key });
  const customTemplate = {
    key,
    name: nextAssetLabelCustomTemplateName(),
    custom: true,
    baseTemplateKey,
    sampleLayout: sourceTemplate.sampleLayout,
    previewMode: sourceTemplate.previewMode,
    settings: assetLabelTemplatePersistedSettings({ ...normalized, templateKey: baseTemplateKey }),
  };
  assetLabelTemplates.push(customTemplate);
  saveAssetLabelCustomTemplates();
  state.assetLabelSettings = normalizeAssetLabelSettings({ ...customTemplate.settings, templateKey: key });
  saveAssetLabelSettings();
  return customTemplate;
}

function deleteAssetLabelCustomTemplate(templateKey) {
  const index = assetLabelTemplates.findIndex((template) => template.key === templateKey && template.custom);
  if (index === -1) return null;
  const [removed] = assetLabelTemplates.splice(index, 1);
  saveAssetLabelCustomTemplates();
  const fallbackKey = assetLabelTemplates.some((template) => template.key === removed.baseTemplateKey) ? removed.baseTemplateKey : "standard";
  state.assetLabelSettings = normalizeAssetLabelSettings(assetLabelTemplateDefaults(fallbackKey));
  saveAssetLabelSettings();
  return removed;
}

function loadAssetLabelSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(assetLabelStorageKey) || "null");
    return normalizeAssetLabelSettings(saved || defaultAssetLabelSettings());
  } catch {
    return defaultAssetLabelSettings();
  }
}

function saveAssetLabelSettings() {
  saveSharedLocalStorage(assetLabelStorageKey, state.assetLabelSettings);
  persistAssetLabelTemplateSettings(state.assetLabelSettings);
}

function normalizedLocationText(location = "") {
  return String(location || "")
    .trim()
    .replace(/[\\／]+/g, "/")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ");
}

function resolveManagedAssetLocation(location = "") {
  const value = normalizedLocationText(location);
  if (!value) return { valid: false, value: "", reason: "empty" };
  const rows = flattenLocationTree();
  const activeRows = rows.filter((node) => node.enabled !== false);
  const exactPath = activeRows.find((node) => node.path === value);
  if (exactPath) return { valid: true, value: exactPath.path, node: exactPath, matchedBy: "path" };

  const normalizedKey = value.replace(/\s*\/\s*/g, "/").toLowerCase();
  const normalizedPath = activeRows.find((node) => node.path.replace(/\s*\/\s*/g, "/").toLowerCase() === normalizedKey);
  if (normalizedPath) return { valid: true, value: normalizedPath.path, node: normalizedPath, matchedBy: "path" };

  const byCode = activeRows.filter((node) => node.code && String(node.code).trim().toLowerCase() === value.toLowerCase());
  if (byCode.length === 1) return { valid: true, value: byCode[0].path, node: byCode[0], matchedBy: "code" };
  if (byCode.length > 1) return { valid: false, value, reason: "ambiguous", matches: byCode.map((node) => node.path) };

  const byName = activeRows.filter((node) => node.name === value);
  if (byName.length === 1) return { valid: true, value: byName[0].path, node: byName[0], matchedBy: "name" };
  if (byName.length > 1) return { valid: false, value, reason: "ambiguous", matches: byName.map((node) => node.path) };

  return { valid: false, value, reason: "missing" };
}

function locationValidationMessage(location = "") {
  const resolved = resolveManagedAssetLocation(location);
  if (resolved.valid) return "";
  if (resolved.reason === "ambiguous") {
    return `所在位置“${resolved.value}”存在多个匹配，请填写完整路径，例如：${resolved.matches.slice(0, 2).join("、")}`;
  }
  return `所在位置“${resolved.value || location}”不存在`;
}

function normalizeLocationValue(location = "") {
  const value = normalizedLocationText(location);
  if (!value) return "";
  const resolved = resolveManagedAssetLocation(value);
  if (resolved.valid) return resolved.value;
  const legacyMap = [
    [/北京总部\s*A座|北京|A座/, "杭州公司 / 19幢1楼"],
    [/北京总部机房|机房/, "杭州公司 / 19幢6楼"],
    [/上海办公楼|上海办公|办公楼/, "杭州公司 / 19幢2楼"],
    [/上海机房/, "杭州公司 / 19幢6楼"],
    [/深圳办公室|深圳/, "杭州公司 / 下沙龙湖天街"],
    [/云许可池|许可池/, "东南亚 / 新加坡"],
    [/北京仓|行政仓|运维仓|仓库/, "杭州公司 / 封存仓库"],
  ];
  const matched = legacyMap.find(([pattern]) => pattern.test(value));
  return matched ? matched[1] : value;
}

function normalizeSavedAsset(asset = {}) {
  return {
    id: asset.id || `${assetCodePrefix(asset.category)}-${Date.now()}`,
    name: asset.name || "未命名资产",
    category: asset.category || "其他",
    type: asset.type || asset.category || "其他",
    model: asset.model || "",
    sn: asset.sn || "",
    owner: asset.owner || "未分配",
    custodian: asset.custodian || "",
    department: asset.department || "",
    status: asset.status || "空闲",
    location: normalizeLocationValue(asset.location || ""),
    supplier: asset.supplier || "",
    assetTag: asset.assetTag || "",
    tags: Array.isArray(asset.tags) ? asset.tags : [],
    risk: asset.risk || "正常",
    completeness: Number(asset.completeness) || 0,
    approvalRequired: Boolean(asset.approvalRequired),
    price: Number(asset.price) || 0,
    rent: Number(asset.rent) || 0,
    purchaseDate: asset.purchaseDate || "",
    receiveDate: asset.receiveDate || "",
    handoverDate: asset.handoverDate || "",
    handoverType: asset.handoverType || "",
    borrowDate: asset.borrowDate || "",
    expectedReturnDate: asset.expectedReturnDate || "",
    returnDate: asset.returnDate || "",
    warrantyDate: asset.warrantyDate || "未设置",
    approval: asset.approval || "管理端直办",
    lifecycle: Array.isArray(asset.lifecycle) ? asset.lifecycle : [],
    phone: asset.phone || "",
    email: asset.email || "",
    purchaseMethod: asset.purchaseMethod || "",
    orderNo: asset.orderNo || "",
    unit: asset.unit || "",
    note: asset.note || "",
    brand: asset.brand || "",
    company: asset.company || "",
    ownerCompany: asset.ownerCompany || "",
    condition: asset.condition || "",
    usageMonths: asset.usageMonths || "",
    inboundStatus: asset.inboundStatus || "",
    inboundType: asset.inboundType || "",
    inboundNote: asset.inboundNote || "",
    purchaser: asset.purchaser || "",
  };
}

function loadSavedAssets() {
  try {
    const saved = JSON.parse(localStorage.getItem("assetPortalAssets") || "[]");
    return Array.isArray(saved) ? saved.map(normalizeSavedAsset) : [];
  } catch {
    return [];
  }
}

function saveAssets() {
  saveSharedLocalStorage("assetPortalAssets", state.assets);
}

function migrateAssetLocations() {
  let changed = false;
  state.assets.forEach((asset) => {
    const normalized = normalizeLocationValue(asset.location);
    if (normalized !== asset.location) {
      asset.location = normalized;
      changed = true;
    }
  });
  if (changed) saveAssets();
}

const localSessionStorageKey = "assetPortalSession";
const routeStorageKey = "assetPortalLastRoute";
const sessionIdleLimitMs = 10 * 60 * 1000;
let idleLogoutTimer = null;

function assetCodePrefix(category = "") {
  const categoryCode = assetCategoryCodeForName(category);
  if (categoryCode) return categoryCode;
  if (category.includes("软件")) return "LIC";
  if (category.includes("网络")) return "NET";
  if (category.includes("基础")) return "INF";
  if (category.includes("办公")) return "OFF";
  if (category.includes("耗材")) return "MAT";
  return "AST";
}

function assetCodeRuleFieldSample(fieldKey, category = "") {
  if (fieldKey === "categoryCode") return assetCategoryCodeForName(category) || "0101";
  if (fieldKey === "companyCode") return "GS01";
  if (fieldKey === "purchaseDate") {
    const compactDate = todayValue().replaceAll("-", "");
    const format = state?.assetCodeRuleSettings?.dateFormats?.purchaseDate || "yyyymmdd";
    if (format === "yyyymm") return compactDate.slice(0, 6);
    if (format === "yymmdd") return compactDate.slice(2);
    if (format === "yymm") return compactDate.slice(2, 6);
    return compactDate;
  }
  if (fieldKey === "customText") return String(state?.assetCodeRuleSettings?.customTexts?.customText || "").trim();
  if (fieldKey === "locationCode") return "LOC1";
  if (fieldKey === "departmentCode") return "BM01";
  return "";
}

function assetCodeRuleSeparator(optionValue) {
  if (optionValue === "dash") return "-";
  if (optionValue === "slash") return "/";
  return "";
}

function assetCodeRulePrefix(category = "") {
  const settings = normalizeAssetCodeRuleSettings(state?.assetCodeRuleSettings || defaultAssetCodeRuleSettings());
  const parts = settings.selectedFields
    .map((field) => {
      const sample = assetCodeRuleFieldSample(field, category);
      if (!sample) return "";
      return `${sample}${assetCodeRuleSeparator(settings.fieldOptions?.[field])}`;
    })
    .filter(Boolean);
  if (parts.length) return parts.join("");
  return assetCodePrefix(category);
}

function generateAssetCode(category = "") {
  const prefix = assetCodeRulePrefix(category);
  const serialLength = Math.round(clampNumber(state?.assetCodeRuleSettings?.serialLength, 5, 3, 7));
  const next = state?.assets?.length ? state.assets.length + 1 : 1;
  const formatCode = (serial) => `${prefix}${String(serial).padStart(serialLength, "0")}`;
  let code = formatCode(next);
  while (state?.assets?.some((item) => item.id === code)) {
    code = formatCode(next + Math.floor(Math.random() * 9000) + 1);
  }
  return code;
}

function calculateAssetCompleteness(asset) {
  const fields = [
    asset.id,
    asset.name,
    asset.category,
    asset.custodian,
    asset.brand,
    asset.model,
    asset.ownerCompany,
    asset.condition,
    asset.location,
    asset.price,
    asset.purchaseDate,
    asset.unit,
    asset.purchaseMethod,
  ];
  return Math.round((fields.filter((value) => String(value || "").trim()).length / fields.length) * 100);
}

const defaultUsers = [
  {
    name: "admin",
    account: "admin",
    phone: "13800000001",
    email: "admin@example.com",
    department: "管理中心",
    roleCode: "super_admin",
    roleName: "超级管理员",
    scope: "全系统权限",
    loginType: "手机号注册账号",
    identitySource: "手机号注册",
    externalSubject: "phone:13800000001",
    bindStatus: "已绑定",
  },
  {
    name: "普通管理员A",
    account: "asset.admin",
    phone: "13800000002",
    email: "asset.admin@example.com",
    department: "信息中心",
    roleCode: "admin",
    roleName: "普通管理员",
    scope: "资产与员工管理",
    loginType: "超级管理员分配账号",
    identitySource: "超管分配",
    externalSubject: "assigned:asset.admin",
    bindStatus: "已绑定",
  },
  {
    name: "李雷",
    account: "lilei",
    phone: "13800000003",
    email: "lilei@example.com",
    department: "研发中心",
    roleCode: "employee",
    roleName: "普通员工",
    scope: "本人资产与申请",
    loginType: "管理员添加员工信息",
    identitySource: "管理员添加",
    externalSubject: "employee:lilei",
    bindStatus: "已绑定",
  },
];

function loadUsers() {
  const deletedAccounts = new Set(loadDeletedRoleUsers());
  return [...defaultUsers.filter((user) => !deletedAccounts.has(user.account)), ...loadRegisteredUsers()];
}

const state = {
  route: "home",
  query: "",
  assetListQuery: "",
  assetInboundQuery: "",
  assetReceiveReturnQuery: "",
  assetBorrowReturnQuery: "",
  assetCategorySettingsQuery: "",
  assetListPage: 1,
  assetInboundPage: 1,
  assetReceiveReturnPage: 1,
  assetBorrowReturnPage: 1,
  assetCategoryPage: 1,
  assetListPageSize: 20,
  assetInboundPageSize: 20,
  assetReceiveReturnPageSize: 20,
  assetBorrowReturnPageSize: 20,
  assetCategoryPageSize: 20,
  assetReceiveReturnTab: "receive",
  assetBorrowReturnTab: "borrow",
  systemMenu: "角色管理",
  roleQuery: "",
  roleQueryDraft: "",
  roleUserQuery: "",
  roleUserQueryDraft: "",
  selfServiceMenu: "员工自助管理",
  selfServiceSignOpen: false,
  selfServiceCategoryExpanded: {},
  roleTab: "system",
  selectedRoleId: "super_admin",
  roleForm: null,
  roleError: "",
  pendingRoleDeleteId: "",
  rolePermissionGroup: "system",
  rolePermissionModule: "employee",
  navOpen: {},
  assetSubnavScrollTop: 0,
  assetDistributionMode: "organization",
  assetCategoryMetricMode: "count",
  assetCategoryCompanyFilter: "所属/承租公司",
  employeeRequestTab: "all",
  locationTreeOpen: {},
  assetCategoryTreeOpen: {},
  locationImportBusy: false,
  locationSettingsQuery: "",
  currentUser: null,
  session: {
    authenticated: false,
    method: "local",
    provider: "默认管理后台",
    terminal: "web_pc",
    lastLoginAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  },
  selectedTerminal: "web_pc",
  authView: "login",
  pendingAuth: null,
  assetFilters: {
    category: "全部",
    status: "全部",
    tag: "全部",
    location: "全部",
    risk: "全部",
  },
  advancedAssetFilters: defaultAdvancedAssetFilters(),
  advancedInboundFilters: defaultAdvancedInboundFilters(),
  advancedReceiveReturnFilters: defaultAdvancedReceiveReturnFilters(),
  advancedBorrowReturnFilters: defaultAdvancedBorrowReturnFilters(),
  savedAdvancedAssetFilters: loadSavedAdvancedAssetFilters(),
  assetListSettings: loadAssetListSettings(),
  inboundColumnWidths: loadInboundColumnWidths(),
  receiveReturnColumnWidths: loadReceiveReturnColumnWidths(),
  borrowReturnColumnWidths: loadBorrowReturnColumnWidths(),
  assetCodeRuleSettings: loadAssetCodeRuleSettings(),
  assetLabelSettings: loadAssetLabelSettings(),
  selfServiceSettings: loadSelfServiceSettings(),
  selectedAssetIds: [],
  selectedInboundOrderIds: [],
  hasBootstrapped: false,
  assets: loadSavedAssets(),
  roles: loadRoleDefinitions(),
  requests: [
    {
      id: "REQ2604298639",
      type: "资产领用",
      applicant: "李雷",
      asset: "IT 设备",
      reason: "员工入职",
      status: "审批中",
      system: "飞书审批",
      date: "2026-04-29",
      currentNode: "部门负责人",
    },
    {
      id: "REQ2604301088",
      type: "资产报废",
      applicant: "韩梅梅",
      asset: "旧款办公台式机",
      reason: "设备老化无法维修",
      status: "待执行",
      system: "泛微OA",
      date: "2026-04-30",
      currentNode: "普通管理员执行",
    },
    {
      id: "REQ2604302190",
      type: "资产借用",
      applicant: "王五",
      asset: "投影仪",
      reason: "客户会议临时使用",
      status: "已完成",
      system: "飞书审批",
      date: "2026-04-30",
      currentNode: "已归档",
    },
  ],
  stocktakes: [
    {
      id: "STK-26043001",
      name: "杭州公司 Q2 资产盘点",
      scope: "杭州公司 / 19幢办公区 / IT设备",
      owner: "普通管理员",
      progress: "盘点中",
      total: 328,
      checked: 217,
      diff: 6,
      date: "2026-04-30",
    },
    {
      id: "STK-26042109",
      name: "杭州公司显示器盘点",
      scope: "杭州公司 / 19幢办公区 / 显示器",
      owner: "普通管理员",
      progress: "已完成",
      total: 86,
      checked: 86,
      diff: 2,
      date: "2026-04-21",
    },
  ],
  consumables: [
    ["HP 12A 黑色硒鼓", "Q2612A", 25, 5, "杭州公司 / 封存仓库"],
    ["A4 复印纸 80g", "A4-80G", 120, 30, "杭州公司 / 19幢1楼"],
    ["超五类网线 3米", "CAT5E-3M", 40, 10, "杭州公司 / 19幢6楼"],
    ["尼龙扎带 200mm", "ZIP-200", 15, 20, "杭州公司 / 19幢6楼"],
  ],
  deletedRoleUserAccounts: loadDeletedRoleUsers(),
  users: loadUsers(),
  oidcProviders: [
    {
      name: "Feishu OIDC",
      issuer: "https://passport.feishu.cn/suite/passport/oauth",
      clientId: "asset-portal-feishu",
      status: "启用",
      strategy: "按 email 自动绑定，未匹配则待管理员确认",
    },
    {
      name: "Microsoft Entra ID",
      issuer: "https://login.microsoftonline.com/{tenant}/v2.0",
      clientId: "access-assets-portal",
      status: "启用",
      strategy: "按 sub 优先绑定，其次 email 匹配",
    },
    {
      name: "企业自建 IdP",
      issuer: "https://idp.example.com",
      clientId: "asset-portal",
      status: "未启用",
      strategy: "仅允许手动绑定",
    },
  ],
  oidcClaims: [
    ["sub", "externalSubject", "外部身份唯一 ID，优先用于绑定"],
    ["email", "email", "匹配本地用户邮箱，未命中时可自动新增"],
    ["name", "name", "用户姓名"],
    ["preferred_username", "account", "系统登录账号"],
    ["department", "department", "部门，可来自 IdP 或通讯录同步"],
    ["groups / roles", "role", "仅可映射为普通管理员或普通员工，超级管理员必须手机号注册"],
  ],
  pendingIdentities: [
    {
      provider: "Feishu OIDC",
      subject: "feishu:ou_new_7788",
      email: "chenjie@example.com",
      name: "陈杰",
      department: "销售部",
      suggestion: "新增普通员工",
      suggestedAction: "create_employee",
      targetAccount: "",
    },
    {
      provider: "Microsoft Entra ID",
      subject: "aad:assigned-admin",
      email: "asset.admin@example.com",
      name: "普通管理员A",
      department: "信息中心",
      suggestion: "绑定到普通管理员",
      suggestedAction: "bind_existing",
      targetAccount: "asset.admin",
    },
  ],
};

const assetSettingSections = [
  {
    id: "assetLocationSettings",
    label: "位置管理",
    metric: `${assetLocationOptions.length} 个位置`,
    description: "维护公司、仓库、楼层等资产存放位置。",
  },
  {
    id: "assetCategorySettings",
    label: "资产分类",
    metric: `${flattenAssetCategoryTree().length} 个分类`,
    description: "维护资产大类、默认字段和分类启用状态。",
  },
  {
    id: "assetCodeRules",
    label: "资产编码规则",
    metric: "自动编号",
    description: "配置资产编码前缀、流水号位数和生成规则。",
  },
  {
    id: "assetLabelTemplateSettings",
    label: "标签模板设置",
    metric: `${assetLabelTemplates.length} 套模板`,
    description: "配置资产标签尺寸、打印字段和二维码内容。",
  },
];

const homeNavIcon = `<svg class="nav-home-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <g transform="translate(0 -1.5)">
    <path d="M8.5 22.4 24 9.5l15.5 12.9v16.1a3 3 0 0 1-3 3h-25a3 3 0 0 1-3-3V22.4Z" fill="currentColor"/>
    <path d="M20 29.5a4 4 0 0 1 8 0v12h-8v-12Z" fill="#ffffff"/>
  </g>
</svg>`;

const assetNavIcon = `<svg class="nav-asset-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <g transform="translate(0 -0.5) translate(24 24.5) scale(1.1) translate(-24 -24.5)">
    <rect x="10" y="10" width="28" height="21" rx="3.5" fill="currentColor"/>
    <path d="M18.5 20.5h11" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
    <path d="M22 31h4v5h8v3H14v-3h8v-5Z" fill="currentColor"/>
  </g>
</svg>`;

const approvalNavIcon = `<svg class="nav-approval-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <g transform="translate(-3.1 -0.75) translate(27.1 24.75) scale(1.08 .93) translate(-27.1 -24.75)">
    <path d="M13 7.5h19.5l5.5 5.8V35a3.5 3.5 0 0 1-3.5 3.5h-18A3.5 3.5 0 0 1 13 35V7.5Z" fill="currentColor"/>
    <path d="M31.8 7.5v6.2h6.2" fill="#ffffff" opacity=".9"/>
    <path d="M18.5 17h11.5M18.5 23h11.5M18.5 29h7.5" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="33.5" cy="33" r="4.8" fill="currentColor" stroke="#ffffff" stroke-width="2.4"/>
    <path d="M25.8 42c1.4-4.1 4.3-6 7.7-6s6.3 1.9 7.7 6H25.8Z" fill="currentColor" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/>
  </g>
</svg>`;

const applicationNavIcon = `<svg class="nav-application-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <g transform="translate(1 -1)">
    <path d="M13 7.5h19.5l5.5 5.8V30a3.5 3.5 0 0 1-3.5 3.5h-18A3.5 3.5 0 0 1 13 30V7.5Z" fill="currentColor"/>
    <path d="M31.8 7.5v6.2h6.2" fill="#ffffff" opacity=".9"/>
    <path d="M18.5 17h11M18.5 23h8.2M18.5 29h5" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M29.5 34.4 38 25.9l3.6 3.6-8.5 8.5-4.8 1.2 1.2-4.8Z" fill="currentColor" stroke="#ffffff" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="m36.2 27.7 3.6 3.6" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
  </g>
</svg>`;

const systemNavIcon = `<svg class="nav-system-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <g transform="translate(0 -2) translate(24 26) scale(.8) translate(-24 -26)">
    <path d="M21.1 6h5.8l1.1 5.1c1.2.4 2.3.9 3.3 1.6l4.4-2.8 4.1 4.1-2.8 4.4c.7 1 1.2 2.2 1.6 3.3l5.1 1.1v5.8l-5.1 1.1c-.4 1.2-.9 2.3-1.6 3.3l2.8 4.4-4.1 4.1-4.4-2.8c-1 .7-2.2 1.2-3.3 1.6L26.9 46h-5.8l-1.1-5.1c-1.2-.4-2.3-.9-3.3-1.6l-4.4 2.8-4.1-4.1 2.8-4.4c-.7-1-1.2-2.2-1.6-3.3L4.3 29.2v-5.8l5.1-1.1c.4-1.2.9-2.3 1.6-3.3L8.2 14.6l4.1-4.1 4.4 2.8c1-.7 2.2-1.2 3.3-1.6L21.1 6Z" fill="currentColor"/>
    <circle cx="24" cy="26.3" r="6.2" fill="#ffffff"/>
  </g>
</svg>`;

const nav = [
  {
    id: "home",
    label: "首页",
    icon: homeNavIcon,
    roles: ["super_admin", "admin", "employee"],
  },
  {
    id: "assets",
    label: "资产",
    icon: assetNavIcon,
    landingRoute: "assets",
    roles: ["super_admin", "admin", "employee"],
    children: [
      { id: "assets", label: "资产列表", roles: ["super_admin", "admin", "employee"] },
      { id: "assetInbound", label: "资产入库", roles: ["super_admin", "admin"] },
      { id: "assetReceiveReturn", label: "领用退库", roles: ["super_admin", "admin"] },
      { id: "assetBorrowReturn", label: "借用归还", roles: ["super_admin", "admin"] },
      { id: "stocktake", label: "资产盘点", roles: ["super_admin", "admin"] },
      {
        id: "assetSettings",
        label: "资产设置",
        landingRoute: "assetLocationSettings",
        roles: ["super_admin", "admin"],
        children: assetSettingSections.map((section) => ({
          id: section.id,
          label: section.label,
          roles: ["super_admin", "admin"],
        })),
      },
    ],
  },
  {
    id: "requests",
    label: "审批",
    icon: approvalNavIcon,
    roles: ["super_admin", "admin", "employee"],
  },
  {
    id: "settings",
    label: "系统",
    icon: systemNavIcon,
    roles: ["super_admin", "admin"],
  },
];

const page = document.querySelector("#page");
const navEl = document.querySelector("#nav");
const sidebar = document.querySelector(".sidebar");
const secondarySidebar = document.querySelector("#secondarySidebar");
const sidebarTools = document.querySelector("#sidebarTools");
const topbarActions = document.querySelector(".topbar-actions");
const drawer = document.querySelector("#drawer");
const drawerBackdrop = document.querySelector("#drawerBackdrop");
const drawerClose = document.querySelector("#drawerClose");
const drawerTitle = document.querySelector("#drawerTitle");
const drawerEyebrow = document.querySelector("#drawerEyebrow");
const drawerBody = document.querySelector("#drawerBody");
const modal = document.querySelector("#modal");
const modalBackdrop = document.querySelector("#modalBackdrop");
const modalClose = document.querySelector("#modalClose");
const modalTitle = document.querySelector("#modalTitle");
const modalBody = document.querySelector("#modalBody");
let roleEventsBound = false;
const toast = document.querySelector("#toast");
let searchRenderTimer = null;
let toastTimer = null;
let assetPickerState = null;
let assetLabelPreviewAssets = [];
let pendingProfileAvatar = "";

function money(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cssEscape(value = "") {
  return window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replaceAll('"', '\\"');
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function avatarText(name = "验") {
  return name.trim().slice(0, 1) || "验";
}

function accountInitial(name = "") {
  const text = String(name || "").trim();
  const ascii = text.match(/[a-zA-Z0-9]/);
  return (ascii ? ascii[0] : text.slice(0, 1) || "a").toLowerCase();
}

function avatarMarkup(user, className = "avatar") {
  const src = user?.avatar || "";
  const label = accountInitial(user?.name || "");
  return `<span class="${className} avatar" ${src ? `style="background-image:url('${escapeHtml(src)}')"` : ""}>${src ? "" : escapeHtml(label)}</span>`;
}

function readProfileOverrides() {
  try {
    return JSON.parse(localStorage.getItem("assetPortalProfileOverrides") || "{}") || {};
  } catch {
    return {};
  }
}

function writeProfileOverrides(overrides) {
  localStorage.setItem("assetPortalProfileOverrides", JSON.stringify(overrides || {}));
}

function applyProfileOverridesToUser(user) {
  if (!user?.account) return user;
  const overrides = readProfileOverrides()[user.account];
  return overrides ? { ...user, ...overrides } : user;
}

function saveUserProfileOverride(account, values) {
  const overrides = readProfileOverrides();
  overrides[account] = { ...(overrides[account] || {}), ...values };
  writeProfileOverrides(overrides);
}

function shortProviderName(provider = "") {
  return provider.replace("OIDC / ", "").replace(" OIDC", "");
}

function statusTag(status) {
  const map = {
    空闲: "blue",
    在用: "green",
    闲置: "blue",
    上架: "blue",
    借用中: "amber",
    交接待签字: "amber",
    维修中: "amber",
    报废: "red",
    审批中: "amber",
    待执行: "blue",
    已完成: "green",
    盘点中: "amber",
    已驳回: "red",
  };
  return `<span class="tag ${map[status] || "gray"}">${status}</span>`;
}

function roleBadge(roleCode) {
  const meta = roleMeta[roleCode];
  return `<span class="tag ${meta?.tone || "gray"}">${meta?.name || roleCode}</span>`;
}

function policyBadge(policy) {
  const tone =
    policy === "可免审" ? "green" : policy === "需审批" ? "amber" : policy === "只读" ? "gray" : "blue";
  return `<span class="tag ${tone}">${policy}</span>`;
}

function uniqueAssetValues(key, rows = state.assets) {
  return ["全部", ...Array.from(new Set(rows.map((item) => item[key]).filter(Boolean)))];
}

function uniqueTags(rows = state.assets) {
  return ["全部", ...Array.from(new Set(rows.flatMap((item) => item.tags || [])))];
}

function uniqueAssetFormValues(key) {
  return Array.from(new Set(state.assets.map((item) => item[key]).filter(Boolean)));
}

function assetCategoryFormOptions(extra = []) {
  const configured = flattenAssetCategoryTree()
    .filter((node) => !node.children?.length)
    .map((node) => node.name);
  return Array.from(new Set([...configured, ...extra].filter(Boolean)));
}

function isManagedAssetLocation(location) {
  return resolveManagedAssetLocation(location).valid;
}

function optionList(values, selected) {
  return values
    .map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${value}</option>`)
    .join("");
}

function locationOptionList(selected = "", options = {}) {
  const { includeAll = false, placeholder = "" } = options;
  const normalizedSelected = normalizeLocationValue(selected);
  return [
    includeAll ? `<option value="全部" ${selected === "全部" ? "selected" : ""}>全部</option>` : "",
    placeholder ? `<option value="" ${selected ? "" : "selected"}>${escapeHtml(placeholder)}</option>` : "",
    ...assetLocationTree.map(
      (group) =>
        `<optgroup label="${escapeHtml(group.name)}">${flattenLocationTree([group])
          .filter((node) => node.enabled !== false)
          .map((node) => {
            return `<option value="${escapeHtml(node.path)}" ${node.path === normalizedSelected ? "selected" : ""}>${escapeHtml(`${"　".repeat(node.level)}${node.name}`)}</option>`;
          })
          .join("")}</optgroup>`
    ),
  ].join("");
}

function optionListWithPlaceholder(values, placeholder = "请选择", selected = "") {
  return [
    `<option value="" ${selected ? "" : "selected"} disabled>${escapeHtml(placeholder)}</option>`,
    ...values.map(
      (value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`
    ),
  ].join("");
}

function placeholderSelect(name, placeholder, values, options = {}) {
  const { required = false, selected = "" } = options;
  return `<select name="${escapeHtml(name)}" class="${selected ? "" : "placeholder-select"}" ${required ? "required" : ""}>${optionListWithPlaceholder(
    values,
    placeholder,
    selected
  )}</select>`;
}

function inlineSelect(name, placeholder, values, options = {}) {
  const { required = false, selected = "" } = options;
  const isLocationSelect = values === assetLocationOptions || options.variant === "location";
  const normalizedSelected = isLocationSelect ? normalizeLocationValue(selected) : selected;
  const label = normalizedSelected || placeholder;
  const isAssetCategorySelect = options.variant === "asset-category";
  const selectedCategoryRoot = isAssetCategorySelect
    ? assetCategoryTree.find((group) => flattenAssetCategoryTree([group]).some((node) => node.name === selected))?.id || ""
    : "";
  const renderOption = (value, extraClass = "", display = value) =>
    `<button type="button" class="${value === normalizedSelected ? "selected" : ""} ${extraClass}" data-inline-select-option data-value="${escapeHtml(value)}">${escapeHtml(display)}</button>`;
  const renderLocationOptions = () =>
    assetLocationTree
      .filter((group) => group.enabled !== false)
      .map((group) => {
        const children = flattenLocationTree(group.children || [], group, [group.name]).filter((node) => node.enabled !== false);
        const childMarkup = children
          .map((node) => renderOption(node.path, "inline-select-tree-option location-option location-child-option", `${"　".repeat(node.level)}${node.name}`))
          .join("");
        return `<div class="inline-select-tree-group location-tree-group is-collapsed" data-inline-select-tree-group>
          <div class="inline-select-location-row">
            ${renderOption(group.name, "inline-select-tree-option location-option location-root-option", group.name)}
            ${
              children.length
                ? `<button type="button" class="inline-select-group-toggle location-expand-toggle" data-inline-select-group-toggle aria-expanded="false" aria-label="展开${escapeHtml(group.name)}">
                    <span class="inline-select-group-caret" aria-hidden="true">›</span>
                  </button>`
                : ""
            }
          </div>
          ${children.length ? `<template data-inline-select-tree-template>${childMarkup}</template><div class="inline-select-tree-children" data-inline-select-tree-children hidden></div>` : ""}
        </div>`;
      })
      .join("");
  const renderCategoryOptions = () => {
    const availableValues = new Set(values);
    const renderedValues = new Set();
    const renderNodes = (nodes, level = 0) =>
      nodes
        .map((node) => {
          const hasChildren = Boolean(node.children?.length);
          const selectable = availableValues.has(node.name);
          const containsSelected = node.name === selected || flattenAssetCategoryTree(node.children || []).some((child) => child.name === selected);
          if (!hasChildren) {
            if (!selectable) return "";
            renderedValues.add(node.name);
            return renderOption(node.name, "inline-select-tree-option", `${"　".repeat(level)}${node.name}`);
          }
          const childMarkup = renderNodes(node.children || [], level + 1);
          const selfMarkup = selectable ? renderOption(node.name, "inline-select-tree-option", `${"　".repeat(level + 1)}${node.name}`) : "";
          if (selectable) renderedValues.add(node.name);
          if (!childMarkup && !selfMarkup) return "";
          const isExpanded = node.id === selectedCategoryRoot || containsSelected;
          return `<div class="inline-select-tree-group ${isExpanded ? "is-expanded" : "is-collapsed"}" data-inline-select-tree-group>
            <button type="button" class="inline-select-group-toggle" data-inline-select-group-toggle aria-expanded="${isExpanded ? "true" : "false"}">
              <span class="inline-select-group-caret" aria-hidden="true">›</span>
              <span>${escapeHtml(node.name)}</span>
            </button>
            <div class="inline-select-tree-children" data-inline-select-tree-children ${isExpanded ? "" : "hidden"}>
              ${selfMarkup}${childMarkup}
            </div>
          </div>`;
        })
        .join("");
    const treeMarkup = renderNodes(assetCategoryTree);
    const fallbackMarkup = values.filter((value) => !renderedValues.has(value)).map((value) => renderOption(value)).join("");
    return `${treeMarkup}${fallbackMarkup}`;
  };
  return `<div class="inline-select ${selected ? "" : "is-placeholder"}" data-inline-select data-required="${required ? "true" : "false"}">
    <button type="button" class="inline-select-trigger" data-inline-select-trigger aria-expanded="false">
      <span data-inline-select-label>${escapeHtml(label)}</span>
      <span class="inline-select-caret" aria-hidden="true">⌄</span>
    </button>
    <div class="inline-select-menu" hidden>
      ${
        isLocationSelect
          ? renderLocationOptions()
          : isAssetCategorySelect
            ? renderCategoryOptions()
          : values.map((value) => renderOption(value)).join("")
      }
    </div>
    <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(normalizedSelected)}" data-inline-select-input>
  </div>`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "凌晨好";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function isAuthenticated() {
  return Boolean(state.session.authenticated && state.currentUser);
}

function readLocalSession() {
  try {
    return JSON.parse(localStorage.getItem(localSessionStorageKey) || "null");
  } catch {
    return null;
  }
}

function writeLocalSession(session) {
  localStorage.setItem(localSessionStorageKey, JSON.stringify(session));
}

function clearLocalSession() {
  localStorage.removeItem(localSessionStorageKey);
}

function routeFromHash() {
  return decodeURIComponent(window.location.hash.replace(/^#\/?/, "").trim());
}

function readPersistedRoute() {
  return routeFromHash() || localStorage.getItem(routeStorageKey) || "";
}

function persistRoute(route = state.route) {
  if (!route) return;
  localStorage.setItem(routeStorageKey, route);
  const nextHash = `#${encodeURIComponent(route)}`;
  if (window.location.hash !== nextHash) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
  }
}

function closeAccountMenus() {
  document.querySelectorAll("[data-account-menu].open").forEach((menu) => {
    menu.classList.remove("open");
    menu.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", "false");
  });
}

function clearPersistedRoute() {
  localStorage.removeItem(routeStorageKey);
  if (window.location.hash) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
}

function saveLocalSession() {
  if (!isAuthenticated()) return;
  writeLocalSession({
    account: state.currentUser.account,
    method: state.session.method || "local",
    provider: state.session.provider || "本地账号",
    terminal: state.session.terminal || state.selectedTerminal || "web_pc",
    lastLoginAt: state.session.lastLoginAt,
    lastActiveAt: Date.now(),
    route: state.route,
    assetSubnavScrollTop: state.assetSubnavScrollTop || 0,
  });
}

function scheduleIdleLogout() {
  if (idleLogoutTimer) window.clearTimeout(idleLogoutTimer);
  if (!isAuthenticated()) return;
  const session = readLocalSession();
  const lastActiveAt = Number(session?.lastActiveAt || Date.now());
  const remaining = Math.max(sessionIdleLimitMs - (Date.now() - lastActiveAt), 0);
  idleLogoutTimer = window.setTimeout(() => {
    logout({ reason: "idle" });
  }, remaining);
}

function touchSessionActivity() {
  if (!isAuthenticated()) return;
  const session = readLocalSession();
  if (!session?.account) return;
  session.lastActiveAt = Date.now();
  writeLocalSession(session);
  scheduleIdleLogout();
}

function restoreLocalSession() {
  const session = readLocalSession();
  if (!session?.account) return false;
  if (Date.now() - Number(session.lastActiveAt || 0) >= sessionIdleLimitMs) {
    clearLocalSession();
    return false;
  }
  const user = state.users.find((item) => item.account === session.account);
  if (!user) {
    clearLocalSession();
    return false;
  }
  state.currentUser = { ...applyProfileOverridesToUser(user) };
  state.selectedTerminal = session.terminal || state.selectedTerminal || "web_pc";
  state.session = {
    authenticated: true,
    method: session.method || "local",
    provider: session.provider || "本地账号",
    terminal: state.selectedTerminal,
    lastLoginAt: session.lastLoginAt || new Date().toLocaleString("zh-CN", { hour12: false }),
  };
  state.authView = "login";
  state.pendingAuth = null;
  state.route = readPersistedRoute() || session.route || firstAccessibleRoute();
  state.assetSubnavScrollTop = Number(session.assetSubnavScrollTop || 0);
  touchSessionActivity();
  return true;
}

function currentRoleMeta() {
  return state.currentUser ? roleMeta[state.currentUser.roleCode] : null;
}

function currentTerminalMeta() {
  return terminalMeta[state.session.terminal] || terminalMeta.web_pc;
}

function resetAssetFilters() {
  state.assetFilters = {
    category: "全部",
    status: "全部",
    tag: "全部",
    location: "全部",
    risk: "全部",
  };
  state.advancedAssetFilters = defaultAdvancedAssetFilters();
  state.advancedInboundFilters = defaultAdvancedInboundFilters();
  state.advancedReceiveReturnFilters = defaultAdvancedReceiveReturnFilters();
  state.advancedBorrowReturnFilters = defaultAdvancedBorrowReturnFilters();
}

function resetSessionView() {
  state.query = "";
  state.assetListQuery = "";
  state.assetInboundQuery = "";
  state.assetReceiveReturnQuery = "";
  state.assetBorrowReturnQuery = "";
  state.assetListPage = 1;
  state.assetInboundPage = 1;
  state.assetReceiveReturnPage = 1;
  state.assetBorrowReturnPage = 1;
  state.navOpen = {};
  resetAssetFilters();
  closeDrawer();
  closeModal();
}

function getAccessibleNav(items = nav) {
  if (!isAuthenticated()) return [];
  const role = state.currentUser.roleCode;
  return items
    .filter((item) => !item.roles || item.roles.includes(role))
    .map((item) => ({
      ...item,
      children: getAccessibleNav(item.children || []),
    }));
}

function flattenNav(items = getAccessibleNav()) {
  return items.flatMap((item) => [item, ...flattenNav(item.children || [])]);
}

function getPrimaryNavItems() {
  const items = getAccessibleNav();
  if (state.currentUser?.roleCode !== "employee") return items;
  return items
    .filter((item) => item.id !== "assets")
    .map((item) => (item.id === "requests" ? { ...item, label: "申请", icon: applicationNavIcon } : item));
}

function normalizeRoute(route) {
  if (route === "assetArchives") return "assetLocationSettings";
  if (route === "assetTemplateManagement") return "assetLocationSettings";
  if (route === "assetExtendedInfo") return "assetLocationSettings";
  const accessible = flattenNav(getAccessibleNav());
  const group = accessible.find((item) => item.id === route && (item.landingRoute || item.children?.length));
  if (!group) return route;
  if (group.landingRoute && accessible.some((item) => item.id === group.landingRoute)) return group.landingRoute;
  return flattenNav(group.children || [])[0]?.id || group.landingRoute || route;
}

function routeAllowed(route) {
  const normalized = normalizeRoute(route);
  return flattenNav().some((item) => item.id === normalized);
}

function firstAccessibleRoute() {
  return flattenNav().find((item) => item.id === "home")?.id || flattenNav()[0]?.id || "home";
}

function preferredAccessibleRoute(fallback = firstAccessibleRoute()) {
  const preferred = normalizeRoute(readPersistedRoute());
  return preferred && routeAllowed(preferred) ? preferred : fallback;
}

function ensureAccessibleRoute() {
  if (!isAuthenticated()) return;
  if (!routeAllowed(state.route)) {
    state.route = preferredAccessibleRoute();
  }
  if (!routeAllowed(state.route)) {
    state.route = firstAccessibleRoute();
  }
  persistRoute(state.route);
}

function ensureNavOpenForRoute() {
  const accessible = getAccessibleNav();
  accessible.forEach((item) => {
    if (flattenNav(item.children || []).some((child) => child.id === state.route) && typeof state.navOpen[item.id] === "undefined") {
      state.navOpen[item.id] = true;
    }
  });
}

function findNavParentByRoute(route) {
  return flattenNav(getAccessibleNav()).find((item) => item.children?.some((child) => child.id === route));
}

function routeTitle() {
  if (!isAuthenticated()) {
    return state.authView === "bind" ? "身份绑定确认" : "登录入口";
  }
  return flattenNav().find((item) => item.id === state.route)?.label || "首页";
}

function setRoute(route) {
  if (!isAuthenticated()) return;
  captureAssetSubnavScroll();
  const normalized = normalizeRoute(route);
  if (!routeAllowed(normalized)) {
    showToast("当前登录角色没有该页面权限");
    return;
  }
  state.route = normalized;
  const parent = findNavParentByRoute(normalized);
  if (parent && parent.id !== "assetSettings") {
    state.navOpen[parent.id] = true;
  }
  persistRoute(state.route);
  saveLocalSession();
  render();
}

function toggleNavGroup(groupId) {
  captureAssetSubnavScroll();
  state.navOpen[groupId] = !state.navOpen[groupId];
  saveLocalSession();
  render();
}

function isNavGroupActive(groupId) {
  const group = flattenNav(getAccessibleNav()).find((item) => item.id === groupId);
  if (!group) return false;
  const childActive = flattenNav(group.children || []).some((child) => normalizeRoute(child.id) === state.route);
  return normalizeRoute(group.id) === state.route || childActive;
}

function isNavGroupOpen(groupId) {
  return typeof state.navOpen[groupId] === "boolean" ? state.navOpen[groupId] : isNavGroupActive(groupId);
}

function toggleAssetSubnavGroup(groupId) {
  captureAssetSubnavScroll();
  state.navOpen[groupId] = !isNavGroupOpen(groupId);
  saveLocalSession();
  updateAssetSubnavGroupDom(groupId);
}

function updateAssetSubnavGroupDom(groupId) {
  const group = document.querySelector(`[data-asset-subnav-group="${CSS.escape(groupId)}"]`);
  if (!group) {
    render();
    return;
  }
  const open = isNavGroupOpen(groupId);
  group.classList.toggle("open", open);
  group.querySelector("[data-asset-subnav-toggle]")?.setAttribute("aria-expanded", open ? "true" : "false");
  group.querySelector(".asset-subnav-children")?.setAttribute("aria-hidden", open ? "false" : "true");
}

function showToast(message) {
  console.info("[asset-portal]", message);
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

function bindPlaceholderSelects(root = document) {
  root.querySelectorAll("select.placeholder-select, select[data-placeholder-select]").forEach((el) => {
    el.dataset.placeholderSelect = "true";
    el.classList.toggle("placeholder-select", !el.value);
    el.addEventListener("change", () => {
      el.classList.toggle("placeholder-select", !el.value);
    });
  });
}

function closeInlineSelect(select) {
  select.classList.remove("is-open");
  select.querySelector("[data-inline-select-trigger]")?.setAttribute("aria-expanded", "false");
  resetLocationInlineSelect(select);
  const menu = select.querySelector(".inline-select-menu");
  if (menu) menu.hidden = true;
}

function closeAllInlineSelects() {
  document.querySelectorAll("[data-inline-select].is-open").forEach(closeInlineSelect);
}

function openInlineSelect(select) {
  select.closest("form")?.querySelectorAll("[data-inline-select].is-open").forEach((item) => {
    if (item !== select) closeInlineSelect(item);
  });
  resetLocationInlineSelect(select);
  select.classList.add("is-open");
  select.querySelector("[data-inline-select-trigger]")?.setAttribute("aria-expanded", "true");
  const menu = select.querySelector(".inline-select-menu");
  if (menu) menu.hidden = false;
}

function resetLocationInlineSelect(select) {
  select.querySelectorAll(".location-tree-group").forEach((group) => {
    group.classList.remove("is-expanded");
    group.classList.add("is-collapsed");
    group.querySelector("[data-inline-select-group-toggle]")?.setAttribute("aria-expanded", "false");
    const children = group.querySelector("[data-inline-select-tree-children]");
    if (children) children.hidden = true;
  });
}

function bindInlineSelects(root = document) {
  root.querySelectorAll("[data-inline-select]").forEach((select) => {
    if (select.dataset.inlineSelectBound === "true") return;
    select.dataset.inlineSelectBound = "true";
    const trigger = select.querySelector("[data-inline-select-trigger]");
    const input = select.querySelector("[data-inline-select-input]");
    const label = select.querySelector("[data-inline-select-label]");
    const selectName = input?.name || "";

    trigger?.addEventListener("click", () => {
      if (select.classList.contains("is-open")) {
        closeInlineSelect(select);
      } else {
        openInlineSelect(select);
      }
    });

    select.querySelectorAll("[data-inline-select-group-toggle]").forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const group = toggle.closest("[data-inline-select-tree-group]");
        const children = group?.querySelector("[data-inline-select-tree-children]");
        const isExpanded = toggle.getAttribute("aria-expanded") === "true";
        if (selectName === "location" && !isExpanded && children && !children.dataset.rendered) {
          children.innerHTML = group?.querySelector("[data-inline-select-tree-template]")?.innerHTML || "";
          children.dataset.rendered = "true";
          children.querySelectorAll("[data-inline-select-option]").forEach((option) => {
            option.addEventListener("click", () => {
              const value = option.dataset.value || "";
              if (input) input.value = value;
              if (label) label.textContent = value;
              select.classList.remove("is-placeholder", "is-invalid");
              select.querySelectorAll("[data-inline-select-option]").forEach((item) => item.classList.toggle("selected", item === option));
              closeInlineSelect(select);
            });
          });
        }
        toggle.setAttribute("aria-expanded", isExpanded ? "false" : "true");
        group?.classList.toggle("is-expanded", !isExpanded);
        group?.classList.toggle("is-collapsed", isExpanded);
        if (children) children.hidden = isExpanded;
      });
    });

    select.querySelectorAll("[data-inline-select-option]").forEach((option) => {
      option.addEventListener("click", () => {
        const value = option.dataset.value || "";
        if (input) input.value = value;
        if (label) label.textContent = value;
        select.classList.remove("is-placeholder", "is-invalid");
        select.querySelectorAll("[data-inline-select-option]").forEach((item) => item.classList.toggle("selected", item === option));
        if (selectName === "category") applyAssetCategorySelection(select.closest("form"), value);
        closeInlineSelect(select);
      });
    });
  });
}

function applyAssetCategorySelection(form, category) {
  if (!form || !category) return;
  const defaults = assetCategoryDefaultsForName(category);
  const unitInput = form.querySelector("[data-category-unit-input]");
  const usefulLifeInput = form.querySelector("[data-category-useful-life-input]");
  const codeInput = form.querySelector("[data-asset-code-input]");
  if (unitInput && defaults.unit) unitInput.value = defaults.unit;
  if (usefulLifeInput && defaults.usefulLife !== "") usefulLifeInput.value = defaults.usefulLife;
  if (codeInput && !codeInput.readOnly && (!codeInput.value.trim() || codeInput.dataset.autoGeneratedAssetCode === "true")) {
    codeInput.value = generateAssetCode(category);
    codeInput.dataset.autoGeneratedAssetCode = "true";
  }
}

function bindAssetCodeInputs(root = document) {
  root.querySelectorAll("[data-asset-code-input]").forEach((input) => {
    if (input.dataset.assetCodeBound === "true" || input.readOnly) return;
    input.dataset.assetCodeBound = "true";
    input.addEventListener("input", () => {
      input.dataset.autoGeneratedAssetCode = input.value.trim() ? "false" : "";
    });
  });
}

function validateInlineSelects(form) {
  const invalid = Array.from(form.querySelectorAll("[data-inline-select][data-required='true']")).find((select) => {
    return !select.querySelector("[data-inline-select-input]")?.value;
  });
  if (!invalid) return true;
  invalid.classList.add("is-invalid");
  openInlineSelect(invalid);
  showToast("请选择必填的下拉字段");
  return false;
}

function canDirectHandle(asset, action = "") {
  if (!state.currentUser) return false;
  if (["super_admin", "admin"].includes(state.currentUser.roleCode)) return true;
  return false;
}

function assetActionLabel(asset, action) {
  return canDirectHandle(asset, action) ? `直办${action}` : `申请${action}`;
}

function getScopedAssets(rows = state.assets) {
  return getScopedAllAssets(rows).filter((item) => item.inboundStatus !== "已取消");
}

function getScopedAllAssets(rows = state.assets) {
  if (!state.currentUser) return [];
  const role = state.currentUser.roleCode;

  if (["super_admin", "admin"].includes(role)) return rows;

  if (role === "employee") {
    return rows.filter(
      (item) =>
        item.owner === state.currentUser.name ||
        item.department === state.currentUser.department ||
        item.owner === "IT Department"
    );
  }

  return rows;
}

function getScopedRequests(rows = state.requests) {
  if (!state.currentUser) return [];
  const role = state.currentUser.roleCode;

  if (["super_admin", "admin"].includes(role)) return rows;
  if (role === "employee") return rows.filter((item) => item.applicant === state.currentUser.name);
  return rows;
}

function getScopedStocktakes(rows = state.stocktakes) {
  if (!state.currentUser) return [];
  if (state.currentUser.roleCode === "employee") return [];
  return rows;
}

function getScopedFailures() {
  const failures = getScopedAssets().filter((item) => item.status === "维修中");
  if (state.currentUser?.roleCode === "employee") {
    return failures.filter((item) => item.owner === state.currentUser.name || item.department === state.currentUser.department);
  }
  return failures;
}

function removePendingIdentity(subject) {
  state.pendingIdentities = state.pendingIdentities.filter((item) => item.subject !== subject);
}

function createAccountFromEmail(email) {
  const base = email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase() || "employee";
  let account = base;
  let cursor = 1;
  while (state.users.some((user) => user.account === account)) {
    account = `${base}${cursor}`;
    cursor += 1;
  }
  return account;
}

function createAccountFromName(name) {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase() || `user${Date.now().toString().slice(-6)}`;
  let account = base;
  let cursor = 1;
  while (state.users.some((user) => user.account === account)) {
    account = `${base}${cursor}`;
    cursor += 1;
  }
  return account;
}

function demoPasswordForUser(user) {
  return user?.password || "123456";
}

function findLoginUser(account = "") {
  const keyword = account.trim().toLowerCase();
  if (!keyword) return null;
  return state.users.find((user) => {
    return [user.account, user.phone, user.email].some((value) => String(value || "").toLowerCase() === keyword);
  });
}

function loginAsAccount(account, method = "local", provider = "本地账号") {
  const user = state.users.find((item) => item.account === account);
  if (!user) return;

  resetSessionView();
  state.currentUser = { ...applyProfileOverridesToUser(user) };
  state.session = {
    authenticated: true,
    method,
    provider,
    terminal: state.selectedTerminal,
    lastLoginAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
  state.authView = "login";
  state.pendingAuth = null;
  state.route = preferredAccessibleRoute();
  persistRoute(state.route);
  saveLocalSession();
  scheduleIdleLogout();
  render();
  showToast(`${method === "oidc" ? `已通过 ${shortProviderName(provider)} 登录` : "已进入本地账号演示"}：${user.name}`);
}

function handleLoginSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const account = String(form.elements.account?.value || "").trim();
  const password = String(form.elements.password?.value || "");
  const user = findLoginUser(account);
  if (!user) {
    showToast("账号不存在，请检查账号、手机号或邮箱");
    return;
  }
  if (password !== demoPasswordForUser(user)) {
    showToast("密码错误，演示密码为 123456");
    return;
  }
  loginAsAccount(user.account, "local", "账号密码登录");
}

function handleRegisterSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = String(form.elements.name?.value || "").trim();
  let account = String(form.elements.account?.value || "").trim().toLowerCase();
  const password = String(form.elements.password?.value || "");
  if (!name || !password) {
    showToast("请完整填写注册信息");
    return;
  }
  if (!account) account = createAccountFromName(name);
  if (password.length < 6) {
    showToast("密码至少 6 位");
    return;
  }
  if (findLoginUser(account)) {
    showToast("账号已存在，请换一个账号");
    return;
  }
  const user = {
    name,
    account,
    password,
    phone: "",
    email: account.includes("@") ? account : "",
    department: "默认部门",
    roleCode: "employee",
    roleName: "普通员工",
    scope: "本人资产与申请",
    loginType: "用户注册",
    identitySource: "本地注册",
    externalSubject: `local:${account}`,
    bindStatus: "已绑定",
  };
  state.users.push(user);
  saveRegisteredUsers();
  loginAsAccount(account, "local", "本地注册");
}

async function logout(options = {}) {
  await logoutBackendSession();
  if (idleLogoutTimer) {
    window.clearTimeout(idleLogoutTimer);
    idleLogoutTimer = null;
  }
  clearLocalSession();
  resetSessionView();
  state.currentUser = null;
  state.session = {
    ...state.session,
    authenticated: false,
    method: "local",
    provider: "默认管理后台",
  };
  state.authView = "login";
  state.pendingAuth = null;
  state.route = firstAccessibleRoute();
  clearPersistedRoute();
  render();
  showToast(options.reason === "idle" ? "已超过 10 分钟无操作，请重新登录" : "已退出登录");
}

function beginOidcLogin(subject) {
  const user = state.users.find((item) => item.externalSubject === subject);
  if (user) {
    loginAsAccount(user.account, "oidc", shortProviderName(user.identitySource));
    return;
  }

  const pending = state.pendingIdentities.find((item) => item.subject === subject);
  if (!pending) return;
  state.authView = "bind";
  state.pendingAuth = { ...pending };
  closeDrawer();
  closeModal();
  render();
}

async function beginFeishuOAuthLogin() {
  try {
    const response = await fetch("/api/auth/feishu/login", { credentials: "include" });
    if (!response.ok) throw new Error("无法获取飞书授权地址");
    const data = await response.json();
    if (data.authorizationUrl) {
      window.location.href = data.authorizationUrl;
    }
  } catch (error) {
    console.warn("[asset-portal] feishu oauth unavailable", error);
    showToast("飞书免登后端未启动或未配置");
  }
}

function applyBackendUser(authUser) {
  const roleCode = authUser.roleCode || "employee";
  const matched =
    state.users.find((user) => user.externalSubject === authUser.externalSubject) ||
    state.users.find((user) => authUser.email && user.email === authUser.email) ||
    state.users.find((user) => user.account === authUser.account);
  const user = matched || {
    name: authUser.name || "飞书用户",
    account: authUser.account || authUser.email || authUser.externalSubject || "feishu.user",
    phone: authUser.phone || "",
    email: authUser.email || "",
    department: authUser.department || "飞书组织",
    roleCode,
    roleName: roleMeta[roleCode]?.name || "普通员工",
    scope: roleMeta[roleCode]?.scope || "本人资产、个人申请和审批状态",
    loginType: "飞书免登",
    identitySource: "Feishu OAuth",
    externalSubject: authUser.externalSubject || "",
    bindStatus: "已绑定",
  };

  if (!matched) state.users.unshift(user);
  state.currentUser = { ...user };
  state.session = {
    authenticated: true,
    method: "oidc",
    provider: "Feishu OAuth",
    terminal: state.selectedTerminal,
    lastLoginAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
  state.authView = "login";
  state.pendingAuth = null;
  state.route = preferredAccessibleRoute();
  persistRoute(state.route);
  saveLocalSession();
  scheduleIdleLogout();
}

async function hydrateBackendSession() {
  try {
    const response = await fetch("/api/auth/me", { credentials: "include" });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data.authenticated || !data.user) return false;
    applyBackendUser(data.user);
    saveLocalSession();
    scheduleIdleLogout();
    return true;
  } catch (error) {
    console.info("[asset-portal] backend session unavailable");
    return false;
  }
}

async function logoutBackendSession() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    // Static preview mode does not have a backend.
  }
}

function handlePendingAuth(action) {
  const pending = state.pendingAuth;
  if (!pending) return;

  if (action === "back") {
    state.authView = "login";
    state.pendingAuth = null;
    render();
    return;
  }

  if (action === "queue") {
    state.authView = "login";
    state.pendingAuth = null;
    render();
    showToast("该身份已保留在待处理队列");
    return;
  }

  if (action === "create") {
    const account = createAccountFromEmail(pending.email);
    state.users.unshift({
      name: pending.name,
      account,
      email: pending.email,
      department: pending.department,
      roleCode: "employee",
      roleName: "普通员工",
      scope: "本人资产与申请",
      loginType: "OIDC 新用户",
      identitySource: `OIDC / ${shortProviderName(pending.provider)}`,
      externalSubject: pending.subject,
      bindStatus: "已绑定",
    });
    state.requests.unshift({
      id: `REQ${Date.now().toString().slice(-10)}`,
      type: "资产领用",
      applicant: pending.name,
      asset: "新员工办公套餐",
      reason: "首次 OIDC 登录后自动创建本地用户",
      status: "审批中",
      system: "飞书审批",
      date: todayValue(),
      currentNode: "普通管理员",
    });
    removePendingIdentity(pending.subject);
    loginAsAccount(account, "oidc", pending.provider);
    return;
  }

  if (action === "bind") {
    const targetUser = state.users.find((item) => item.account === pending.targetAccount);
    if (!targetUser) return;
    targetUser.identitySource = `OIDC / ${shortProviderName(pending.provider)}`;
    targetUser.externalSubject = pending.subject;
    targetUser.bindStatus = "已绑定";
    removePendingIdentity(pending.subject);
    loginAsAccount(targetUser.account, "oidc", pending.provider);
  }
}

function renderAccountMenu() {
  const user = state.currentUser;
  if (!user) return "";
  return `<div class="account-menu sidebar-account-menu" data-account-menu>
    <button class="account-entry sidebar-account-entry" type="button" data-account-toggle aria-expanded="false" title="${escapeHtml(user.name)}" aria-label="账号管理">
      ${avatarMarkup(user, "account-avatar")}
      <span class="account-entry-text">
        <strong>${escapeHtml(user.name)}</strong>
        <span>${escapeHtml(user.roleName)}</span>
      </span>
    </button>
    <div class="account-popover" data-account-popover>
      <div class="account-profile">
        <div class="account-profile-main">
          <strong>${escapeHtml(user.name)}</strong>
        </div>
      </div>
      <div class="account-panel-line"></div>
      <div class="account-actions-grid">
        <button type="button" data-account-profile>
          <span class="account-action-icon account-action-user" aria-hidden="true"></span>
          <span>个人中心</span>
        </button>
      </div>
      <button class="account-logout" type="button" data-logout>退出登录</button>
    </div>
  </div>`;
}

function profileCenterMarkup() {
  const user = state.currentUser;
  if (!user) return "";
  pendingProfileAvatar = user.avatar || "";
  return `<form id="demoForm" class="profile-center-form" data-mode="profile-center">
    <section class="profile-center-head">
      <label class="profile-avatar-uploader">
        ${avatarMarkup(user, "profile-avatar-preview")}
        <input type="file" accept="image/*" data-profile-avatar-input hidden>
        <span>上传头像</span>
      </label>
      <div>
        <h3>${escapeHtml(user.name)}</h3>
        <p>${escapeHtml(user.roleName || "-")} · ${escapeHtml(user.department || "默认部门")}</p>
      </div>
    </section>

    <section class="profile-center-section">
      <h4>个人信息</h4>
      <div class="profile-center-grid">
        <label class="profile-field">
          <span>账户名</span>
          <input name="profileName" value="${escapeHtml(user.name || "")}" autocomplete="name">
        </label>
        <label class="profile-field">
          <span>登录账号</span>
          <input value="${escapeHtml(user.account || "-")}" readonly>
        </label>
        <label class="profile-field">
          <span>所属部门</span>
          <input value="${escapeHtml(user.department || "-")}" readonly>
        </label>
        <label class="profile-field">
          <span>邮箱</span>
          <input value="${escapeHtml(user.email || "-")}" readonly>
        </label>
      </div>
    </section>

    <section class="profile-center-section">
      <h4>手机号绑定</h4>
      <div class="profile-phone-row">
        <label class="profile-field">
          <span>手机号</span>
          <input name="profilePhone" inputmode="tel" placeholder="未绑定" value="${escapeHtml(user.phone || "")}">
        </label>
        <button class="btn" type="button" data-profile-unbind-phone ${user.phone ? "" : "disabled"}>解绑手机号</button>
      </div>
      <p class="profile-center-note">${user.phone ? "修改后保存即可重新绑定手机号。" : "输入手机号并保存即可完成绑定。"}</p>
    </section>

    <div class="modal-actions profile-center-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">保存</button>
    </div>
  </form>`;
}

function openProfileCenter() {
  if (!state.currentUser) return;
  closeAccountMenus();
  modalTitle.textContent = "个人中心";
  modal.classList.add("profile-center-modal");
  modal.classList.remove("location-modal", "asset-create-modal", "asset-flow-modal", "asset-import-modal", "print-preview-modal", "asset-label-print-modal");
  modalBody.innerHTML = profileCenterMarkup();
  openModal();
}

function bindProfileCenterControls(root = modal) {
  const form = root.querySelector(".profile-center-form");
  if (!form || form.dataset.profileBound === "true") return;
  form.dataset.profileBound = "true";
  const avatarInput = form.querySelector("[data-profile-avatar-input]");
  const preview = form.querySelector(".profile-avatar-preview");
  avatarInput?.addEventListener("change", () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      pendingProfileAvatar = String(reader.result || "");
      if (preview) {
        preview.style.backgroundImage = `url('${pendingProfileAvatar}')`;
        preview.textContent = "";
      }
    });
    reader.readAsDataURL(file);
  });
  form.querySelector("[data-profile-unbind-phone]")?.addEventListener("click", () => {
    const input = form.elements.profilePhone;
    if (input) input.value = "";
    showToast("手机号已清空，保存后完成解绑");
  });
}

function saveProfileCenterForm(form) {
  const user = state.currentUser;
  if (!user) return false;
  const name = formValue(form, "profileName");
  const phone = formValue(form, "profilePhone");
  if (!name) {
    showToast("账户名不能为空");
    return false;
  }
  if (phone && !/^1\d{10}$/.test(phone)) {
    showToast("请输入 11 位手机号");
    return false;
  }
  const duplicatePhone = phone && state.users.some((item) => item.account !== user.account && item.phone === phone);
  if (duplicatePhone) {
    showToast("该手机号已绑定其他账号");
    return false;
  }
  const nextValues = {
    name,
    phone,
    avatar: pendingProfileAvatar || "",
    bindStatus: phone ? "已绑定" : "未绑定",
    externalSubject: phone ? `phone:${phone}` : user.externalSubject,
  };
  const target = state.users.find((item) => item.account === user.account);
  if (target) Object.assign(target, nextValues);
  state.currentUser = { ...state.currentUser, ...nextValues };
  saveUserProfileOverride(user.account, nextValues);
  if (target?.identitySource === "本地注册") saveRegisteredUsers();
  saveLocalSession();
  return true;
}

function renderChrome() {
  const authenticated = isAuthenticated();
  document.body.classList.toggle("auth-view", !authenticated);
  document.body.classList.toggle("employee-terminal-view", authenticated && state.currentUser?.roleCode === "employee");
  document.body.classList.toggle("self-service-view", authenticated && state.route === "settings" && state.systemMenu === "员工自助");
  document.title = authenticated ? `资产云管家 - ${routeTitle()}` : "资产云管家 - 登录入口";

  if (!authenticated) {
    topbarActions.innerHTML = `
      <div class="login-topbar-copy">资产云管家 · 登录注册</div>
    `;
    return;
  }

  topbarActions.innerHTML = "";
}

function renderNav() {
  if (!isAuthenticated()) {
    navEl.innerHTML = "";
    renderSidebarTools();
    return;
  }

  if (!navEl.querySelector(".nav-content")) {
    navEl.innerHTML = `<div class="sidebar-account-host"></div><div class="nav-content"></div><div class="nav-indicator" aria-hidden="true"></div>`;
  }

  const renderGroup = (items) =>
    items
    .map((item) => {
      const hasChildren = Boolean(item.children?.length);
      const targetRoute = item.landingRoute || item.id;
      const childActive = flattenNav(item.children || []).some((child) => child.id === state.route);
      const itemActive = targetRoute === state.route || childActive;
      const open = false;
      const children = "";

      return `<div class="nav-group ${hasChildren ? "has-children" : ""} ${open ? "open" : ""}">
        <button class="nav-item ${itemActive ? "active" : ""}" data-route="${targetRoute}" title="${item.label}" aria-label="${item.label}">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
        </button>
        ${children}
      </div>`;
    })
    .join("");

  navEl.querySelector(".sidebar-account-host").innerHTML = renderAccountMenu();
  navEl.querySelector(".nav-content").innerHTML = `<div class="nav-section">${renderGroup(getPrimaryNavItems())}</div>`;
  renderSidebarTools();
}

function renderSidebarTools() {
  if (!sidebarTools) return;

  if (!isAuthenticated()) {
    sidebarTools.innerHTML = "";
    return;
  }

  const isEmployee = state.currentUser?.roleCode === "employee";
  sidebarTools.innerHTML = `
    <button class="sidebar-tool sidebar-switch-tool" data-switch-terminal title="${isEmployee ? "切换至管理端" : "切换至员工端"}" aria-label="${isEmployee ? "切换至管理端" : "切换至员工端"}">
      <span class="sidebar-tool-icon sidebar-switch-icon" aria-hidden="true">
        <svg class="sidebar-switch-svg" viewBox="0 0 32 32" focusable="false">
          <circle class="sidebar-switch-head" cx="13.2" cy="9.2" r="5.4"></circle>
          <path class="sidebar-switch-body" d="M4.8 26.5c1-5.9 4.6-9.3 9.1-9.3 4.3 0 7.7 3.1 8.8 8.7l.1.6H4.8Z"></path>
          <circle class="sidebar-switch-badge" cx="23.2" cy="23.2" r="5.4"></circle>
          <path class="sidebar-switch-arrow" d="M20.5 23.2h5.1m-2-2.1 2.1 2.1-2.1 2.1"></path>
        </svg>
      </span>
      <span class="sidebar-tool-tip">${isEmployee ? "切换至管理端" : "切换至员工端"}</span>
    </button>
    <button class="sidebar-tool" data-open-help title="系统使用说明" aria-label="系统使用说明">
      <span class="sidebar-tool-icon">?</span>
      <span class="sidebar-tool-tip">系统使用说明</span>
    </button>
  `;
}

function captureAssetSubnavScroll() {
  const scroller = secondarySidebar?.querySelector(".asset-subnav");
  if (scroller) state.assetSubnavScrollTop = scroller.scrollTop;
}

function restoreAssetSubnavScroll() {
  const scroller = secondarySidebar?.querySelector(".asset-subnav");
  if (!scroller) return;
  scroller.scrollTop = state.assetSubnavScrollTop || 0;
  scroller.addEventListener("scroll", () => {
    state.assetSubnavScrollTop = scroller.scrollTop;
    saveLocalSession();
  });
}

function getAssetSubnavItems() {
  return getAccessibleNav().find((item) => item.id === "assets")?.children || [];
}

function shouldShowAssetSubnav() {
  return isAuthenticated() && flattenNav(getAssetSubnavItems()).some((item) => normalizeRoute(item.id) === state.route);
}

function renderSecondaryNav() {
  const show = shouldShowAssetSubnav();
  const items = getAssetSubnavItems();
  document.body.classList.toggle("has-secondary-nav", show);

  if (!secondarySidebar) return;

  secondarySidebar.setAttribute("aria-hidden", String(!show));
  if (!show) {
    state.assetSubnavScrollTop = 0;
    secondarySidebar.innerHTML = "";
    return;
  }

  secondarySidebar.innerHTML = `
    <div class="asset-subnav">
      <div class="asset-subnav-heading">
        <span class="asset-subnav-accent" aria-hidden="true"></span>
        <h2>资产</h2>
      </div>
      <div class="asset-subnav-rule" aria-hidden="true"></div>
      <div class="asset-subnav-list">
        ${items
          .map((item) => {
            const hasChildren = Boolean(item.children?.length);
            const childActive = flattenNav(item.children || []).some((child) => normalizeRoute(child.id) === state.route);
            const active = normalizeRoute(item.id) === state.route || childActive;
            const open = hasChildren ? isNavGroupOpen(item.id) : false;
            if (!hasChildren) {
              return `
                <button class="asset-subnav-item ${active ? "active" : ""}" data-route="${item.id}" type="button">
                  <span class="asset-subnav-dot" aria-hidden="true"></span>
                  <span class="asset-subnav-label">${escapeHtml(item.label)}</span>
                </button>
              `;
            }
            return `
              <div class="asset-subnav-group ${open ? "open" : ""}" data-asset-subnav-group="${escapeHtml(item.id)}">
                <button class="asset-subnav-item asset-subnav-parent ${active ? "active" : ""}" data-asset-subnav-toggle="${item.id}" type="button" aria-expanded="${open ? "true" : "false"}">
                  <span class="asset-subnav-dot" aria-hidden="true"></span>
                  <span class="asset-subnav-label">${escapeHtml(item.label)}</span>
                  <span class="asset-subnav-caret" aria-hidden="true"></span>
                </button>
                <div class="asset-subnav-children" aria-hidden="${open ? "false" : "true"}">
                  ${item.children
                    .map((child) => {
                      const childRoute = normalizeRoute(child.id);
                      const childSelected = childRoute === state.route;
                      return `
                        <button class="asset-subnav-child ${childSelected ? "active" : ""}" data-route="${child.id}" type="button">
                          <span>${escapeHtml(child.label)}</span>
                        </button>
                      `;
                    })
                    .join("")}
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
  restoreAssetSubnavScroll();
}

function syncNavIndicator() {
  const indicator = navEl.querySelector(".nav-indicator");
  const content = navEl.querySelector(".nav-content");
  if (!indicator || !content || !isAuthenticated()) return;

  const activeChild = content.querySelector(".nav-child.active");
  const childVisible = activeChild && activeChild.offsetParent !== null;
  const activeTarget = childVisible ? activeChild : content.querySelector(".nav-item.active");

  if (!activeTarget) {
    indicator.style.opacity = "0";
    return;
  }

  const contentRect = content.getBoundingClientRect();
  const targetRect = activeTarget.getBoundingClientRect();
  const top = targetRect.top - contentRect.top + content.scrollTop + 6;
  const height = Math.max(targetRect.height - 12, 18);

  indicator.style.opacity = "1";
  indicator.style.transform = `translateY(${top}px)`;
  indicator.style.height = `${height}px`;
}

function renderQuickActionButton(item) {
  const cls = item.variant ? `btn ${item.variant}` : "btn";
  if (item.route) return `<button class="${cls}" data-route="${item.route}">${item.label}</button>`;
  if (item.request) return `<button class="${cls}" data-open-request="${item.request}">${item.label}</button>`;
  if (item.kind) return `<button class="${cls}" data-open-kind="${item.kind}">${item.label}</button>`;
  return "";
}

function renderWorkbenchCard(item) {
  const attr = item.route
    ? `data-route="${item.route}"`
    : item.request
      ? `data-open-request="${item.request}"`
      : `data-open-kind="${item.kind}"`;
  return `<button class="action-card" ${attr}>
    <span class="action-icon">${item.icon}</span>
    <strong>${item.label}</strong>
  </button>`;
}

function renderDeviceOverviewStrip(asset) {
  return `<section class="panel device-overview-strip">
    <div class="device-overview-heading">
      <h2 class="panel-title">我的设备概览</h2>
      <div class="panel-subtitle">如果设备异常，可从资产详情发起归还或报修。</div>
    </div>
    ${
      asset
        ? `<div class="device-overview-body">
            <div class="device-overview-main">
              <strong>${asset.name}</strong>
              <div class="panel-subtitle">${asset.model} / ${asset.assetTag}</div>
            </div>
            <div class="device-overview-meta">
              <span>当前状态</span>
              ${statusTag(asset.status)}
            </div>
            <div class="device-overview-meta">
              <span>存放位置</span>
              <strong>${asset.location}</strong>
            </div>
            <div class="device-overview-meta">
              <span>资产风险</span>
              ${riskBadge(asset.risk)}
            </div>
            <div class="device-overview-meta">
              <span>保修截止</span>
              <strong>${asset.warrantyDate}</strong>
            </div>
            <button class="btn" data-detail="${asset.id}">查看详情</button>
          </div>`
        : `<div class="device-overview-empty">当前还没有分配到你的设备，建议先发起领用申请。</div>`
    }
  </section>`;
}

function buildAssetDistributionRows(assets, mode = "organization") {
  if (mode === "location") {
    const rows = flattenLocationTree()
      .filter((node) => node.level === 0 && node.enabled !== false)
      .map((node) => ({ key: node.path, label: node.name || node.path, title: node.path, count: 0 }));
    const rowMap = new Map(rows.map((row) => [row.key, row]));
    assets.forEach((asset) => {
      const location = normalizeLocationValue(asset.location);
      const key = location.split(" / ").filter(Boolean)[0] || "未设置位置";
      if (!rowMap.has(key)) {
        const row = { key, label: key, title: key, count: 0 };
        rows.push(row);
        rowMap.set(key, row);
      }
      const row = rowMap.get(key);
      if (row) row.count += 1;
    });
    return rows.length ? rows : [{ key: "empty", label: "暂无位置", title: "暂无位置", count: 0 }];
  }

  const distributionMap = new Map();
  assets.forEach((asset) => {
    const key = asset.ownerCompany || asset.company || "默认公司";
    distributionMap.set(key, (distributionMap.get(key) || 0) + 1);
  });
  const rows = Array.from(distributionMap, ([label, count]) => ({ key: label, label, title: label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  return rows.length ? rows : [{ key: "default", label: "默认公司", title: "默认公司", count: 0 }];
}

function topLevelAssetCategoryName(category = "") {
  const value = String(category || "").trim();
  if (!value) return "其他";
  const rows = flattenAssetCategoryTree().filter((node) => node.enabled !== false);
  const matched = rows.find((node) => node.name === value || node.path === value);
  return matched ? matched.path.split(" / ")[0] : value;
}

function buildAssetCategoryStatRows(assets, companyFilter = "所属/承租公司") {
  const filteredAssets =
    companyFilter && companyFilter !== "所属/承租公司"
      ? assets.filter((asset) => (asset.ownerCompany || asset.company || "默认公司") === companyFilter)
      : assets;
  const rows = flattenAssetCategoryTree()
    .filter((node) => node.level === 0 && node.enabled !== false)
    .map((node) => ({ key: node.name, label: node.name, title: node.name, count: 0, amount: 0 }));
  const rowMap = new Map(rows.map((row) => [row.key, row]));

  filteredAssets.forEach((asset) => {
    const key = topLevelAssetCategoryName(asset.category || asset.type);
    if (!rowMap.has(key)) {
      const row = { key, label: key, title: key, count: 0, amount: 0 };
      rows.push(row);
      rowMap.set(key, row);
    }
    const row = rowMap.get(key);
    row.count += 1;
    row.amount += Number(asset.price) || 0;
  });

  return rows.length ? rows : [{ key: "empty", label: "暂无分类", title: "暂无分类", count: 0, amount: 0 }];
}

function dashboardMetricLabel(value, mode = "count") {
  const number = Math.round(Number(value) || 0);
  if (mode === "amount" && number >= 10000) return `${Math.round(number / 10000).toLocaleString("zh-CN")}万`;
  return number.toLocaleString("zh-CN");
}

function dashboardChartScale(maxValue = 0) {
  const max = Math.max(1, Math.ceil(Number(maxValue) || 0));
  const rawStep = Math.max(1, max / 5);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceStep = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = Math.max(1, niceStep * magnitude);
  const scaledMax = Math.ceil(max / step) * step;
  const tickCount = Math.floor(scaledMax / step) + 1;
  return {
    max: scaledMax,
    ticks: Array.from({ length: tickCount }, (_, index) => scaledMax - index * step),
  };
}

function dashboardGridLines(ticks = []) {
  const intervals = Math.max(ticks.length - 1, 1);
  return Array.from({ length: intervals }, () => "<span></span>").join("");
}

function renderDashboardPanel(assets) {
  const receiveCount = assets.filter((item) => item.status === "在用").length;
  const borrowCount = assets.filter((item) => item.status === "借用中").length;
  const disposedCount = assets.filter((item) => ["报废", "已处置"].includes(item.status)).length;
  const idleCount = Math.max(assets.length - receiveCount - borrowCount - disposedCount, 0);
  const donutCircumference = 213.6;
  const statusRows = [
    { key: "receive", label: "领用", count: receiveCount, color: "#7c5cf6" },
    { key: "idle", label: "空闲", count: idleCount, color: "#20a7dc" },
    { key: "disposed", label: "已处置", count: disposedCount, color: "#f45f63" },
    { key: "borrow", label: "借用", count: borrowCount, color: "#f59e0b" },
  ];
  let segmentOffset = 0;
  const statusSegments = statusRows.map((row) => {
    const dash = assets.length ? (row.count / assets.length) * donutCircumference : 0;
    const segment = { ...row, dash, offset: -segmentOffset, percent: assets.length ? Math.round((row.count / assets.length) * 100) : 0 };
    segmentOffset += dash;
    return segment;
  });
  const companyOptions = ["所属/承租公司", ...Array.from(new Set(assets.map((item) => item.ownerCompany || item.company).filter(Boolean)))];
  const distributionMode = state.assetDistributionMode === "location" ? "location" : "organization";
  const distributionRows = buildAssetDistributionRows(assets, distributionMode);
  const distributionScale = dashboardChartScale(Math.max(...distributionRows.map((item) => item.count), 0));
  const distributionColumns = `repeat(${distributionRows.length}, minmax(0, 1fr))`;
  const categoryCompanyFilter = "所属/承租公司";
  const categoryMetricMode = state.assetCategoryMetricMode === "amount" ? "amount" : "count";
  const categoryStatRows = buildAssetCategoryStatRows(assets, categoryCompanyFilter);
  const categoryMetricKey = categoryMetricMode === "amount" ? "amount" : "count";
  const categoryRawMax = Math.max(...categoryStatRows.map((item) => item[categoryMetricKey]), 0);
  const categoryScale = dashboardChartScale(categoryRawMax);
  const categoryColumns = `repeat(${categoryStatRows.length}, minmax(0, 1fr))`;
  const activeAssetRows = buildAssetCategoryStatRows(
    assets.filter((asset) => asset.status === "在用"),
    "所属/承租公司"
  );
  const activeAssetScale = dashboardChartScale(Math.max(...activeAssetRows.map((item) => item.count), 0));
  const activeAssetColumns = `repeat(${activeAssetRows.length}, minmax(0, 1fr))`;

  return `<article class="panel dashboard-panel">
    <div class="panel-header">
      <div>
        <h2 class="panel-title">仪表盘</h2>
        <div class="panel-subtitle">查看当前账号范围内的核心资产数量。</div>
      </div>
    </div>
    <div class="dashboard-charts">
      <article class="dashboard-chart-card dashboard-status-card">
        <div class="dashboard-card-head">
          <h3>资产状态占比</h3>
          <div class="dashboard-card-filters">
            <select aria-label="资产状态范围">
              <option>全部</option>
            </select>
            <select aria-label="所属或承租公司" disabled>
              ${companyOptions.map((option) => `<option>${escapeHtml(option)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="donut-layout">
          <div class="dashboard-donut">
            <svg class="donut-svg" viewBox="0 0 100 100" aria-hidden="true">
              <circle class="donut-ring donut-ring-base" cx="50" cy="50" r="34"></circle>
              ${statusSegments
                .filter((segment) => segment.count > 0)
                .map(
                  (segment) =>
                    `<circle class="donut-ring donut-ring-segment donut-ring-${segment.key}" cx="50" cy="50" r="34" style="--segment-color: ${segment.color}; --segment-dash: ${segment.dash.toFixed(2)}; --segment-offset: ${segment.offset.toFixed(2)}"></circle>`
                )
                .join("")}
            </svg>
            <div>
              <span>全部</span>
              <strong>${assets.length}</strong>
            </div>
          </div>
          <div class="chart-legend">
            ${statusSegments
              .map(
                (segment) => `<div>
                  <i class="legend-dot" style="--legend-color: ${segment.color}"></i>
                  <span>${segment.label}</span>
                  <strong>${segment.count}</strong>
                  <em>${segment.percent}%</em>
                </div>`
              )
              .join("")}
          </div>
        </div>
      </article>
      <article class="dashboard-chart-card asset-distribution-card">
        <div class="dashboard-card-head">
          <h3>资产分布情况</h3>
        </div>
        <div class="asset-distribution-chart">
          <div class="asset-distribution-body" style="--tick-intervals: ${Math.max(distributionScale.ticks.length - 1, 1)}">
            <div class="asset-distribution-axis" aria-hidden="true">
              ${distributionScale.ticks.map((tick) => `<span>${tick.toLocaleString("zh-CN")}</span>`).join("")}
            </div>
            <div class="asset-distribution-plot" style="--distribution-columns: ${distributionColumns}; --tick-intervals: ${Math.max(distributionScale.ticks.length - 1, 1)}">
              <div class="asset-distribution-plot-inner">
                <div class="asset-distribution-grid" aria-hidden="true">${dashboardGridLines(distributionScale.ticks)}</div>
                <div class="asset-distribution-bars">
                  ${distributionRows
                    .map((item) => {
                      const barHeight = distributionScale.max ? Math.max((item.count / distributionScale.max) * 100, item.count ? 6 : 0) : 0;
                      return `<div class="asset-distribution-bar" data-dashboard-bar-tooltip data-tooltip-title="${escapeHtml(item.title)}" data-tooltip-detail="资产分布情况：${item.count.toLocaleString("zh-CN")}" aria-label="${escapeHtml(item.title)}，资产分布情况：${item.count.toLocaleString("zh-CN")}" style="--bar-height: ${barHeight.toFixed(2)}%">
                        ${item.count ? `<strong>${item.count.toLocaleString("zh-CN")}</strong>` : ""}
                        <span></span>
                      </div>`;
                    })
                    .join("")}
                </div>
                <div class="asset-distribution-labels">
                  ${distributionRows.map((item) => `<span title="${escapeHtml(item.title)}">${escapeHtml(item.label)}</span>`).join("")}
                </div>
              </div>
            </div>
          </div>
          <div class="asset-distribution-tabs">
            <button class="${distributionMode === "organization" ? "active" : ""}" type="button" data-asset-distribution-mode="organization" aria-pressed="${distributionMode === "organization" ? "true" : "false"}">组织架构</button>
            <button class="${distributionMode === "location" ? "active" : ""}" type="button" data-asset-distribution-mode="location" aria-pressed="${distributionMode === "location" ? "true" : "false"}">所在位置</button>
          </div>
        </div>
      </article>
      <article class="dashboard-chart-card active-asset-stat-card">
        <div class="dashboard-card-head">
          <h3>在用资产统计</h3>
        </div>
        <div class="asset-distribution-chart active-asset-stat-chart">
          <div class="asset-distribution-body" style="--tick-intervals: ${Math.max(activeAssetScale.ticks.length - 1, 1)}">
            <div class="asset-distribution-axis" aria-hidden="true">
              ${activeAssetScale.ticks.map((tick) => `<span>${tick.toLocaleString("zh-CN")}</span>`).join("")}
            </div>
            <div class="asset-distribution-plot" style="--distribution-columns: ${activeAssetColumns}; --tick-intervals: ${Math.max(activeAssetScale.ticks.length - 1, 1)}">
              <div class="asset-distribution-plot-inner">
                <div class="asset-distribution-grid" aria-hidden="true">${dashboardGridLines(activeAssetScale.ticks)}</div>
                <div class="asset-distribution-bars">
                  ${activeAssetRows
                    .map((item) => {
                      const barHeight = activeAssetScale.max ? Math.max((item.count / activeAssetScale.max) * 100, item.count ? 6 : 0) : 0;
                      return `<div class="asset-distribution-bar" data-dashboard-bar-tooltip data-tooltip-title="${escapeHtml(item.title)}" data-tooltip-detail="在用资产统计：${item.count.toLocaleString("zh-CN")}" aria-label="${escapeHtml(item.title)}，在用资产统计：${item.count.toLocaleString("zh-CN")}" style="--bar-height: ${barHeight.toFixed(2)}%">
                        ${item.count ? `<strong>${item.count.toLocaleString("zh-CN")}</strong>` : ""}
                        <span></span>
                      </div>`;
                    })
                    .join("")}
                </div>
                <div class="asset-distribution-labels">
                  ${activeAssetRows.map((item) => `<span title="${escapeHtml(item.title)}">${escapeHtml(item.label)}</span>`).join("")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
      <article class="dashboard-chart-card asset-category-stat-card">
        <div class="dashboard-card-head">
          <h3>资产分类统计</h3>
        </div>
        <div class="asset-distribution-chart asset-category-stat-chart">
          <div class="asset-distribution-body" style="--tick-intervals: ${Math.max(categoryScale.ticks.length - 1, 1)}">
            <div class="asset-distribution-axis" aria-hidden="true">
              ${categoryScale.ticks.map((tick) => `<span>${dashboardMetricLabel(tick, categoryMetricMode)}</span>`).join("")}
            </div>
            <div class="asset-distribution-plot" style="--distribution-columns: ${categoryColumns}; --tick-intervals: ${Math.max(categoryScale.ticks.length - 1, 1)}">
              <div class="asset-distribution-plot-inner">
                <div class="asset-distribution-grid" aria-hidden="true">${dashboardGridLines(categoryScale.ticks)}</div>
                <div class="asset-distribution-bars">
                  ${categoryStatRows
                    .map((item) => {
                      const value = item[categoryMetricKey];
                      const barHeight = categoryScale.max ? Math.max((value / categoryScale.max) * 100, value ? 6 : 0) : 0;
                      return `<div class="asset-distribution-bar" data-dashboard-bar-tooltip data-tooltip-title="${escapeHtml(item.title)}" data-tooltip-detail="资产分类统计：${dashboardMetricLabel(value, categoryMetricMode)}" aria-label="${escapeHtml(item.title)}，资产分类统计：${dashboardMetricLabel(value, categoryMetricMode)}" style="--bar-height: ${barHeight.toFixed(2)}%">
                        ${value || item.count || item.amount ? `<strong>${dashboardMetricLabel(value, categoryMetricMode)}</strong>` : ""}
                        <span></span>
                      </div>`;
                    })
                    .join("")}
                </div>
                <div class="asset-distribution-labels">
                  ${categoryStatRows.map((item) => `<span title="${escapeHtml(item.title)}">${escapeHtml(item.label)}</span>`).join("")}
                </div>
              </div>
            </div>
          </div>
          <div class="asset-distribution-tabs asset-category-stat-tabs">
            <button class="${categoryMetricMode === "count" ? "active" : ""}" type="button" data-asset-category-metric="count" aria-pressed="${categoryMetricMode === "count" ? "true" : "false"}">数量</button>
            <button class="${categoryMetricMode === "amount" ? "active" : ""}" type="button" data-asset-category-metric="amount" aria-pressed="${categoryMetricMode === "amount" ? "true" : "false"}">金额</button>
          </div>
        </div>
      </article>
    </div>
  </article>`;
}

function renderRecentRequestPanel(title, rows, subtitle) {
  return `<section class="panel">
    <div class="panel-header">
      <div>
        <h2 class="panel-title">${title}</h2>
        <div class="panel-subtitle">${subtitle}</div>
      </div>
      ${routeAllowed("requests") ? `<button class="btn" data-route="requests">查看全部</button>` : ""}
    </div>
    <div class="timeline">
      ${
        rows.length
          ? rows
              .map(
                (item) => `<div class="timeline-item">
                  <div class="timeline-date">${item.date}</div>
                  <div>
                    <div class="timeline-title">${item.id} · ${item.type} ${statusTag(item.status)}</div>
                    <div class="timeline-desc">${item.asset} / ${item.reason} / ${item.system}</div>
                  </div>
                </div>`
              )
              .join("")
          : `<div class="empty-note">当前范围内还没有可展示的业务单据。</div>`
      }
    </div>
  </section>`;
}

function renderHome() {
  if (!state.currentUser) return "";
  if (state.currentUser.roleCode === "employee") return renderEmployeeHome();
  return renderManagementHome();
}

function renderManagementHome() {
  const assets = getScopedAssets();
  const totalValue = assets.reduce((sum, item) => sum + item.price, 0);
  const pendingCount = getScopedRequests().filter((item) => item.status !== "已完成").length;
  const activeCount = assets.filter((item) => item.status === "在用").length;

  return `
    <section class="grid stats-grid">
      <article class="stat-card" data-watermark="ZC">
        <div class="stat-top"><span>资产总数</span><span class="tag blue">当前范围</span></div>
        <div class="stat-value">${assets.length}</div>
        <div class="stat-note">账号范围内全部资产</div>
      </article>
      <article class="stat-card" data-watermark="ZY">
        <div class="stat-top"><span>在用资产</span>${statusTag("在用")}</div>
        <div class="stat-value">${activeCount}</div>
        <div class="stat-note">已分配给员工或部门</div>
      </article>
      <article class="stat-card" data-watermark="OA">
        <div class="stat-top"><span>待处理单据</span>${statusTag("审批中")}</div>
        <div class="stat-value">${pendingCount}</div>
        <div class="stat-note">资产动作发起后等待外部审批回写</div>
      </article>
      <article class="stat-card" data-watermark="¥">
        <div class="stat-top"><span>资产原值</span><span class="tag blue">当前范围</span></div>
        <div class="stat-value">${money(totalValue)}</div>
        <div class="stat-note">后续可接折旧与成本中心</div>
      </article>
    </section>
    <section class="grid content-grid session-only">
      ${renderDashboardPanel(assets)}
    </section>
  `;
}

function renderEmployeeHome() {
  const deviceAssets = getScopedAssets().filter((item) => item.type !== "软件许可");
  const myPrimaryAsset = deviceAssets[0];

  return `
    <section class="hero employee-home-hero">
      <h1>${greeting()}，${state.currentUser.name}</h1>
    </section>
    ${renderDeviceOverviewStrip(myPrimaryAsset)}
  `;
}

function assetRowActionMarkup(item) {
  if (!state.currentUser) return "";

  if (state.currentUser.roleCode === "employee") {
    const action = item.owner === state.currentUser.name ? "归还" : "领用";
    return `
      <button class="btn" data-detail="${item.id}">详情</button>
      <button class="btn" data-asset-action="${item.id}" data-action="${action}">${assetActionLabel(item, action)}</button>
    `;
  }

  return `
    <button class="btn" data-detail="${item.id}">详情</button>
    <button class="btn" data-asset-action="${item.id}" data-action="调拨">${assetActionLabel(item, "调拨")}</button>
  `;
}

function assetSearchText(item) {
  return [
    item.id,
    item.name,
    item.owner,
    item.status,
    item.category,
    item.type,
    item.model,
    item.sn,
    item.assetTag,
    item.location,
    item.department,
    item.custodian,
    item.supplier,
    (item.tags || []).join(""),
  ]
    .join("")
    .toLowerCase();
}

function matchesAssetSearch(item) {
  const keyword = currentAssetSearchKeyword().toLowerCase();
  return !keyword || assetSearchText(item).includes(keyword);
}

function currentAssetSearchKeyword() {
  if (state.route === "assets") return state.assetListQuery.trim();
  if (state.route === "assetInbound") return state.assetInboundQuery.trim();
  if (state.route === "assetReceiveReturn") return state.assetReceiveReturnQuery.trim();
  return state.query.trim();
}

function matchesTextField(value, keyword) {
  const normalized = String(keyword || "").trim().toLowerCase();
  return !normalized || String(value || "").toLowerCase().includes(normalized);
}

function matchesAdvancedAssetFilters(item) {
  const filters = state.advancedAssetFilters || defaultAdvancedAssetFilters();
  const tags = item.tags || [];
  return (
    (filters.status === "全部" || item.status === filters.status) &&
    matchesTextField(item.id, filters.id) &&
    matchesTextField(item.name, filters.name) &&
    (filters.category === "全部" || item.category === filters.category) &&
    (filters.type === "全部" || item.type === filters.type) &&
    matchesTextField(item.model, filters.model) &&
    matchesTextField(item.sn, filters.sn) &&
    matchesTextField(item.owner, filters.owner) &&
    (filters.department === "全部" || item.department === filters.department) &&
    matchesTextField(item.location, filters.location) &&
    matchesTextField(item.supplier, filters.supplier) &&
    (filters.risk === "全部" || item.risk === filters.risk) &&
    (filters.tag === "全部" || tags.includes(filters.tag))
  );
}

function matchesAssetQuery(item) {
  return matchesAssetSearch(item) && matchesAdvancedAssetFilters(item);
}

function renderAssets(title, rows) {
  if (title === "资产列表") {
    return renderAssetListTable(rows);
  }

  const filters = state.assetFilters;
  const scopedRows = getScopedAssets(rows);
  const filtered = scopedRows.filter((item) => {
    return (
      matchesAssetQuery(item) &&
      (filters.category === "全部" || item.category === filters.category) &&
      (filters.status === "全部" || item.status === filters.status) &&
      (filters.tag === "全部" || (item.tags || []).includes(filters.tag)) &&
      (filters.location === "全部" || item.location.includes(filters.location)) &&
      (filters.risk === "全部" || item.risk === filters.risk)
    );
  });

  const isEmployee = state.currentUser?.roleCode === "employee";
  const categories = uniqueAssetValues("category", scopedRows);
  const activeCount = scopedRows.filter((item) => item.status === "在用").length;
  const riskCount = scopedRows.filter((item) => item.risk !== "正常").length;
  const displayTitle = isEmployee ? `我的${title}` : title;
  const subtitle = isEmployee
    ? "仅展示本人或本部门可见资产，资产动作通过外部审批发起。"
    : "强化 ITAM 能力：分类、标签、责任人、位置、风险、字段完整度和免审直办。";

  return `
    ${pageHeader(displayTitle, subtitle, isEmployee ? "发起申请" : "新增资产", isEmployee ? "request" : "asset")}
    <section class="asset-command">
      <article class="panel asset-filter-panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">资产分类</h2>
            <div class="panel-subtitle">${isEmployee ? "先看我的资产，再决定是否发起申请。" : "按 IT 资产域管理，不再混在一张平铺台账里。"}</div>
          </div>
        </div>
        <div class="category-list">
          ${categories
            .map((category) => {
              const count = category === "全部" ? scopedRows.length : scopedRows.filter((item) => item.category === category).length;
              return `<button class="category-item ${filters.category === category ? "active" : ""}" data-asset-filter="category" data-value="${category}">
                <span>${category}</span><strong>${count}</strong>
              </button>`;
            })
            .join("")}
        </div>
        <div class="role-switch">
          <div>
            <strong>当前登录角色</strong>
            <div class="panel-subtitle">${state.currentUser.name} / ${state.currentUser.roleName}</div>
          </div>
          <span class="tag blue">${state.currentUser.account}</span>
        </div>
      </article>

      <article class="panel">
        <div class="asset-kpis">
          ${assetKpi("当前资产", scopedRows.length, "纳管资产数")}
          ${assetKpi("在用资产", activeCount, "已分配给员工或部门")}
          ${assetKpi("风险资产", riskCount, "过保、故障、待核验")}
          ${assetKpi("标签覆盖", scopedRows.length ? `${Math.round((scopedRows.filter((item) => item.assetTag).length / scopedRows.length) * 100)}%` : "0%", "二维码/RFID/许可池")}
        </div>
        ${assetToolbar(scopedRows)}
        <div class="asset-tags">
          ${uniqueTags(scopedRows)
            .map((tag) => `<button class="tag-filter ${filters.tag === tag ? "active" : ""}" data-asset-filter="tag" data-value="${tag}">${tag}</button>`)
            .join("")}
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>资产编号</th><th>资产信息</th><th>分类/标签</th><th>责任</th><th>状态</th><th>风险</th><th>完整度</th><th>操作</th></tr></thead>
            <tbody>
              ${
                filtered.length
                  ? filtered
                      .map(
                        (item) => `<tr>
                          <td><button class="link" data-detail="${item.id}">${item.id}</button><div class="panel-subtitle">${item.assetTag || "-"}</div></td>
                          <td>${item.name}<div class="panel-subtitle">${item.model} / ${item.sn}</div></td>
                          <td><strong>${item.category}</strong><div class="row-tags">${(item.tags || []).map((tag) => `<span>${tag}</span>`).join("")}</div></td>
                          <td>${item.owner}<div class="panel-subtitle">${item.department} / ${item.custodian}</div></td>
                          <td>${statusTag(item.status)}</td>
                          <td>${riskBadge(item.risk)}</td>
                          <td>${completeness(item.completeness)}</td>
                          <td>${assetRowActionMarkup(item)}</td>
                        </tr>`
                      )
                      .join("")
                  : `<tr class="empty-row"><td colspan="8">当前筛选条件下没有资产。</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </article>
    </section>`;
}

function renderAssetListTable(rows) {
  const scopedRows = getScopedAssets(rows);
  const filtered = scopedRows.filter(matchesAssetQuery);
  const pagination = paginateRows(filtered, "assetList");
  const displayRows = pagination.rows;

  return `<section class="asset-list-page">
    <div class="asset-list-toolbar">
      <div class="asset-list-actions">
        <button class="table-action primary" data-open-kind="asset">＋ 新增</button>
        ${assetOperationDropdown()}
        ${assetEditDropdown()}
        ${assetImportExportDropdown()}
        <button class="table-action" data-print-asset-labels>打印标签</button>
      </div>
      <div class="asset-list-search">
        <input class="local-search" type="search" placeholder="搜索" value="${escapeHtml(state.assetListQuery)}" autocomplete="off">
        <button class="table-action primary" data-search>⌕</button>
      </div>
    </div>
    ${renderDenseAssetTable(displayRows, "list")}
    ${renderPagination(pagination, "assetList")}
  </section>`;
}

function paginationStateKeys(context) {
  if (context === "inbound") return { pageKey: "assetInboundPage", pageSizeKey: "assetInboundPageSize" };
  if (context === "receiveReturn") return { pageKey: "assetReceiveReturnPage", pageSizeKey: "assetReceiveReturnPageSize" };
  if (context === "borrowReturn") return { pageKey: "assetBorrowReturnPage", pageSizeKey: "assetBorrowReturnPageSize" };
  if (context === "assetCategory") return { pageKey: "assetCategoryPage", pageSizeKey: "assetCategoryPageSize" };
  return { pageKey: "assetListPage", pageSizeKey: "assetListPageSize" };
}

function pageCountFor(total, pageSize) {
  return Math.max(1, Math.ceil(total / pageSize));
}

function clampPage(page, total, pageSize) {
  const count = pageCountFor(total, pageSize);
  return Math.min(Math.max(Number(page) || 1, 1), count);
}

function paginateRows(rows, context) {
  const { pageKey, pageSizeKey } = paginationStateKeys(context);
  const pageSize = Number(state[pageSizeKey]) || 20;
  const total = rows.length;
  const pageCount = pageCountFor(total, pageSize);
  const currentPage = clampPage(state[pageKey], total, pageSize);
  state[pageKey] = currentPage;
  const start = (currentPage - 1) * pageSize;
  return {
    context,
    rows: rows.slice(start, start + pageSize),
    total,
    pageSize,
    currentPage,
    pageCount,
  };
}

function paginationPageItems(currentPage, pageCount) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = new Set([1, pageCount, currentPage, currentPage - 1, currentPage + 1]);
  const sortedPages = Array.from(pages)
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((a, b) => a - b);
  const items = [];
  sortedPages.forEach((page) => {
    const previous = items[items.length - 1];
    if (typeof previous === "number" && page - previous > 1) {
      items.push("ellipsis");
    }
    items.push(page);
  });
  return items;
}

function renderPagination(pagination, context) {
  const { total, pageSize, currentPage, pageCount } = pagination;
  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= pageCount;
  return `<div class="asset-list-pagination ${context === "inbound" ? "inbound-pagination" : ""}" data-pagination="${context}">
    <span>共 ${total} 条</span>
    <button class="page-btn" type="button" data-page="${currentPage - 1}" ${prevDisabled ? "disabled" : ""} aria-label="上一页">‹</button>
    ${paginationPageItems(currentPage, pageCount)
      .map((item) =>
        item === "ellipsis"
          ? `<span class="page-ellipsis">…</span>`
          : `<button class="page-btn ${item === currentPage ? "active" : ""}" type="button" data-page="${item}" aria-current="${item === currentPage ? "page" : "false"}">${item}</button>`
      )
      .join("")}
    <button class="page-btn" type="button" data-page="${currentPage + 1}" ${nextDisabled ? "disabled" : ""} aria-label="下一页">›</button>
    <select data-page-size aria-label="每页条数">
      ${[20, 50].map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size} 条/页</option>`).join("")}
    </select>
    <span>跳至</span>
    <input data-page-jump aria-label="跳转页码" inputmode="numeric" pattern="[0-9]*" value="">
    <span>页</span>
  </div>`;
}

function assetListStatus(status) {
  const tone = status.includes("审批") ? "green" : status === "空闲" ? "blue" : status === "交接待签字" ? "red" : "violet";
  return `<span class="asset-status-pill ${tone}">${status}</span>`;
}

function visibleAssetColumns() {
  const selected = new Set(state.assetListSettings.visibleColumns);
  return assetTableColumns.filter((column) => selected.has(column.key));
}

function assetTableColumnWidth(column, widthMap = state.assetListSettings.columnWidths) {
  const saved = Number(widthMap?.[column.key]);
  const fallback = Number(column.width) || 96;
  const minWidth = Number(column.minWidth) || 48;
  return Math.max(minWidth, Number.isFinite(saved) ? saved : fallback);
}

function assetTableMinWidth(columns = visibleAssetColumns(), widthMap = state.assetListSettings.columnWidths) {
  return 36 + columns.reduce((total, column) => total + assetTableColumnWidth(column, widthMap), 0);
}

function renderAssetTableColgroup(columns) {
  return `<colgroup>
    <col data-column-key="select" style="width:36px">
    ${columns.map((column) => `<col data-column-key="${escapeHtml(column.key)}" style="width:${assetTableColumnWidth(column)}px">`).join("")}
  </colgroup>`;
}

function renderAssetTableHeader(column) {
  return `<th data-column-key="${escapeHtml(column.key)}" data-min-width="${column.minWidth || 48}">
    <span class="resizable-column-label">${escapeHtml(column.label)}</span>
    <span class="column-resize-handle" data-column-resize="assetList:${escapeHtml(column.key)}" role="separator" aria-orientation="vertical" aria-label="调整${escapeHtml(column.label)}列宽"></span>
  </th>`;
}

function renderDenseAssetTable(displayRows, mode = "list") {
  const columns = visibleAssetColumns();
  const visibleIds = new Set(displayRows.map((item) => item.id));
  state.selectedAssetIds = state.selectedAssetIds.filter((id) => visibleIds.has(id));
  const allChecked = displayRows.length > 0 && displayRows.every((item) => state.selectedAssetIds.includes(item.id));
  const minWidth = assetTableMinWidth(columns);
  return `<div class="asset-table-shell density-${state.assetListSettings.density}">
    <div class="asset-table-actions">
      <button class="link" data-advanced-search>高级搜索</button>
      <button class="list-settings-button" data-list-settings title="列表设置" aria-label="列表设置">⚙</button>
    </div>
    <div class="asset-table-scroll">
      <table class="asset-list-table" data-resizable-table="assetList" style="min-width:${minWidth}px">
        ${renderAssetTableColgroup(columns)}
        <thead>
          <tr>
            <th class="asset-list-select-cell"><input type="checkbox" data-asset-check-all aria-label="全选" ${allChecked ? "checked" : ""} ${displayRows.length ? "" : "disabled"}></th>
            ${columns.map(renderAssetTableHeader).join("")}
          </tr>
        </thead>
        <tbody>
          ${
            displayRows.length
              ? displayRows
                  .map(
                    (item, index) => `<tr>
                      <td class="asset-list-select-cell"><input type="checkbox" data-asset-select="${escapeHtml(item.id)}" aria-label="选择${escapeHtml(item.id)}" ${state.selectedAssetIds.includes(item.id) ? "checked" : ""}></td>
                      ${columns.map((column) => `<td>${column.render(item, index, mode)}</td>`).join("")}
                    </tr>`
                  )
                  .join("")
              : `<tr class="empty-row"><td colspan="${columns.length + 1}">${currentAssetSearchKeyword() ? "没有匹配的资产结果。" : "当前账号下暂无资产。"}</td></tr>`
          }
        </tbody>
      </table>
    </div>
  </div>`;
}

function saveAssetListSettings() {
  localStorage.setItem("assetListSettings", JSON.stringify(state.assetListSettings));
}

function saveBorrowReturnColumnWidths() {
  localStorage.setItem("borrowReturnColumnLayoutVersion", borrowReturnColumnLayoutVersion);
  localStorage.setItem("borrowReturnColumnWidths", JSON.stringify(state.borrowReturnColumnWidths || {}));
}

function saveInboundColumnWidths() {
  localStorage.setItem("inboundColumnLayoutVersion", inboundColumnLayoutVersion);
  localStorage.setItem("inboundColumnWidths", JSON.stringify(state.inboundColumnWidths || {}));
}

function saveReceiveReturnColumnWidths() {
  localStorage.setItem("receiveReturnColumnLayoutVersion", receiveReturnColumnLayoutVersion);
  localStorage.setItem("receiveReturnColumnWidths", JSON.stringify(state.receiveReturnColumnWidths || {}));
}

function setAssetColumnVisibility(key, visible, reopenTab = "columns") {
  const current = new Set(state.assetListSettings.visibleColumns);
  if (visible) {
    current.add(key);
  } else if (current.size > 1) {
    current.delete(key);
  }
  state.assetListSettings = normalizeAssetListSettings({
    ...state.assetListSettings,
    visibleColumns: Array.from(current),
  });
  saveAssetListSettings();
  render();
  openAssetAdvancedSearch(reopenTab, "assets");
}

function setAllAssetColumns(checked) {
  state.assetListSettings = normalizeAssetListSettings({
    ...state.assetListSettings,
    visibleColumns: checked ? defaultAssetTableColumnKeys : ["code"],
  });
  saveAssetListSettings();
  render();
  openAssetAdvancedSearch("columns", "assets");
}

function setAssetTableDensity(density, reopenTab = "columns") {
  state.assetListSettings = normalizeAssetListSettings({
    ...state.assetListSettings,
    density,
  });
  saveAssetListSettings();
  render();
  openAssetAdvancedSearch(reopenTab, "assets");
}

function setAssetListColumnWidth(columnKey, width) {
  const column = assetTableColumns.find((item) => item.key === columnKey);
  if (!column) return;
  const minWidth = Number(column.minWidth) || 48;
  const nextWidth = Math.max(minWidth, Math.round(width));
  const widthMap = {
    ...(state.assetListSettings.columnWidths || {}),
    [columnKey]: nextWidth,
  };
  document.querySelectorAll('[data-resizable-table="assetList"]').forEach((table) => {
    const visibleKeys = Array.from(table.querySelectorAll("col[data-column-key]"))
      .map((col) => col.dataset.columnKey)
      .filter((key) => key && key !== "select");
    const visibleColumns = visibleKeys
      .map((key) => assetTableColumns.find((item) => item.key === key))
      .filter(Boolean);
    const col = table.querySelector(`col[data-column-key="${CSS.escape(columnKey)}"]`);
    if (col) col.style.width = `${nextWidth}px`;
    table.style.minWidth = `${assetTableMinWidth(visibleColumns, widthMap)}px`;
  });
}

function commitAssetListColumnWidth(columnKey, width) {
  state.assetListSettings = normalizeAssetListSettings({
    ...state.assetListSettings,
    columnWidths: {
      ...(state.assetListSettings.columnWidths || {}),
      [columnKey]: width,
    },
    columnLayoutVersion: assetTableColumnLayoutVersion,
  });
  saveAssetListSettings();
}

function setInboundColumnWidth(columnKey, width) {
  const column = inboundOrderTableColumns.find((item) => item.key === columnKey);
  if (!column) return;
  const minWidth = Number(column.minWidth) || 48;
  const nextWidth = Math.max(minWidth, Math.round(width));
  document.querySelectorAll('[data-resizable-table="inbound"]').forEach((table) => {
    const col = table.querySelector(`col[data-column-key="${CSS.escape(columnKey)}"]`);
    if (col) col.style.width = `${nextWidth}px`;
    const widthMap = { ...(state.inboundColumnWidths || {}), [columnKey]: nextWidth };
    table.style.minWidth = `${inboundTableMinWidth(widthMap)}px`;
  });
}

function commitInboundColumnWidth(columnKey, width) {
  state.inboundColumnWidths = normalizeInboundColumnWidths({
    ...(state.inboundColumnWidths || {}),
    [columnKey]: width,
  });
  saveInboundColumnWidths();
}

function setReceiveReturnColumnWidth(columnKey, width) {
  const columns = receiveReturnColumns();
  const column = columns.find((item) => item.key === columnKey);
  if (!column) return;
  const minWidth = Number(column.minWidth) || 48;
  const nextWidth = Math.max(minWidth, Math.round(width));
  document.querySelectorAll('[data-resizable-table="receiveReturn"]').forEach((table) => {
    const col = table.querySelector(`col[data-column-key="${CSS.escape(columnKey)}"]`);
    if (col) col.style.width = `${nextWidth}px`;
    const widthMap = { ...(state.receiveReturnColumnWidths || {}), [columnKey]: nextWidth };
    table.style.minWidth = `${receiveReturnTableMinWidth(columns, widthMap)}px`;
  });
}

function commitReceiveReturnColumnWidth(columnKey, width) {
  state.receiveReturnColumnWidths = normalizeReceiveReturnColumnWidths({
    ...(state.receiveReturnColumnWidths || {}),
    [columnKey]: width,
  });
  saveReceiveReturnColumnWidths();
}

function getSelectedAssets() {
  return state.selectedAssetIds.map((id) => state.assets.find((item) => item.id === id)).filter(Boolean);
}

function getFlowSelectedAssets(form) {
  const ids = Array.from(form.querySelectorAll("[data-flow-row-select]")).map((input) => input.dataset.flowRowSelect);
  if (!ids.length) return getSelectedAssets();
  return ids.map((id) => state.assets.find((item) => item.id === id)).filter(Boolean);
}

function requireSelectedAssets(actionLabel = "操作") {
  const selected = getSelectedAssets();
  if (!selected.length) {
    showToast(`请先勾选要${actionLabel}的资产`);
    return [];
  }
  return selected;
}

function setSelectedAsset(id, checked) {
  const selected = new Set(state.selectedAssetIds);
  if (checked) {
    selected.add(id);
  } else {
    selected.delete(id);
  }
  state.selectedAssetIds = Array.from(selected);
}

function setAllVisibleAssets(checked) {
  const rows = paginateRows(getScopedAssets().filter(matchesAssetQuery), "assetList").rows;
  const visibleIds = rows.map((item) => item.id);
  const selected = new Set(state.selectedAssetIds);
  visibleIds.forEach((id) => {
    if (checked) selected.add(id);
    else selected.delete(id);
  });
  state.selectedAssetIds = Array.from(selected);
}

function selectedOrVisibleLabelAssets() {
  return getSelectedAssets();
}

function selectedAssetRowsFromCurrentTable(root = document) {
  return Array.from(root.querySelectorAll("[data-asset-select]:checked"))
    .map((input) => state.assets.find((item) => item.id === input.dataset.assetSelect))
    .filter(Boolean);
}

function assetLabelFieldLabel(key) {
  return assetLabelFieldOptions.find((item) => item.key === key)?.label || key;
}

function assetLabelFieldValue(asset, key) {
  const valueMap = {
    id: asset.id,
    name: asset.name,
    category: asset.category,
    status: asset.status,
    owner: asset.owner,
    employeeCode: employeeCodeForName(asset.owner),
    department: asset.department,
    location: asset.location,
    brand: asset.brand,
    model: asset.model,
    sn: asset.sn,
    phone: asset.phone,
    email: asset.email,
    receiveDate: asset.receiveDate,
    assetTag: asset.assetTag,
    price: asset.price ? money(asset.price) : "",
    supplier: asset.supplier,
    purchaseMethod: asset.purchaseMethod,
    custodian: asset.custodian,
    note: asset.note,
    company: asset.company || asset.ownerCompany,
  };
  const value = Object.prototype.hasOwnProperty.call(valueMap, key) ? valueMap[key] : asset?.[key];
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function parseAssetLabelCustomFields(text = "") {
  return String(text)
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.search(/[=:：]/);
      if (separatorIndex === -1) {
        return { label: line, source: line };
      }
      return {
        label: line.slice(0, separatorIndex).trim() || "自定义字段",
        source: line.slice(separatorIndex + 1).trim(),
      };
    });
}

function assetLabelCustomFieldValue(asset, field) {
  if (!field.source) return "-";
  const knownKeys = new Set([...assetLabelFieldOptions.map((item) => item.key), "custodian", "note", "company"]);
  return knownKeys.has(field.source) ? assetLabelFieldValue(asset, field.source) : field.source;
}

function assetLabelRows(asset, settings = state.assetLabelSettings) {
  const standardRows = settings.fields.map((key, index) => ({
    label: assetLabelFieldLabel(key),
    value: assetLabelFieldValue(asset, key),
    fontSize: assetLabelFieldFontSize(settings, index),
  }));
  const customRows = parseAssetLabelCustomFields(settings.customFields).map((field, index) => ({
    label: field.label,
    value: assetLabelCustomFieldValue(asset, field),
    fontSize: assetLabelFieldFontSize(settings, settings.fields.length + index),
  }));
  return [...standardRows, ...customRows].filter((row) => row.value && row.value !== "-");
}

function assetLabelScanText(asset, settings = state.assetLabelSettings) {
  const rows = settings.scanFields.map((key) => `${assetLabelFieldLabel(key)}:${assetLabelFieldValue(asset, key)}`);
  parseAssetLabelCustomFields(settings.customFields).forEach((field) => {
    rows.push(`${field.label}:${assetLabelCustomFieldValue(asset, field)}`);
  });
  return rows.filter(Boolean).join("\n");
}

const assetLabelQrVersions = [
  { version: 1, dataCodewords: 19, ecCodewords: 7, blocks: 1, remainder: 0, align: [] },
  { version: 2, dataCodewords: 34, ecCodewords: 10, blocks: 1, remainder: 7, align: [6, 18] },
  { version: 3, dataCodewords: 55, ecCodewords: 15, blocks: 1, remainder: 7, align: [6, 22] },
  { version: 4, dataCodewords: 80, ecCodewords: 20, blocks: 1, remainder: 7, align: [6, 26] },
  { version: 5, dataCodewords: 108, ecCodewords: 26, blocks: 1, remainder: 7, align: [6, 30] },
  { version: 6, dataCodewords: 136, ecCodewords: 18, blocks: 2, remainder: 7, align: [6, 34] },
  { version: 7, dataCodewords: 156, ecCodewords: 20, blocks: 2, remainder: 0, align: [6, 22, 38] },
  { version: 8, dataCodewords: 194, ecCodewords: 24, blocks: 2, remainder: 0, align: [6, 24, 42] },
  { version: 9, dataCodewords: 232, ecCodewords: 30, blocks: 2, remainder: 0, align: [6, 26, 46] },
];

const assetLabelQrGf = (() => {
  const exp = Array(512).fill(0);
  const log = Array(256).fill(0);
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    exp[index] = value;
    log[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < exp.length; index += 1) {
    exp[index] = exp[index - 255];
  }
  return { exp, log };
})();

function assetLabelQrMultiply(left, right) {
  if (!left || !right) return 0;
  return assetLabelQrGf.exp[assetLabelQrGf.log[left] + assetLabelQrGf.log[right]];
}

function assetLabelQrDivisor(degree) {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let offset = 0; offset < result.length; offset += 1) {
      result[offset] = assetLabelQrMultiply(result[offset], root);
      if (offset + 1 < result.length) result[offset] ^= result[offset + 1];
    }
    root = assetLabelQrMultiply(root, 0x02);
  }
  return result;
}

function assetLabelQrRemainder(data, degree) {
  const divisor = assetLabelQrDivisor(degree);
  const result = Array(degree).fill(0);
  data.forEach((byte) => {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] ^= assetLabelQrMultiply(coefficient, factor);
    });
  });
  return result;
}

function assetLabelUtf8Bytes(text) {
  return Array.from(new TextEncoder().encode(text));
}

function assetLabelQrBitsForText(bytes) {
  const bits = [0, 1, 0, 0];
  for (let shift = 7; shift >= 0; shift -= 1) bits.push((bytes.length >>> shift) & 1);
  bytes.forEach((byte) => {
    for (let shift = 7; shift >= 0; shift -= 1) bits.push((byte >>> shift) & 1);
  });
  return bits;
}

function assetLabelQrPickVersion(bytes) {
  const bitLength = assetLabelQrBitsForText(bytes).length;
  return assetLabelQrVersions.find((config) => bitLength <= config.dataCodewords * 8) || assetLabelQrVersions[assetLabelQrVersions.length - 1];
}

function assetLabelQrFitText(text) {
  let value = text || "-";
  let bytes = assetLabelUtf8Bytes(value);
  let config = assetLabelQrPickVersion(bytes);
  const maxBytes = Math.floor((config.dataCodewords * 8 - 12) / 8);
  if (bytes.length <= maxBytes) return { text: value, bytes, config };

  while (value.length && assetLabelUtf8Bytes(`${value}...`).length > maxBytes) {
    value = value.slice(0, -1);
  }
  value = `${value}...`;
  bytes = assetLabelUtf8Bytes(value);
  config = assetLabelQrPickVersion(bytes);
  return { text: value, bytes, config };
}

function assetLabelQrCodewords(text) {
  const { text: fittedText, bytes, config } = assetLabelQrFitText(text);
  const bits = assetLabelQrBitsForText(bytes);
  const capacityBits = config.dataCodewords * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  for (let index = 0; index < terminator; index += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const dataCodewords = [];
  for (let index = 0; index < bits.length; index += 8) {
    dataCodewords.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0; dataCodewords.length < config.dataCodewords; pad += 1) {
    dataCodewords.push(pad % 2 === 0 ? 0xec : 0x11);
  }

  const blockSize = config.dataCodewords / config.blocks;
  const blocks = Array.from({ length: config.blocks }, (_, index) => {
    const data = dataCodewords.slice(index * blockSize, (index + 1) * blockSize);
    return { data, ec: assetLabelQrRemainder(data, config.ecCodewords) };
  });
  const result = [];
  for (let index = 0; index < blockSize; index += 1) blocks.forEach((block) => result.push(block.data[index]));
  for (let index = 0; index < config.ecCodewords; index += 1) blocks.forEach((block) => result.push(block.ec[index]));
  return { text: fittedText, config, codewords: result };
}

function assetLabelQrSet(matrix, reserved, row, column, value, isFunction = true) {
  matrix[row][column] = value;
  if (isFunction) reserved[row][column] = true;
}

function assetLabelQrFinder(matrix, reserved, row, column) {
  for (let y = -4; y <= 4; y += 1) {
    for (let x = -4; x <= 4; x += 1) {
      const currentRow = row + y;
      const currentColumn = column + x;
      if (currentRow < 0 || currentColumn < 0 || currentRow >= matrix.length || currentColumn >= matrix.length) continue;
      const distance = Math.max(Math.abs(x), Math.abs(y));
      assetLabelQrSet(matrix, reserved, currentRow, currentColumn, distance !== 2 && distance !== 4);
    }
  }
}

function assetLabelQrAlignment(matrix, reserved, row, column) {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      assetLabelQrSet(matrix, reserved, row + y, column + x, Math.max(Math.abs(x), Math.abs(y)) === 2 || (x === 0 && y === 0));
    }
  }
}

function assetLabelQrFormatBits(mask = 0) {
  const data = (1 << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function assetLabelQrDrawFormat(matrix, reserved, mask = 0) {
  const size = matrix.length;
  const bits = assetLabelQrFormatBits(mask);
  const bit = (index) => Boolean((bits >>> index) & 1);
  for (let index = 0; index <= 5; index += 1) assetLabelQrSet(matrix, reserved, 8, index, bit(index));
  assetLabelQrSet(matrix, reserved, 8, 7, bit(6));
  assetLabelQrSet(matrix, reserved, 8, 8, bit(7));
  assetLabelQrSet(matrix, reserved, 7, 8, bit(8));
  for (let index = 9; index < 15; index += 1) assetLabelQrSet(matrix, reserved, 14 - index, 8, bit(index));
  for (let index = 0; index < 8; index += 1) assetLabelQrSet(matrix, reserved, size - 1 - index, 8, bit(index));
  for (let index = 8; index < 15; index += 1) assetLabelQrSet(matrix, reserved, 8, size - 15 + index, bit(index));
  assetLabelQrSet(matrix, reserved, 8, size - 8, true);
}

function assetLabelQrMatrix(text) {
  const { text: fittedText, config, codewords } = assetLabelQrCodewords(text);
  const size = 21 + (config.version - 1) * 4;
  const matrix = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  assetLabelQrFinder(matrix, reserved, 3, 3);
  assetLabelQrFinder(matrix, reserved, 3, size - 4);
  assetLabelQrFinder(matrix, reserved, size - 4, 3);

  for (let index = 0; index < size; index += 1) {
    if (!reserved[6][index]) assetLabelQrSet(matrix, reserved, 6, index, index % 2 === 0);
    if (!reserved[index][6]) assetLabelQrSet(matrix, reserved, index, 6, index % 2 === 0);
  }

  config.align.forEach((row) => {
    config.align.forEach((column) => {
      const overlapsFinder =
        (row === 6 && column === 6) ||
        (row === 6 && column === size - 7) ||
        (row === size - 7 && column === 6);
      if (!overlapsFinder) assetLabelQrAlignment(matrix, reserved, row, column);
    });
  });

  assetLabelQrDrawFormat(matrix, reserved, 0);

  const dataBits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1));
  for (let index = 0; index < config.remainder; index += 1) dataBits.push(0);
  let bitIndex = 0;
  let upward = true;
  for (let column = size - 1; column >= 1; column -= 2) {
    if (column === 6) column -= 1;
    for (let offset = 0; offset < size; offset += 1) {
      const row = upward ? size - 1 - offset : offset;
      for (let currentColumn = column; currentColumn >= column - 1; currentColumn -= 1) {
        if (reserved[row][currentColumn]) continue;
        const mask = (row + currentColumn) % 2 === 0;
        matrix[row][currentColumn] = Boolean(dataBits[bitIndex] || 0) !== mask;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  return { matrix, text: fittedText };
}

function assetLabelQrMarkup(text) {
  const { matrix, text: fittedText } = assetLabelQrMatrix(text);
  const size = matrix.length;
  const path = [];
  matrix.forEach((row, y) => {
    row.forEach((active, x) => {
      if (active) path.push(`M${x + 4} ${y + 4}h1v1H${x + 4}z`);
    });
  });
  const label = fittedText.replace(/\s+/g, " ").trim();
  return `<svg class="asset-label-qr" viewBox="0 0 ${size + 8} ${size + 8}" role="img" aria-label="${escapeHtml(label)}">
    <rect width="${size + 8}" height="${size + 8}" fill="#ffffff"></rect>
    <path d="${path.join("")}" fill="#000000"></path>
  </svg>`;
}

function chunkRows(rows, size) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function assetLabelCssVars(settings = state.assetLabelSettings) {
  const logoScale = assetLabelLogoScale(settings) / 100;
  const maxPrintQrSize = Math.max(8, Math.min(settings.labelWidth - 4, settings.labelHeight - 4, 72));
  const printQrSize = Math.round(Math.min(settings.qrSize * 1.2, maxPrintQrSize) * 10) / 10;
  return [
    `--label-width:${settings.labelWidth}mm`,
    `--label-height:${settings.labelHeight}mm`,
    `--label-logo-width:${settings.logoWidth * logoScale}mm`,
    `--label-logo-height:${settings.logoHeight * logoScale}mm`,
    `--label-qr-size:${settings.qrSize}mm`,
    `--label-print-qr-size:${printQrSize}mm`,
    `--label-qr-text-gap:${settings.qrTextGap}mm`,
    `--label-font-size:${settings.fontSize}px`,
    `--label-content-scale:${settings.contentScale / 100}`,
    `--label-offset-x:${settings.offsetX}mm`,
    `--label-offset-y:${settings.offsetY}mm`,
    `--label-columns:${settings.columns}`,
    `--label-column-gap:${settings.columnGap}mm`,
    `--label-row-gap:${settings.rowGap}mm`,
  ].join(";");
}

function assetLabelCardMarkup(asset, settings = state.assetLabelSettings) {
  const scanText = assetLabelScanText(asset, settings);
  const rows = assetLabelRows(asset, settings);
  const logoMarkup = settings.logoImage
    ? `<span class="asset-label-logo has-image"><img src="${escapeHtml(settings.logoImage)}" alt="${escapeHtml(settings.logoText || "Logo")}"></span>`
    : `<span class="asset-label-logo">${escapeHtml(settings.logoText || "AM")}</span>`;
  return `<article class="asset-print-label">
    <div class="asset-label-content">
      <div class="asset-label-main">
        <header class="asset-label-header">
          ${settings.showLogo ? logoMarkup : ""}
          <strong>${escapeHtml(asset.id)}</strong>
        </header>
        <div class="asset-label-name">${escapeHtml(asset.name || "-")}</div>
        <div class="asset-label-fields">
          ${rows
            .map(
              (row) =>
                `<div style="--label-row-font-size:${row.fontSize}px"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`
            )
            .join("")}
        </div>
      </div>
      <aside class="asset-label-scan">
        ${assetLabelQrMarkup(scanText)}
        <small>${escapeHtml(scanText.split("\n").slice(0, 2).join(" / "))}</small>
      </aside>
    </div>
  </article>`;
}

function assetLabelTemplatePrintRows(asset, settings = state.assetLabelSettings, count = 3) {
  const keys = (settings.fields || []).filter(Boolean).slice(0, count);
  return (keys.length ? keys : ["name", "id", "category"].slice(0, count)).map((key, index) => ({
    key,
    label: assetLabelFieldLabel(key),
    value: assetLabelFieldValue(asset, key),
    fontSize: assetLabelFieldFontSize(settings, index),
  }));
}

function assetLabelTemplatePrintMarkup(asset, settings = state.assetLabelSettings) {
  const baseTemplateKey = assetLabelTemplateBaseKey(settings.templateKey);
  const scanText = assetLabelScanText(asset, settings) || `资产编码:${asset.id}`;
  const sizeText = `${Math.round(settings.labelWidth)}*${Math.round(settings.labelHeight)}mm`;
  if (baseTemplateKey === "standard") {
    const rows = assetLabelTemplatePrintRows(asset, settings, 3);
    const logoScale = assetLabelLogoScale(settings) / 100;
    const logoMarkup = settings.logoImage
      ? `<span class="template-print-logo has-image"><img src="${escapeHtml(settings.logoImage)}" alt="${escapeHtml(settings.logoText || "Logo")}"></span>`
      : settings.showLogo
        ? `<span class="template-print-logo">${escapeHtml(settings.logoText || "AM")}</span>`
        : "";
    return `<article class="asset-print-label template-print-label is-standard-template" style="--template-logo-width:${settings.logoWidth * logoScale}mm;--template-logo-height:${settings.logoHeight * logoScale}mm;">
      ${logoMarkup}
      <div class="standard-template-print-content">
        <div class="standard-template-print-qr">${assetLabelQrMarkup(scanText || `模板:配置1\n尺寸:${sizeText}`)}</div>
        <div class="standard-template-print-fields">
          ${rows.map((row) => `<span style="--template-row-font-size:${row.fontSize}px">${escapeHtml(row.value)}</span>`).join("")}
        </div>
      </div>
    </article>`;
  }
  if (baseTemplateKey === "compact") {
    const rows = assetLabelTemplatePrintRows(asset, settings, 4);
    return `<article class="asset-print-label template-print-label is-compact-template">
      <div class="compact-template-print-content">
        <div class="compact-template-print-qr">${assetLabelQrMarkup(scanText || `模板:配置1\n尺寸:${sizeText}`)}</div>
        <div class="compact-template-print-fields">
          ${rows.map((row) => `<span style="--template-row-font-size:${row.fontSize}px">${escapeHtml(row.value)}</span>`).join("")}
        </div>
      </div>
    </article>`;
  }
  if (baseTemplateKey === "full") {
    const rows = assetLabelTemplatePrintRows(asset, settings, 2);
    return `<article class="asset-print-label template-print-label is-full-template">
      <div class="full-template-print-body">
        <div class="full-template-print-qr">${assetLabelQrMarkup(scanText || `模板:配置1\n尺寸:${sizeText}`)}</div>
        <div class="full-template-print-fields">
          ${rows.map((row) => `<span style="--template-row-font-size:${row.fontSize}px">${escapeHtml(row.value)}</span>`).join("")}
        </div>
      </div>
    </article>`;
  }
  return assetLabelCardMarkup(asset, settings);
}

function assetLabelPreviewMarkup(assets, settings = state.assetLabelSettings) {
  const perPage = Math.max(1, settings.columns * settings.rows);
  return chunkRows(assets, perPage)
    .map(
      (pageRows, index) => `<section class="asset-label-sheet" style="${assetLabelCssVars(settings)}" data-label-page="${index + 1}">
        ${pageRows.map((asset) => assetLabelTemplatePrintMarkup(asset, settings)).join("")}
      </section>`
    )
    .join("");
}

function assetLabelCheckboxes(name, selected) {
  const selectedSet = new Set(selected);
  return assetLabelFieldOptions
    .map(
      (field) => `<label class="label-field-check ${selectedSet.has(field.key) ? "checked" : ""}">
        <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(field.key)}" ${selectedSet.has(field.key) ? "checked" : ""}>
        <span>${escapeHtml(field.label)}</span>
      </label>`
    )
    .join("");
}

function assetLabelTemplateOptions(selected) {
  return assetLabelTemplates
    .map((template) => `<option value="${escapeHtml(template.key)}" ${template.key === selected ? "selected" : ""}>${escapeHtml(template.name)}</option>`)
    .join("");
}

function assetLabelFieldSelectOptions(selected = "", placeholder = "选择字段") {
  return [
    `<option value="" ${selected ? "" : "selected"}>${escapeHtml(placeholder)}</option>`,
    ...assetLabelFieldOptions.map(
      (field) => `<option value="${escapeHtml(field.key)}" ${field.key === selected ? "selected" : ""}>${escapeHtml(field.label)}</option>`
    ),
  ].join("");
}

function assetLabelTemplateByKey(templateKey) {
  return assetLabelTemplates.find((template) => template.key === templateKey) || assetLabelTemplates[0];
}

function assetLabelTemplateBaseKey(templateKey = "standard") {
  const template = assetLabelTemplateByKey(templateKey);
  return template.baseTemplateKey || template.key;
}

function assetLabelTemplateSampleRowsFromFields(fields = []) {
  const fieldsToShow = Array.isArray(fields) ? fields : [];
  const fieldsLimit = Math.max(3, Math.min(4, fieldsToShow.length));
  const fieldsSlice = fieldsToShow.slice(0, fieldsLimit);
  const rows = fieldsSlice.length ? fieldsSlice : ["id", "name", "category"];
  return rows
    .map((fieldKey, index) => `<p><span>字段名称${index + 1}：</span><strong>${escapeHtml(assetLabelFieldLabel(fieldKey) || "xxxx")}</strong></p>`)
    .join("");
}

function assetLabelTemplateSampleRows(template) {
  const rowCount = template.sampleLayout === "fields4" ? 4 : 3;
  if (template.sampleLayout === "topField") {
    return `<p><span>字段名称1：</span><strong>xxxx</strong></p>
      <p><span>字段名称2：</span><strong>xxxx</strong></p>`;
  }
  return Array.from({ length: rowCount }, (_, index) => `<p><span>字段名称${index + 1}：</span><strong>xxxx</strong></p>`).join("");
}

function assetLabelTemplateSamplePreview(settings = state.assetLabelSettings) {
  const template = assetLabelTemplateByKey(settings.templateKey);
  const sizeText = `${Math.round(settings.labelWidth)}*${Math.round(settings.labelHeight)}mm`;
  return `<div class="asset-label-template-config-preview is-sample">
    <div class="asset-label-template-ticket">
      <div class="asset-label-template-qr">
        ${assetLabelQrMarkup(`模板:${template.name}\n尺寸:${sizeText}`)}
      </div>
      <div class="asset-label-template-fields">
        ${assetLabelTemplateSampleRowsFromFields(settings.fields)}
      </div>
    </div>
  </div>`;
}

function assetLabelTemplatePreviewMetrics(settings) {
  const pxPerMm = 3.78;
  const rawWidth = settings.labelWidth * pxPerMm;
  const rawHeight = settings.labelHeight * pxPerMm;
  const scale = Math.min(1, 230 / rawWidth, 94 / rawHeight);
  return {
    scale: Math.max(0.62, Math.round(scale * 100) / 100),
    width: Math.round(rawWidth * scale),
    height: Math.round(rawHeight * scale),
  };
}

function defaultAssetLabelTemplatePreview(templateKey = "defaultAsset") {
  const asset = assetLabelTemplateDemoAsset();
  const settings = assetLabelTemplateDefaults(templateKey);
  const scanText = assetLabelScanText(asset, settings);
  const fieldRows = [
    ["资产编码", asset.id],
    ["资产名称", asset.name],
    ["资产分类", asset.category],
    ["使用人", asset.owner],
    ["所在位置", asset.location],
  ];
  return `<div class="default-asset-template-label" aria-label="默认资产标签内容预览">
    <div class="default-asset-template-logo">AM</div>
    <strong class="default-asset-template-code">${escapeHtml(asset.id)}</strong>
    <div class="default-asset-template-name">${escapeHtml(asset.name)}</div>
    <div class="default-asset-template-fields">
      ${fieldRows.map(([label, value]) => `<p><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></p>`).join("")}
    </div>
    <div class="default-asset-template-qr">${assetLabelQrMarkup(scanText)}</div>
    <small class="default-asset-template-caption">资产编码:${escapeHtml(asset.id)}...</small>
  </div>`;
}

function assetLabelTemplatePreviewCard(template, selected = false) {
  const settings = normalizeAssetLabelSettings(assetLabelTemplateDefaults(template.key));
  const sizeText = `${Math.round(settings.labelWidth)}*${Math.round(settings.labelHeight)}mm`;
  const metrics = assetLabelTemplatePreviewMetrics(settings);
  const isLivePreview = template.previewMode === "label";
  const isDefaultPreview = assetLabelTemplateBaseKey(template.key) === "defaultAsset";
  const sampleLayoutClass = template.sampleLayout ? ` is-${template.sampleLayout}` : "";
  return `<article class="asset-label-template-card ${selected ? "active" : ""}" data-label-template-card="${escapeHtml(template.key)}">
    <button class="asset-label-template-radio" type="button" aria-label="选择${escapeHtml(template.name)}" aria-pressed="${selected ? "true" : "false"}">
      <span></span>
    </button>
    <header class="asset-label-template-card-head">
      <strong>${escapeHtml(sizeText)}</strong>
      <i aria-hidden="true"></i>
      <strong>${escapeHtml(sizeText)}</strong>
    </header>
    <div class="asset-label-template-preview ${isDefaultPreview ? "is-default" : isLivePreview ? "is-live" : ""}">
      ${
        isDefaultPreview
          ? defaultAssetLabelTemplatePreview(template.key)
          : isLivePreview
          ? `<div class="asset-label-template-preview-frame" style="${assetLabelCssVars(settings)};--label-template-preview-scale:${metrics.scale};--label-template-preview-width:${metrics.width}px;--label-template-preview-height:${metrics.height}px;">
              <div class="asset-label-template-preview-zoom">
                ${assetLabelCardMarkup(assetLabelTemplateDemoAsset(), settings)}
              </div>
            </div>`
          : `<div class="asset-label-template-ticket${sampleLayoutClass}">
              <div class="asset-label-template-qr">
                ${assetLabelQrMarkup(`模板:${template.name}\n尺寸:${sizeText}`)}
              </div>
              <div class="asset-label-template-fields">
                ${assetLabelTemplateSampleRows(template)}
              </div>
            </div>`
      }
        </div>
  </article>`;
}

function assetLabelTemplateDemoAsset() {
  return {
    id: "010100012",
    name: "MacBook",
    category: "笔记本电脑",
    status: "在用",
    owner: "未分配",
    employeeCode: "A001",
    department: "信息部",
    location: "杭州公司",
    brand: "品牌",
    model: "型号",
    sn: "SN0001",
    phone: "13800000000",
    email: "user@example.com",
    receiveDate: todayValue(),
    assetTag: "标签",
    price: "0.00",
    supplier: "供应商",
    purchaseMethod: "购置",
  };
}

function assetLabelHiddenFieldInputs(name, values = []) {
  return values.map((value) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join("");
}

function assetLabelLogoUploadMarkup(settings = state.assetLabelSettings, extraClass = "") {
  const hasLogo = Boolean(settings.logoImage);
  return `<div class="asset-label-template-logo-drop ${extraClass}" data-label-logo-upload role="button" tabindex="0">
    <input type="file" accept="image/*" data-label-logo-file hidden>
    ${
      hasLogo
        ? `<span class="has-logo-image"><img src="${escapeHtml(settings.logoImage)}" alt="${escapeHtml(settings.logoText || "Logo")}"></span>`
        : `<span>＋</span>`
    }
    <strong>${hasLogo ? "更换 Logo" : "上传 Logo"}</strong>
  </div>`;
}

function assetLabelTemplateConfigPreview(settings = state.assetLabelSettings) {
  const template = assetLabelTemplateByKey(settings.templateKey);
  const baseTemplateKey = assetLabelTemplateBaseKey(settings.templateKey);
  if (baseTemplateKey === "standard") return firstAssetLabelTemplateConfigPreview(settings);
  if (baseTemplateKey === "compact") return secondAssetLabelTemplateConfigPreview(settings);
  if (baseTemplateKey === "full") return thirdAssetLabelTemplateConfigPreview(settings);
  if (template.previewMode !== "label") return assetLabelTemplateSamplePreview(settings);
  return `<div class="asset-label-template-config-preview" style="${assetLabelCssVars(settings)}">
    ${assetLabelCardMarkup(assetLabelTemplateDemoAsset(), settings)}
  </div>`;
}

function defaultAssetLabelEditorPreview(settings = state.assetLabelSettings) {
  const metrics = assetLabelTemplatePreviewMetrics(settings);
  return `<section class="default-label-editor-preview-section" data-default-label-editor-preview>
    <div class="default-label-editor-preview-stage">
      <div class="default-label-editor-preview-frame" style="${assetLabelCssVars(settings)};--label-template-preview-scale:${metrics.scale};--label-template-preview-width:${metrics.width}px;--label-template-preview-height:${metrics.height}px;">
        <div class="asset-label-template-preview-zoom">
          ${assetLabelCardMarkup(assetLabelTemplateDemoAsset(), settings)}
        </div>
      </div>
    </div>
  </section>`;
}

function firstAssetLabelTemplateConfigPreview(settings = state.assetLabelSettings) {
  const sizeText = `${Math.round(settings.labelWidth)}*${Math.round(settings.labelHeight)}mm`;
  const fields = (settings.fields || []).filter(Boolean).slice(0, 3);
  const previewFields = fields.length ? fields : ["name", "id", "category"];
  const logoScale = assetLabelLogoScale(settings) / 100;
  const logoMarkup = settings.logoImage
    ? `<span class="first-label-preview-logo has-image"><img src="${escapeHtml(settings.logoImage)}" alt="${escapeHtml(settings.logoText || "Logo")}"></span>`
    : settings.showLogo
      ? `<span class="first-label-preview-logo">${escapeHtml(settings.logoText || "AM")}</span>`
      : "";
  const styleVars = [
    `--first-label-width:${settings.labelWidth}mm`,
    `--first-label-height:${settings.labelHeight}mm`,
    `--first-label-logo-width:${settings.logoWidth * logoScale}mm`,
    `--first-label-logo-height:${settings.logoHeight * logoScale}mm`,
    `--first-label-content-scale:${settings.contentScale / 100}`,
    `--first-label-offset-x:${settings.offsetX}mm`,
    `--first-label-offset-y:${settings.offsetY}mm`,
    `--first-label-qr-size:${settings.qrSize}mm`,
    `--first-label-qr-text-gap:${settings.qrTextGap}mm`,
  ].join(";");
  return `<div class="first-label-config-preview" style="${styleVars}" aria-label="配置1 ${escapeHtml(sizeText)} 预览">
    <div class="first-label-preview-card">
      ${logoMarkup}
      <div class="first-label-preview-content">
        <div class="first-label-preview-qr">${assetLabelQrMarkup(`模板:配置1\n尺寸:${sizeText}`)}</div>
        <div class="first-label-preview-fields">
          ${previewFields
            .map((fieldKey, index) => `<span style="--first-label-row-font-size:${assetLabelFieldFontSize(settings, index)}px">${escapeHtml(assetLabelFieldLabel(fieldKey))}</span>`)
            .join("")}
        </div>
      </div>
    </div>
  </div>`;
}

function secondAssetLabelTemplateConfigPreview(settings = state.assetLabelSettings) {
  const sizeText = `${Math.round(settings.labelWidth)}*${Math.round(settings.labelHeight)}mm`;
  return `<div class="second-label-config-preview" style="${assetLabelCssVars(settings)}" aria-label="配置1 ${escapeHtml(sizeText)} 预览">
    <div class="second-label-preview-card">
      <div class="second-label-preview-content">
        <div class="second-label-preview-qr">${assetLabelQrMarkup(`模板:配置1\n尺寸:${sizeText}`)}</div>
        <div class="second-label-preview-fields">
          ${[1, 2, 3, 4].map((item, index) => `<span style="--second-label-row-font-size:${assetLabelFieldFontSize(settings, index)}px">字段名${item}：xxxx</span>`).join("")}
        </div>
      </div>
    </div>
  </div>`;
}

function thirdAssetLabelTemplateConfigPreview(settings = state.assetLabelSettings) {
  const sizeText = `${Math.round(settings.labelWidth)}*${Math.round(settings.labelHeight)}mm`;
  return `<div class="third-label-config-preview" style="${assetLabelCssVars(settings)}" aria-label="配置1 ${escapeHtml(sizeText)} 预览">
    <div class="third-label-preview-card">
      <div class="third-label-preview-body">
        <div class="third-label-preview-qr">${assetLabelQrMarkup(`模板:配置1\n尺寸:${sizeText}`)}</div>
        <div class="third-label-preview-fields">
          <span style="--third-label-row-font-size:${assetLabelFieldFontSize(settings, 0)}px">资产名称</span>
          <span style="--third-label-row-font-size:${assetLabelFieldFontSize(settings, 1)}px">资产编码</span>
        </div>
      </div>
    </div>
  </div>`;
}

function assetLabelTemplateConfigPanel(settings) {
  const baseTemplateKey = assetLabelTemplateBaseKey(settings.templateKey);
  const isFirstTemplate = baseTemplateKey === "standard";
  const isSecondTemplate = baseTemplateKey === "compact";
  const isThirdTemplate = baseTemplateKey === "full";
  const isDefaultTemplate = baseTemplateKey === "defaultAsset";
  const currentTemplate = assetLabelTemplateByKey(settings.templateKey);
  const logoScale = assetLabelLogoScale(settings);
  const deleteButtonMarkup = currentTemplate.custom
    ? `<button class="asset-label-template-delete" type="button" data-label-template-delete="${escapeHtml(currentTemplate.key)}">删除模板</button>`
    : "";
  const sizeText = `${Math.round(settings.labelWidth)}*${Math.round(settings.labelHeight)}mm`;
  const defaultConfigFieldKeys = isSecondTemplate ? ["", "", "", ""] : isThirdTemplate ? ["name", "id"] : ["name", "id", "category"];
  const configFieldKeys = defaultConfigFieldKeys.map((fallback, index) => (settings.fields?.[index] === undefined ? fallback : settings.fields[index]));
  const configFields = configFieldKeys.map((key) => ({ key, label: key ? assetLabelFieldLabel(key) : "选择字段" }));
  const firstFieldRows = configFields
    .map(
      (field, index) => {
        const fieldFontSize = assetLabelFieldFontSize(settings, index);
        return `<div class="asset-label-template-field-row">
        <select name="fields">
          ${assetLabelFieldSelectOptions(field.key)}
        </select>
        <div class="asset-label-template-stepper">
          <button type="button" data-label-font-step="${index}" data-step="-1">−</button>
          <input name="fieldFontSizes" type="number" min="5" max="22" step="1" value="${escapeHtml(fieldFontSize)}" data-label-font-value="${index}" aria-label="第${index + 1}行字号">
          <button type="button" data-label-font-step="${index}" data-step="1">＋</button>
        </div>
        <label class="asset-label-template-check ${isFirstTemplate || isThirdTemplate ? "checked" : ""}">
          <input type="checkbox" ${isFirstTemplate || isThirdTemplate ? "checked" : ""}>
          <span>隐藏字段名</span>
        </label>
        <label class="asset-label-template-check">
          <input type="checkbox">
          <span>字体加粗</span>
        </label>
      </div>`;
      }
    )
    .join("");
  if (isFirstTemplate || isSecondTemplate || isThirdTemplate) {
    return `<form class="asset-label-template-config-form first-template-config-form" data-label-template-settings-form>
      <input type="hidden" name="templateKey" value="${escapeHtml(settings.templateKey)}">
      ${assetLabelHiddenFieldInputs("scanFields", settings.scanFields)}
      <input type="hidden" name="customFields" value="${escapeHtml(settings.customFields)}">
      <input type="hidden" name="logoWidth" value="${escapeHtml(settings.logoWidth)}">
      <input type="hidden" name="logoHeight" value="${escapeHtml(settings.logoHeight)}">
      <input type="hidden" name="logoText" value="${escapeHtml(settings.logoText)}">
      <input type="hidden" name="logoImage" value="${escapeHtml(settings.logoImage)}">
      <input type="hidden" name="fontSize" value="${escapeHtml(settings.fontSize)}">
      <input type="hidden" name="showLogo" value="${settings.showLogo ? "on" : ""}">

      <div class="asset-label-template-config-tabs">
        <button class="asset-label-template-config-tab active" type="button">配置1 <span aria-hidden="true">✎</span></button>
        <div class="asset-label-template-tab-actions">
          ${deleteButtonMarkup}
          <button class="asset-label-template-add" type="button" data-label-template-add>＋新增</button>
        </div>
      </div>

      <div class="asset-label-template-stage" data-label-template-config-preview>
        ${assetLabelTemplateConfigPreview(settings)}
      </div>

      <section class="asset-label-template-config-section first-config-section">
        <h2>标签logo设置</h2>
        ${assetLabelLogoUploadMarkup(settings, "first-logo-drop")}
        <div class="asset-label-template-slider-row first-slider-row">
          <label>
            <span>logo缩放（%）</span>
            <input type="range" name="logoScale" min="50" max="160" step="1" value="${escapeHtml(logoScale)}" data-label-logo-scale>
          </label>
          <div class="asset-label-template-stepper">
            <button type="button" data-label-logo-scale-step="-1">−</button>
            <span data-label-logo-scale-value>${escapeHtml(logoScale)}</span>
            <button type="button" data-label-logo-scale-step="1">＋</button>
          </div>
        </div>
      </section>

      <section class="asset-label-template-config-section first-config-section">
        <h2>标签尺寸</h2>
        <div class="first-config-two-cols">
          <label class="first-inline-stepper">
            <span>标签宽度（mm）</span>
            <div class="asset-label-template-stepper">
              <button type="button" data-label-number-step="labelWidth" data-step="-1">−</button>
              <input name="labelWidth" type="number" min="20" max="160" step="1" value="${escapeHtml(settings.labelWidth)}">
              <button type="button" data-label-number-step="labelWidth" data-step="1">＋</button>
            </div>
          </label>
          <label class="first-inline-stepper">
            <span>标签高度（mm）</span>
            <div class="asset-label-template-stepper">
              <button type="button" data-label-number-step="labelHeight" data-step="-1">−</button>
              <input name="labelHeight" type="number" min="12" max="120" step="1" value="${escapeHtml(settings.labelHeight)}">
              <button type="button" data-label-number-step="labelHeight" data-step="1">＋</button>
            </div>
          </label>
        </div>
        <div class="asset-label-template-slider-row first-slider-row">
          <label>
            <span>内容缩放（%）</span>
            <input type="range" name="contentScale" min="50" max="160" step="1" value="${escapeHtml(settings.contentScale)}" data-label-content-scale>
          </label>
          <div class="asset-label-template-stepper">
            <button type="button" data-label-scale-step="-1">−</button>
            <span data-label-scale-value>${escapeHtml(settings.contentScale)}</span>
            <button type="button" data-label-scale-step="1">＋</button>
          </div>
        </div>
      </section>

      <section class="asset-label-template-config-section first-config-section">
        <h2>位置调整</h2>
        <div class="first-config-two-cols">
          <label class="first-config-input">
            <span>左右位移（mm）：</span>
            <input name="offsetX" type="number" min="-30" max="30" step="0.5" value="${escapeHtml(settings.offsetX)}">
          </label>
          <label class="first-config-input">
            <span>上下位移（mm）：</span>
            <input name="offsetY" type="number" min="-30" max="30" step="0.5" value="${escapeHtml(settings.offsetY)}">
          </label>
          <label class="first-config-input">
            <span>码字间距（mm）：</span>
            <input name="qrTextGap" type="number" min="0" max="30" step="0.5" value="${escapeHtml(settings.qrTextGap)}">
          </label>
          <label class="first-config-input">
            <span>二维码大小（mm）：</span>
            <input name="qrSize" type="number" min="8" max="60" step="0.5" value="${escapeHtml(settings.qrSize)}">
          </label>
        </div>
      </section>

      <section class="asset-label-template-config-section first-config-section">
        <h2>字段</h2>
        <div class="asset-label-template-field-list">${firstFieldRows}</div>
      </section>

      <section class="asset-label-template-config-section first-config-section">
        <h2>打印排列</h2>
        <div class="first-config-two-cols">
          <label class="first-config-input">
            <span>打印列数：</span>
            <input name="columns" type="number" min="1" max="8" step="1" value="${escapeHtml(settings.columns)}">
          </label>
          <label class="first-config-input">
            <span>打印行数：</span>
            <input name="rows" type="number" min="1" max="14" step="1" value="${escapeHtml(settings.rows)}">
          </label>
          <label class="first-config-input">
            <span>上下间距：</span>
            <input name="rowGap" type="number" min="0" max="30" step="0.5" value="${escapeHtml(settings.rowGap)}">
          </label>
          <label class="first-config-input">
            <span>左右间距：</span>
            <input name="columnGap" type="number" min="0" max="30" step="0.5" value="${escapeHtml(settings.columnGap)}">
          </label>
        </div>
      </section>

      <section class="asset-label-template-config-section first-config-section">
        <h2>扫码展示字段 <button type="button" class="first-clear-link">清空</button></h2>
        <button class="first-add-field" type="button">＋添加字段</button>
      </section>

      <div class="first-template-actions">
        <button type="button" class="btn" data-label-template-reset>重 置</button>
        <button type="button" class="btn primary" data-label-template-save>保 存</button>
      </div>
    </form>`;
  }
  if (isDefaultTemplate) return defaultAssetLabelEditForm(settings, { mode: "template" });
  return `<form class="asset-label-template-config-form" data-label-template-settings-form>
    <input type="hidden" name="templateKey" value="${escapeHtml(settings.templateKey)}">
    ${assetLabelHiddenFieldInputs("fields", settings.fields)}
    ${assetLabelHiddenFieldInputs("scanFields", settings.scanFields)}
    <input type="hidden" name="customFields" value="${escapeHtml(settings.customFields)}">
    <input type="hidden" name="contentScale" value="${escapeHtml(settings.contentScale)}">
    <input type="hidden" name="qrTextGap" value="${escapeHtml(settings.qrTextGap)}">
    <input type="hidden" name="offsetX" value="${escapeHtml(settings.offsetX)}">
    <input type="hidden" name="offsetY" value="${escapeHtml(settings.offsetY)}">
    <input type="hidden" name="columns" value="${escapeHtml(settings.columns)}">
    <input type="hidden" name="rows" value="${escapeHtml(settings.rows)}">
    <input type="hidden" name="columnGap" value="${escapeHtml(settings.columnGap)}">
    <input type="hidden" name="rowGap" value="${escapeHtml(settings.rowGap)}">
    <input type="hidden" name="logoImage" value="${escapeHtml(settings.logoImage)}">

    <div class="asset-label-template-config-tabs">
      <button class="asset-label-template-config-tab active" type="button">配置1 <span aria-hidden="true">✎</span></button>
      <div class="asset-label-template-tab-actions">
        ${deleteButtonMarkup}
        <button class="asset-label-template-add" type="button" data-label-template-add>＋新增</button>
      </div>
    </div>

    <div class="asset-label-template-stage" data-label-template-config-preview>
      ${assetLabelTemplateConfigPreview(settings)}
    </div>

    <section class="asset-label-template-config-section">
      <h2>标签logo设置</h2>
      ${assetLabelLogoUploadMarkup(settings)}
      <label class="asset-label-template-toggle">
        <input type="checkbox" name="showLogo" ${settings.showLogo ? "checked" : ""}>
        <span>显示 Logo</span>
      </label>
      <div class="asset-label-template-slider-row">
        <label>
          <span>logo缩放（%）</span>
          <input type="range" name="logoScale" min="50" max="160" step="1" value="${escapeHtml(logoScale)}" data-label-logo-scale>
        </label>
        <div class="asset-label-template-stepper">
          <button type="button" data-label-logo-scale-step="-1">−</button>
          <span data-label-logo-scale-value>${escapeHtml(logoScale)}</span>
          <button type="button" data-label-logo-scale-step="1">＋</button>
        </div>
      </div>
    </section>

    <section class="asset-label-template-config-section">
      <h2>标签尺寸</h2>
      <div class="asset-label-template-size-summary" data-label-size-summary>${escapeHtml(sizeText)}</div>
      <div class="asset-label-template-config-grid">
        <label>
          <span>标签宽 mm</span>
          <input name="labelWidth" type="number" min="20" max="160" step="1" value="${escapeHtml(settings.labelWidth)}">
        </label>
        <label>
          <span>标签高 mm</span>
          <input name="labelHeight" type="number" min="12" max="120" step="1" value="${escapeHtml(settings.labelHeight)}">
        </label>
        <label>
          <span>二维码 mm</span>
          <input name="qrSize" type="number" min="8" max="60" step="1" value="${escapeHtml(settings.qrSize)}">
        </label>
        <label>
          <span>字体 px</span>
          <input name="fontSize" type="number" min="5" max="22" step="1" value="${escapeHtml(settings.fontSize)}">
        </label>
        <label>
          <span>Logo 宽 mm</span>
          <input name="logoWidth" type="number" min="0" max="60" step="1" value="${escapeHtml(settings.logoWidth)}">
        </label>
        <label>
          <span>Logo 高 mm</span>
          <input name="logoHeight" type="number" min="0" max="40" step="1" value="${escapeHtml(settings.logoHeight)}">
        </label>
        <label class="wide">
          <span>Logo 文案</span>
          <input name="logoText" value="${escapeHtml(settings.logoText)}" maxlength="12">
        </label>
      </div>
    </section>
  </form>`;
}

function defaultAssetLabelEditForm(settings, options = {}) {
  const mode = options.mode || "print";
  const formClass = mode === "template" ? "asset-label-template-config-form default-label-editor-form" : "asset-label-config default-label-editor-form";
  const formAttr = mode === "template" ? "data-label-template-settings-form" : "data-asset-label-form";
  const countMarkup = mode === "print" ? `<span class="tag blue" data-label-count>${escapeHtml(options.countText || "")}</span>` : "";
  const actionMarkup =
    mode === "template"
      ? `<div class="modal-actions label-print-actions default-label-editor-actions">
          <button type="button" class="btn" data-label-template-reset>重 置</button>
          <button type="button" class="btn primary" data-label-template-save>保 存</button>
        </div>`
      : `<div class="modal-actions label-print-actions default-label-editor-actions">
          <button type="button" class="btn" data-cancel-modal>取消</button>
          <button type="button" class="btn" data-save-label-settings>保存配置</button>
          <button type="button" class="btn primary" data-print-asset-labels-now>打印标签</button>
        </div>`;
  return `<form class="${formClass}" ${formAttr}>
    <div class="label-config-head default-label-editor-head">
      <div>
        <div class="eyebrow">标签打印配置</div>
        <h3>模板、尺寸、字段与版面</h3>
      </div>
      ${countMarkup}
    </div>

    ${defaultAssetLabelEditorPreview(settings)}

    <section class="label-config-section default-label-editor-section default-label-template-section">
      <label class="label-config-field wide">
        <span>标签模板</span>
        <select name="templateKey" data-label-template-select>${assetLabelTemplateOptions(settings.templateKey)}</select>
      </label>
      <label class="label-toggle-field default-label-logo-toggle">
        <input type="checkbox" name="showLogo" ${settings.showLogo ? "checked" : ""}>
        <span>显示 Logo</span>
      </label>
      <label class="label-config-field default-field-width">
        <span>标签宽 mm</span>
        <input name="labelWidth" type="number" min="20" max="160" step="1" value="${escapeHtml(settings.labelWidth)}">
      </label>
      <label class="label-config-field default-field-height">
        <span>标签高 mm</span>
        <input name="labelHeight" type="number" min="12" max="120" step="1" value="${escapeHtml(settings.labelHeight)}">
      </label>
      <label class="label-config-field default-field-logo-width">
        <span>Logo 宽 mm</span>
        <input name="logoWidth" type="number" min="0" max="60" step="1" value="${escapeHtml(settings.logoWidth)}">
      </label>
      <label class="label-config-field default-field-logo-height">
        <span>Logo 高 mm</span>
        <input name="logoHeight" type="number" min="0" max="40" step="1" value="${escapeHtml(settings.logoHeight)}">
      </label>
      <label class="label-config-field default-field-logo-text">
        <span>Logo 文案</span>
        <input name="logoText" value="${escapeHtml(settings.logoText)}" maxlength="12">
      </label>
      <input type="hidden" name="logoImage" value="${escapeHtml(settings.logoImage)}">
      <input type="hidden" name="logoScale" value="${escapeHtml(settings.logoScale)}">
      <input type="hidden" name="qrTextGap" value="${escapeHtml(settings.qrTextGap)}">
      <label class="label-config-field default-field-qr">
        <span>二维码 mm</span>
        <input name="qrSize" type="number" min="8" max="60" step="1" value="${escapeHtml(settings.qrSize)}">
      </label>
    </section>

    <section class="label-config-section default-label-editor-section">
      <label class="label-config-field">
        <span>内容缩放 %</span>
        <input name="contentScale" type="number" min="50" max="160" step="1" value="${escapeHtml(settings.contentScale)}">
      </label>
      <label class="label-config-field">
        <span>X 偏移 mm</span>
        <input name="offsetX" type="number" min="-30" max="30" step="0.5" value="${escapeHtml(settings.offsetX)}">
      </label>
      <label class="label-config-field">
        <span>Y 偏移 mm</span>
        <input name="offsetY" type="number" min="-30" max="30" step="0.5" value="${escapeHtml(settings.offsetY)}">
      </label>
      <label class="label-config-field">
        <span>字体 px</span>
        <input name="fontSize" type="number" min="5" max="22" step="1" value="${escapeHtml(settings.fontSize)}">
      </label>
      <label class="label-config-field">
        <span>每行列数</span>
        <input name="columns" type="number" min="1" max="8" step="1" value="${escapeHtml(settings.columns)}">
      </label>
      <label class="label-config-field">
        <span>每页行数</span>
        <input name="rows" type="number" min="1" max="14" step="1" value="${escapeHtml(settings.rows)}">
      </label>
      <label class="label-config-field">
        <span>列间距 mm</span>
        <input name="columnGap" type="number" min="0" max="30" step="0.5" value="${escapeHtml(settings.columnGap)}">
      </label>
      <label class="label-config-field">
        <span>行间距 mm</span>
        <input name="rowGap" type="number" min="0" max="30" step="0.5" value="${escapeHtml(settings.rowGap)}">
      </label>
    </section>

    <section class="label-config-section label-field-section default-label-editor-section">
      <div class="label-config-field full">
        <span>标签显示字段</span>
        <div class="label-field-checks">${assetLabelCheckboxes("fields", settings.fields)}</div>
      </div>
      <div class="label-config-field full">
        <span>扫码显示字段</span>
        <div class="label-field-checks">${assetLabelCheckboxes("scanFields", settings.scanFields)}</div>
      </div>
      <label class="label-config-field full">
        <span>自定义字段</span>
        <textarea name="customFields" rows="3" placeholder="每行一个，例如：管理员=custodian">${escapeHtml(settings.customFields)}</textarea>
      </label>
    </section>

    ${actionMarkup}
  </form>`;
}

function renderAssetLabelTemplateSettings(activeSection) {
  const settings = normalizeAssetLabelSettings(state.assetLabelSettings);
  state.assetLabelSettings = settings;
  return `<section class="asset-label-template-page">
    <aside class="asset-label-template-left">
      <header class="asset-code-rule-title">
        <h1>${escapeHtml(activeSection.label)}</h1>
      </header>
      <div class="asset-label-template-list">
        ${assetLabelTemplates.map((template) => assetLabelTemplatePreviewCard(template, settings.templateKey === template.key)).join("")}
      </div>
    </aside>
    <div class="asset-label-template-right">
      ${assetLabelTemplateConfigPanel(settings)}
    </div>
  </section>`;
}

function readAssetLabelSettingsForm(form) {
  const data = new FormData(form);
  const templateKey = data.get("templateKey");
  const rawFields = data.getAll("fields");
  const fields = ["compact", "full"].includes(String(templateKey)) ? rawFields.map((item) => String(item || "")) : rawFields;
  return normalizeAssetLabelSettings({
    templateKey,
    labelWidth: data.get("labelWidth"),
    labelHeight: data.get("labelHeight"),
    logoWidth: data.get("logoWidth"),
    logoHeight: data.get("logoHeight"),
    logoScale: data.get("logoScale"),
    logoText: data.get("logoText"),
    logoImage: data.get("logoImage"),
    qrSize: data.get("qrSize"),
    qrTextGap: data.get("qrTextGap"),
    contentScale: data.get("contentScale"),
    offsetX: data.get("offsetX"),
    offsetY: data.get("offsetY"),
    fontSize: data.get("fontSize"),
    fieldFontSizes: data.getAll("fieldFontSizes"),
    columns: data.get("columns"),
    rows: data.get("rows"),
    columnGap: data.get("columnGap"),
    rowGap: data.get("rowGap"),
    fields,
    scanFields: data.getAll("scanFields"),
    customFields: data.get("customFields"),
    showLogo: data.get("showLogo") === "on",
  });
}

function assetLabelPrintMarkup(assets) {
  const settings = state.assetLabelSettings;
  const perPage = Math.max(1, settings.columns * settings.rows);
  const pageCount = Math.max(1, Math.ceil(assets.length / perPage));
  const countText = `共 ${assets.length} 张 / ${pageCount} 页`;
  return `<div class="asset-label-print-workspace direct-label-print">
    <div class="asset-label-direct-actions">
      <button type="button" class="btn primary asset-label-direct-print-button" data-print-asset-labels-now>打 印</button>
    </div>

    <div class="asset-label-preview-panel">
      <div class="asset-label-preview-scroll">
        <div class="asset-label-direct-count">${escapeHtml(countText)}</div>
        <div class="asset-label-print-area" data-asset-label-preview>
          ${assetLabelPreviewMarkup(assets, settings)}
        </div>
      </div>
    </div>
  </div>`;
}

function renderAssetLabelPrintModalContent() {
  modal.classList.remove("default-label-editor-modal");
  modalBody.innerHTML = assetLabelPrintMarkup(assetLabelPreviewAssets);
  bindAssetLabelPrintControls(modal);
}

function refreshAssetLabelPreview(form) {
  state.assetLabelSettings = readAssetLabelSettingsForm(form);
  const preview = modal.querySelector("[data-asset-label-preview]");
  if (preview) {
    preview.innerHTML = assetLabelPreviewMarkup(assetLabelPreviewAssets, state.assetLabelSettings);
  }
  const count = modal.querySelector("[data-label-count]");
  if (count) {
    const perPage = Math.max(1, state.assetLabelSettings.columns * state.assetLabelSettings.rows);
    const pageCount = Math.max(1, Math.ceil(assetLabelPreviewAssets.length / perPage));
    count.textContent = `共 ${assetLabelPreviewAssets.length} 张 / ${pageCount} 页`;
  }
}

let assetLabelPrintDialogOpening = false;

function openAssetLabelPrintDialog() {
  if (assetLabelPrintDialogOpening) return;
  assetLabelPrintDialogOpening = true;
  document.body.classList.add("printing-asset-labels");
  window.print();
  window.setTimeout(() => {
    assetLabelPrintDialogOpening = false;
  }, 800);
  showToast("已打开标签打印预览");
}

function bindAssetLabelPrintControls(root = modal) {
  const form = root.querySelector("[data-asset-label-form]");
  if (!form) {
    const directPrintButton = root.querySelector("[data-print-asset-labels-now]");
    if (directPrintButton && directPrintButton.dataset.printBound !== "true") {
      directPrintButton.dataset.printBound = "true";
      directPrintButton.addEventListener("click", openAssetLabelPrintDialog);
    }
    return;
  }

  if (form.dataset.labelBound === "true") return;
  form.dataset.labelBound = "true";

  form.querySelector("[data-cancel-modal]")?.addEventListener("click", closeModal);

  form.querySelector("[data-label-template-select]")?.addEventListener("change", (event) => {
    state.assetLabelSettings = normalizeAssetLabelSettings(assetLabelTemplateDefaults(event.currentTarget.value));
    renderAssetLabelPrintModalContent();
  });

  form.querySelectorAll("input, textarea, select").forEach((input) => {
    if (input.dataset.labelTemplateSelect !== undefined) return;
    input.addEventListener("input", () => refreshAssetLabelPreview(form));
    input.addEventListener("change", () => refreshAssetLabelPreview(form));
  });

  form.querySelector("[data-save-label-settings]")?.addEventListener("click", () => {
    state.assetLabelSettings = readAssetLabelSettingsForm(form);
    saveAssetLabelSettings();
    refreshAssetLabelPreview(form);
    showToast("标签打印配置已保存");
  });

  form.querySelector("[data-print-asset-labels-now]")?.addEventListener("click", () => {
    state.assetLabelSettings = readAssetLabelSettingsForm(form);
    saveAssetLabelSettings();
    refreshAssetLabelPreview(form);
    openAssetLabelPrintDialog();
  });
}

function openAssetLabelPrintModal() {
  const assets = selectedAssetRowsFromCurrentTable();
  if (!assets.length) {
    showToast("请选择打印资产");
    return;
  }
  state.selectedAssetIds = assets.map((asset) => asset.id);
  assetLabelPreviewAssets = assets;
  modalTitle.textContent = "打印标签";
  modal.classList.remove("asset-create-modal");
  modal.classList.remove("asset-flow-modal");
  modal.classList.remove("asset-import-modal");
  modal.classList.add("print-preview-modal");
  modal.classList.add("asset-label-print-modal");
  modal.classList.remove("default-label-editor-modal");
  modalBody.innerHTML = assetLabelPrintMarkup(assets);
  openModal();
}

function inboundOrderId(asset, index = 0) {
  const sourceDate = asset.purchaseDate || asset.receiveDate || asset.borrowDate || todayValue();
  const compactDate = sourceDate.replace(/\D/g, "").slice(0, 8) || todayValue().replace(/\D/g, "");
  const suffix = String(index + 1).padStart(4, "0");
  return `ZCRK${compactDate}${suffix}`;
}

function buildInboundOrders() {
  return getScopedAllAssets().map((asset, index) => {
    const date = asset.purchaseDate || asset.receiveDate || asset.borrowDate || todayValue();
    const inferredType = asset.purchaseMethod && asset.purchaseMethod.includes("导入") ? "excel批量导入" : "新增资产";
    return {
      id: inboundOrderId(asset, index),
      status: asset.inboundStatus || "已完成",
      type: asset.inboundType || inferredType,
      date,
      createdDate: date,
      operator: asset.custodian || state.currentUser?.name || "admin",
      purchaser: asset.purchaser || "",
      company: asset.ownerCompany || asset.company || "默认公司",
      note: asset.inboundNote || asset.note || "",
      asset,
    };
  });
}

function inboundColumnWidth(column, widthMap = state.inboundColumnWidths) {
  const saved = Number(widthMap?.[column.key]);
  const fallback = Number(column.width) || 96;
  const minWidth = Number(column.minWidth) || 48;
  return Math.max(minWidth, Number.isFinite(saved) ? saved : fallback);
}

function inboundTableMinWidth(widthMap = state.inboundColumnWidths) {
  return inboundOrderTableColumns.reduce((total, column) => total + inboundColumnWidth(column, widthMap), 0);
}

function renderInboundColgroup() {
  return `<colgroup>${inboundOrderTableColumns
    .map((column) => `<col data-column-key="${escapeHtml(column.key)}" style="width:${inboundColumnWidth(column)}px">`)
    .join("")}</colgroup>`;
}

function renderInboundHeader(column, allChecked, rowCount) {
  const content =
    column.key === "select"
      ? `<input type="checkbox" data-inbound-check-all aria-label="全选入库单" ${allChecked ? "checked" : ""} ${rowCount ? "" : "disabled"}>`
      : `<span class="resizable-column-label">${escapeHtml(column.label)}</span>`;
  const resizeHandle =
    column.resizable === false
      ? ""
      : `<span class="column-resize-handle" data-column-resize="inbound:${escapeHtml(column.key)}" role="separator" aria-orientation="vertical" aria-label="调整${escapeHtml(column.label)}列宽"></span>`;
  const className = column.key === "select" ? ` class="inbound-select-cell"` : "";
  return `<th${className} data-column-key="${escapeHtml(column.key)}" data-min-width="${column.minWidth || 48}">${content}${resizeHandle}</th>`;
}

function inboundOrderSearchText(order) {
  return [
    order.id,
    order.status,
    order.type,
    order.date,
    order.operator,
    order.purchaser,
    order.createdDate,
    order.company,
    order.note,
    order.asset.id,
    order.asset.name,
    order.asset.category,
  ]
    .join("")
    .toLowerCase();
}

function dateInRange(value, start, end) {
  const current = String(value || "").trim();
  return (!start || current >= start) && (!end || current <= end);
}

function matchesAdvancedInboundFilters(order) {
  const filters = state.advancedInboundFilters || defaultAdvancedInboundFilters();
  return (
    matchesTextField(order.status, filters.status) &&
    matchesTextField(order.id, filters.id) &&
    matchesTextField(order.type, filters.type) &&
    dateInRange(order.date, filters.dateStart, filters.dateEnd) &&
    matchesTextField(order.operator, filters.operator) &&
    matchesTextField(order.purchaser, filters.purchaser) &&
    matchesTextField(order.company, filters.company)
  );
}

function matchesInboundOrder(order) {
  const keyword = state.assetInboundQuery.trim().toLowerCase();
  return (!keyword || inboundOrderSearchText(order).includes(keyword)) && matchesAdvancedInboundFilters(order);
}

function setSelectedInboundOrder(id, checked) {
  const selected = new Set(state.selectedInboundOrderIds);
  if (checked) selected.add(id);
  else selected.delete(id);
  state.selectedInboundOrderIds = Array.from(selected);
}

function setAllVisibleInboundOrders(orders, checked) {
  const selected = new Set(state.selectedInboundOrderIds);
  orders.forEach((order) => {
    if (checked) selected.add(order.id);
    else selected.delete(order.id);
  });
  state.selectedInboundOrderIds = Array.from(selected);
}

function getSelectedInboundOrders() {
  const selected = new Set(state.selectedInboundOrderIds);
  return buildInboundOrders().filter((order) => selected.has(order.id));
}

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function excelCell(value, styleId = "") {
  const style = styleId ? ` ss:StyleID="${styleId}"` : "";
  return `<Cell${style}><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function downloadBlob(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportSelectedInboundOrders() {
  const orders = getSelectedInboundOrders();
  if (!orders.length) {
    showToast("请先勾选要导出的入库单");
    return;
  }

  const columns = [
    ["status", "订单状态", 86],
    ["id", "入库单号", 180],
    ["type", "入库类型", 110],
    ["date", "入库时间", 150],
    ["operator", "入库人", 96],
    ["purchaser", "采购人", 96],
    ["createdDate", "创建时间", 150],
    ["company", "所属公司", 120],
    ["note", "备注", 180],
  ];
  const rows = orders.map((order) => ({
    status: order.status || "-",
    id: order.id || "-",
    type: order.type || "-",
    date: order.date || "-",
    operator: order.operator || "-",
    purchaser: order.purchaser || "-",
    createdDate: order.createdDate || "-",
    company: order.company || "-",
    note: order.note || "-",
  }));
  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1" />
      <Interior ss:Color="#9DC3E6" ss:Pattern="Solid" />
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" />
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" />
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" />
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" />
      </Borders>
    </Style>
    <Style ss:ID="Body">
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" />
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" />
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" />
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" />
      </Borders>
    </Style>
  </Styles>
  <Worksheet ss:Name="资产入库信息">
    <Table>
      ${columns.map(([, , width]) => `<Column ss:Width="${width}" />`).join("")}
      <Row>${columns.map(([, label]) => excelCell(label, "Header")).join("")}</Row>
      ${rows
        .map((row) => `<Row>${columns.map(([key]) => excelCell(row[key], "Body")).join("")}</Row>`)
        .join("")}
    </Table>
  </Worksheet>
</Workbook>`;
  const filename = `资产入库信息_${todayValue()}_${orders.length}条.xls`;
  downloadBlob(filename, workbook, "application/vnd.ms-excel;charset=utf-8");
  showToast(`已导出 ${orders.length} 条入库信息`);
}

function currentInboundPageOrders() {
  return paginateRows(buildInboundOrders().filter(matchesInboundOrder), "inbound").rows;
}

function currentReceiveReturnRows() {
  return paginateRows(getReceiveReturnOrders().filter(matchesReceiveReturnOrder), "receiveReturn").rows;
}

function setPaginationPage(context, page) {
  const { pageKey, pageSizeKey } = paginationStateKeys(context);
  const total =
    context === "inbound"
      ? buildInboundOrders().filter(matchesInboundOrder).length
      : context === "receiveReturn"
      ? getReceiveReturnOrders().filter(matchesReceiveReturnOrder).length
      : context === "borrowReturn"
      ? getBorrowReturnRows().filter(matchesBorrowReturnRow).length
      : context === "assetCategory"
      ? filteredAssetCategoryRows().length
      : getScopedAssets(state.assets).filter(matchesAssetQuery).length;
  state[pageKey] = clampPage(page, total, state[pageSizeKey]);
  render();
}

function setPaginationPageSize(context, pageSize) {
  const { pageKey, pageSizeKey } = paginationStateKeys(context);
  state[pageSizeKey] = Number(pageSize) || 20;
  state[pageKey] = 1;
  render();
}

function isReceivableAsset(asset) {
  return ["空闲", "闲置", "上架", "待验收"].includes(asset?.status);
}

function getReceivableAssets() {
  return getScopedAssets().filter(isReceivableAsset);
}

function isReturnableAsset(asset) {
  return ["在用", "领用中"].includes(asset?.status);
}

function isBorrowableAsset(asset) {
  return ["空闲", "闲置", "上架", "待验收"].includes(asset?.status);
}

function isBorrowReturnableAsset(asset) {
  return asset?.status === "借用中";
}

function isHandoverAsset(asset) {
  return ["在用", "借用中", "交接待签字"].includes(asset?.status);
}

function flowAssetRows(assets, options = {}) {
  const defaultExpectedDate = options.defaultExpectedReturnDate || todayValue();
  return assets
    .map(
      (asset) => `<tr>
        <td class="asset-flow-select-cell"><input type="checkbox" data-flow-row-select="${escapeHtml(asset.id)}" aria-label="选择${escapeHtml(asset.id)}"></td>
        ${
          options.expectedReturnDateColumn
            ? `<td><input class="asset-flow-date-input" name="assetExpectedReturnDate" data-borrow-return-date="${escapeHtml(asset.id)}" type="date" value="${escapeHtml(
                asset.expectedReturnDate || defaultExpectedDate
              )}" aria-label="${escapeHtml(asset.id)}预计归还日期"></td>`
            : ""
        }
        <td>-</td>
        <td><span class="asset-code-text">${escapeHtml(asset.id)}</span></td>
        <td>${escapeHtml(asset.category || "-")}</td>
        <td>${escapeHtml(asset.name || "-")}</td>
        <td>${escapeHtml(asset.brand || "-")}</td>
        <td>${escapeHtml(asset.model || "-")}</td>
        <td>${escapeHtml(asset.sn || "-")}</td>
        <td>${asset.price || 0}</td>
        <td>${escapeHtml(asset.ownerCompany || asset.company || "默认公司")}</td>
        <td>${escapeHtml(asset.company || "默认公司")}</td>
        <td>${escapeHtml(asset.department || "默认部门")}</td>
        <td>${escapeHtml(asset.location || "-")}</td>
        <td>${escapeHtml(asset.owner || "-")}</td>
        <td>${escapeHtml(asset.custodian || "-")}</td>
        <td>${escapeHtml(asset.purchaseMethod || "-")}</td>
        <td>${escapeHtml(asset.orderNo || "-")}</td>
        <td>${escapeHtml(asset.supplier || "-")}</td>
        <td>${escapeHtml(asset.note || "-")}</td>
      </tr>`
    )
    .join("");
}

function assetOperationDropdown() {
  return `<div class="table-action-menu">
    <button class="table-action has-caret" type="button">操作<span class="action-caret" aria-hidden="true"></span></button>
    <div class="table-dropdown">
      <button type="button" data-bulk-asset-action="receive">领用</button>
      <button type="button" data-bulk-asset-action="borrow">借用</button>
      <button type="button" data-bulk-asset-action="return">领用退还</button>
      <button type="button" data-bulk-asset-action="borrowReturn">借用归还</button>
      <button type="button" data-bulk-asset-action="handover">资产交接</button>
    </div>
  </div>`;
}

function assetEditDropdown() {
  return `<div class="table-action-menu">
    <button class="table-action has-caret" type="button">编辑<span class="action-caret" aria-hidden="true"></span></button>
    <div class="table-dropdown">
      <button type="button" data-edit-action="modify">修改</button>
      <button type="button" data-edit-action="delete">删除</button>
      <button type="button" data-edit-action="copy">复制资产</button>
      <button type="button" data-edit-action="batch">批量修改</button>
    </div>
  </div>`;
}

function assetImportExportDropdown() {
  return `<div class="table-action-menu">
    <button class="table-action has-caret" type="button">导入/导出<span class="action-caret" aria-hidden="true"></span></button>
    <div class="table-dropdown wide">
      <button type="button" data-import-action="asset">资产导入</button>
      <button type="button" data-import-action="update">更新导入</button>
      <button type="button" data-import-action="receive">批量领用导入</button>
      <button type="button" data-import-action="export">导出资产</button>
    </div>
  </div>`;
}

function advancedFilterValue(filters, name) {
  return escapeHtml(filters?.[name] || "");
}

function advancedFilterOptionList(filters, name, values, fallback = "全部") {
  const selected = filters?.[name] || fallback;
  return optionList(values, selected);
}

function advancedTextInput(label, name, placeholder = label, filters = {}) {
  return `<label class="advanced-filter-field">
    <span>${label}</span>
    <input name="${name}" value="${advancedFilterValue(filters, name)}" placeholder="${placeholder}">
  </label>`;
}

function advancedSelect(label, name, values, filters = {}, fallback = "全部") {
  return `<label class="advanced-filter-field">
    <span>${label}</span>
    <select name="${name}">${advancedFilterOptionList(filters, name, values, fallback)}</select>
  </label>`;
}

function advancedPlaceholderSelect(label, name, placeholder, values, filters = {}) {
  const selected = filters?.[name] || "";
  const optionsMarkup = values === assetLocationOptions ? locationOptionList(selected, { placeholder }) : values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
  return `<label class="advanced-filter-field">
    <span>${label}</span>
    <select name="${name}" class="${selected ? "" : "placeholder-select"}" data-placeholder-select>
      ${optionsMarkup}
    </select>
  </label>`;
}

function advancedAssetInput(label, name, placeholder = label) {
  return advancedTextInput(label, name, placeholder, state.advancedAssetFilters);
}

function advancedAssetSelect(label, name, values) {
  return advancedSelect(label, name, values, state.advancedAssetFilters, "全部");
}

function advancedDateRange(label, startName, endName, filters = {}) {
  return `<label class="advanced-filter-field advanced-filter-date-range">
    <span>${label}</span>
    <div class="advanced-date-range-control">
      <input name="${startName}" type="date" value="${advancedFilterValue(filters, startName)}" aria-label="${label}开始日期">
      <span>→</span>
      <input name="${endName}" type="date" value="${advancedFilterValue(filters, endName)}" aria-label="${label}结束日期">
    </div>
  </label>`;
}

function renderAssetAdvancedSearchFields() {
  const rows = getScopedAssets();
  return `<p class="advanced-search-hint">系统支持多种字段组合筛选，选择要精确匹配的字段后点击查询。</p>
    <div class="advanced-filter-section">
      ${advancedAssetSelect("资产状态", "status", uniqueAssetValues("status", rows))}
      ${advancedAssetInput("资产编码", "id", "例如 AST-0001")}
      ${advancedAssetInput("资产名称", "name", "例如 测试笔记本")}
      ${advancedAssetSelect("资产分类", "category", uniqueAssetValues("category", rows))}
      ${advancedAssetSelect("品牌/类型", "type", uniqueAssetValues("type", rows))}
      ${advancedAssetInput("型号", "model", "例如 X1 Carbon")}
      ${advancedAssetInput("设备序列号", "sn", "SN / 序列号")}
      ${advancedAssetInput("使用人", "owner", "姓名或未分配")}
      ${advancedAssetSelect("所属部门", "department", uniqueAssetValues("department", rows))}
      <label class="advanced-filter-field"><span>所在位置</span><select name="location">${locationOptionList(state.advancedAssetFilters?.location || "全部", { includeAll: true })}</select></label>
      ${advancedAssetInput("供应商", "supplier", "采购或租赁供应商")}
      ${advancedAssetSelect("风险状态", "risk", uniqueAssetValues("risk", rows))}
      ${advancedAssetSelect("资产标签", "tag", uniqueTags(rows))}
    </div>
    <div class="advanced-search-actions">
      <button type="submit" class="btn primary">查询</button>
      <button type="button" class="btn" data-clear-advanced-filter>重置</button>
    </div>`;
}

function renderInboundAdvancedSearchFields() {
  const filters = state.advancedInboundFilters || defaultAdvancedInboundFilters();
  return `<p class="advanced-search-hint">入库搜索只筛选当前入库板块，可按入库单据字段组合查询。</p>
    <div class="advanced-filter-section inbound-advanced-fields">
      ${advancedPlaceholderSelect("入库状态", "status", "入库状态", workflowStatusOptions, filters)}
      ${advancedTextInput("入库单号", "id", "请输入", filters)}
      ${advancedTextInput("入库类型", "type", "入库类型", filters)}
      ${advancedDateRange("入库日期", "dateStart", "dateEnd", filters)}
      ${advancedTextInput("入库人", "operator", "入库人", filters)}
      ${advancedTextInput("采购人", "purchaser", "请输入", filters)}
      ${advancedTextInput("所属公司", "company", "默认公司", filters)}
    </div>
	    <div class="advanced-search-actions">
	      <button type="submit" class="btn primary">查询</button>
	      <button type="button" class="btn" data-clear-advanced-filter>重置</button>
	    </div>`;
}

function renderReceiveReturnAdvancedSearchFields() {
  const filters = state.advancedReceiveReturnFilters || defaultAdvancedReceiveReturnFilters();
  const config = receiveReturnViewConfig();
  const isHandover = (state.assetReceiveReturnTab || "receive") === "handover";
  if (isHandover) {
    return `<div class="advanced-filter-section receive-return-advanced-fields">
        ${advancedPlaceholderSelect("交接状态", "status", "交接状态", workflowStatusOptions, filters)}
        ${advancedTextInput("交接单号", "id", "请输入", filters)}
        ${advancedDateRange("交接日期", "dateStart", "dateEnd", filters)}
        ${advancedTextInput("经办人", "handler", "请输入", filters)}
        ${advancedTextInput("接收人", "receiver", "请输入", filters)}
        ${advancedTextInput("接收公司", "company", "默认公司", filters)}
        ${advancedTextInput("接收部门", "department", "默认部门", filters)}
        ${advancedPlaceholderSelect("接收后所在位置", "location", "所在位置", assetLocationOptions, filters)}
        ${advancedTextInput("交接备注", "note", "请输入", filters)}
        ${advancedTextInput("资产编码", "assetId", "请输入", filters)}
        ${advancedTextInput("资产名称", "assetName", "请输入", filters)}
        ${advancedTextInput("品牌", "brand", "请输入", filters)}
        ${advancedTextInput("型号", "model", "请输入", filters)}
        ${advancedTextInput("设备序列号", "sn", "请输入", filters)}
        ${advancedTextInput("管理员", "manager", "管理员", filters)}
        ${advancedTextInput("所属/承租公司", "ownerCompany", "默认公司", filters)}
      </div>
      <div class="advanced-search-actions">
        <button type="submit" class="btn primary">查询</button>
        <button type="button" class="btn" data-clear-advanced-filter>重置</button>
      </div>`;
  }
  return `<div class="advanced-filter-section receive-return-advanced-fields">
      ${advancedPlaceholderSelect(config.statusLabel, "status", config.statusLabel, workflowStatusOptions, filters)}
      ${advancedTextInput(config.orderLabel, "id", "请输入", filters)}
      ${advancedDateRange(config.dateLabel, "dateStart", "dateEnd", filters)}
      ${advancedTextInput("经办人", "handler", "请输入", filters)}
      ${advancedTextInput("领用人", "receiver", "请输入", filters)}
      ${advancedTextInput(`${config.moduleName}后使用公司`, "company", "默认公司", filters)}
      ${advancedTextInput(`${config.moduleName}后使用部门`, "department", "默认部门", filters)}
      ${advancedPlaceholderSelect(config.locationLabel, "location", "所在位置", assetLocationOptions, filters)}
      ${advancedTextInput(`${config.moduleName}备注`, "note", "请输入", filters)}
      ${advancedTextInput("资产编码", "assetId", "请输入", filters)}
      ${advancedTextInput("资产名称", "assetName", "请输入", filters)}
      ${advancedTextInput("品牌", "brand", "请输入", filters)}
      ${advancedTextInput("型号", "model", "请输入", filters)}
      ${advancedTextInput("设备序列号", "sn", "请输入", filters)}
      ${advancedTextInput("使用人", "owner", "请输入", filters)}
      ${advancedTextInput("管理员", "manager", "管理员", filters)}
      ${advancedTextInput("所属/承租公司", "ownerCompany", "默认公司", filters)}
    </div>
    <div class="advanced-search-actions">
      <button type="submit" class="btn primary">查询</button>
      <button type="button" class="btn" data-clear-advanced-filter>重置</button>
    </div>`;
}

function renderBorrowReturnAdvancedSearchFields() {
  const filters = state.advancedBorrowReturnFilters || defaultAdvancedBorrowReturnFilters();
  return `<div class="advanced-filter-section borrow-return-advanced-fields">
      ${advancedPlaceholderSelect("借用状态", "status", "借用状态", workflowStatusOptions, filters)}
      ${advancedTextInput("借用单号", "id", "请输入", filters)}
      ${advancedTextInput("经办人", "handler", "经办人", filters)}
      ${advancedTextInput("借用人", "borrower", "请输入", filters)}
      ${advancedDateRange("借用日期", "borrowDateStart", "borrowDateEnd", filters)}
      ${advancedDateRange("预计归还", "expectedReturnDateStart", "expectedReturnDateEnd", filters)}
      ${advancedTextInput("资产编码", "assetId", "请输入", filters)}
      ${advancedTextInput("设备序列号", "sn", "请输入", filters)}
      ${advancedTextInput("借用人公司", "company", "默认公司", filters)}
      ${advancedTextInput("借用人部门", "department", "默认部门", filters)}
      ${advancedTextInput("工号", "employeeCode", "请输入", filters)}
      ${advancedTextInput("手机号", "phone", "请输入", filters)}
      ${advancedTextInput("邮箱", "email", "请输入", filters)}
      ${advancedPlaceholderSelect("借用后位置", "location", "借用后位置", assetLocationOptions, filters)}
    </div>
    <div class="advanced-search-actions">
      <button type="submit" class="btn primary">查询</button>
      <button type="button" class="btn" data-clear-advanced-filter>重置</button>
    </div>`;
}

function renderCustomColumnPanel() {
  const selectedColumns = new Set(state.assetListSettings.visibleColumns);
  const allChecked = assetTableColumns.every((column) => selectedColumns.has(column.key));
  const densityLabels = { compact: "紧凑", standard: "标准", roomy: "宽松" };
  return `
    <div class="custom-column-panel">
      <p class="advanced-search-hint">对资产进行列设置，根据实际情况勾选关键信息展示资产列表。</p>
      <div class="custom-column-toolbar">
        <label><input type="checkbox" data-column-check-all ${allChecked ? "checked" : ""}> 全选</label>
        <span>(${selectedColumns.size}/${assetTableColumns.length})</span>
        <button type="button" data-reset-list-settings>重置</button>
      </div>
      <div class="custom-column-list">
        ${assetTableColumns
          .map((column) => `<label><input type="checkbox" data-column-toggle="${column.key}" ${selectedColumns.has(column.key) ? "checked" : ""}> ${column.label}</label>`)
          .join("")}
      </div>
      <div class="list-setting-section compact-setting">
        <h3>表格密度</h3>
        <div class="density-options">
          ${Object.entries(densityLabels)
            .map(([value, label]) => `<button class="${state.assetListSettings.density === value ? "active" : ""}" type="button" data-density="${value}">${label}</button>`)
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function renderInboundColumnPanel() {
  const columns = ["入库状态", "入库单号", "入库类型", "入库日期", "入库人", "采购人", "创建日期", "所属公司", "入库备注", "操作"];
  return `
    <div class="custom-column-panel inbound-column-panel">
      <p class="advanced-search-hint">当前为资产入库板块，列设置只覆盖入库单据字段，不影响资产列表。</p>
      <div class="custom-column-list">
        ${columns.map((column) => `<label><input type="checkbox" checked disabled> ${column}</label>`).join("")}
      </div>
    </div>
  `;
}

function renderReceiveReturnColumnPanel() {
  const config = receiveReturnViewConfig();
  const columns = config.columns;
  return `
    <div class="custom-column-panel receive-return-column-panel">
      <p class="advanced-search-hint">当前为${config.moduleName}板块，列设置只覆盖${config.moduleName}单据字段，不影响资产列表。</p>
      <div class="custom-column-list">
        ${columns.map((column) => `<label><input type="checkbox" checked disabled> ${column}</label>`).join("")}
      </div>
    </div>
  `;
}

function renderBorrowReturnColumnPanel() {
  const columns = borrowReturnTableColumns.map((column) => column.label).filter(Boolean);
  return `
    <div class="custom-column-panel borrow-return-column-panel">
      <p class="advanced-search-hint">当前为借用归还板块，列设置只覆盖借用归还单据字段，不影响资产列表。</p>
      <div class="custom-column-list">
        ${columns.map((column) => `<label><input type="checkbox" checked disabled> ${column}</label>`).join("")}
      </div>
    </div>
  `;
}

function currentAdvancedContext() {
  if (state.route === "assetInbound") return "inbound";
  if (state.route === "assetReceiveReturn") return "receiveReturn";
  if (state.route === "assetBorrowReturn") return "borrowReturn";
  return "assets";
}

function openAssetAdvancedSearch(activeTab = "search", context = currentAdvancedContext()) {
  const isColumnsTab = activeTab === "columns";
  const isInbound = context === "inbound";
  const isReceiveReturn = context === "receiveReturn";
  const isBorrowReturn = context === "borrowReturn";
  drawer.classList.remove("asset-detail-drawer");
  drawerEyebrow.textContent = "列表操作";
  drawerTitle.textContent = isColumnsTab ? "自定义列" : "高级搜索";
  drawerBody.innerHTML = `
    <form class="advanced-search-form" id="advancedSearchForm" data-advanced-context="${context}">
      <div class="advanced-search-tabs">
        <button type="button" class="${isColumnsTab ? "" : "active"}" data-advanced-tab="search">高级搜索</button>
        <button type="button" class="${isColumnsTab ? "active" : ""}" data-advanced-tab="columns">自定义列</button>
      </div>
      ${
        isColumnsTab
          ? isInbound
            ? renderInboundColumnPanel()
            : isReceiveReturn
            ? renderReceiveReturnColumnPanel()
            : isBorrowReturn
            ? renderBorrowReturnColumnPanel()
            : renderCustomColumnPanel()
          : isInbound
          ? renderInboundAdvancedSearchFields()
          : isReceiveReturn
          ? renderReceiveReturnAdvancedSearchFields()
          : isBorrowReturn
          ? renderBorrowReturnAdvancedSearchFields()
          : renderAssetAdvancedSearchFields()
      }
    </form>
  `;
  drawer.classList.add("advanced-search-drawer");
  openDrawer();
  bindAdvancedPanelEvents(activeTab, context);
}

function readAdvancedSearchForm(form, context = form?.dataset.advancedContext || "assets") {
  const data = new FormData(form);
  const next =
    context === "inbound"
      ? defaultAdvancedInboundFilters()
      : context === "receiveReturn"
      ? defaultAdvancedReceiveReturnFilters()
      : context === "borrowReturn"
      ? defaultAdvancedBorrowReturnFilters()
      : defaultAdvancedAssetFilters();
  Object.keys(next).forEach((key) => {
    next[key] = (data.get(key) || next[key] || "").toString().trim();
  });
  return next;
}

function applyAdvancedSearchForm(form, shouldClose = true) {
  const context = form?.dataset.advancedContext || "assets";
  if (context === "inbound") {
    state.advancedInboundFilters = readAdvancedSearchForm(form, context);
    state.assetInboundPage = 1;
  } else if (context === "receiveReturn") {
    state.advancedReceiveReturnFilters = readAdvancedSearchForm(form, context);
    state.assetReceiveReturnPage = 1;
  } else if (context === "borrowReturn") {
    state.advancedBorrowReturnFilters = readAdvancedSearchForm(form, context);
    state.assetBorrowReturnPage = 1;
  } else {
    state.advancedAssetFilters = readAdvancedSearchForm(form, context);
    state.assetListPage = 1;
  }
  if (shouldClose) closeDrawer();
  render();
}

function bindAdvancedPanelEvents(activeTab = "search", context = "assets") {
  const form = document.querySelector("#advancedSearchForm");
  if (!form) return;
  form.querySelectorAll("[data-advanced-tab]").forEach((button) =>
    button.addEventListener("click", () => openAssetAdvancedSearch(button.dataset.advancedTab, context))
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (activeTab === "search") applyAdvancedSearchForm(form);
  });
  form.querySelector("[data-clear-advanced-filter]")?.addEventListener("click", () => {
    if (context === "inbound") {
      state.advancedInboundFilters = defaultAdvancedInboundFilters();
      state.assetInboundPage = 1;
    } else if (context === "receiveReturn") {
      state.advancedReceiveReturnFilters = defaultAdvancedReceiveReturnFilters();
      state.assetReceiveReturnPage = 1;
    } else if (context === "borrowReturn") {
      state.advancedBorrowReturnFilters = defaultAdvancedBorrowReturnFilters();
      state.assetBorrowReturnPage = 1;
    } else {
      state.advancedAssetFilters = defaultAdvancedAssetFilters();
      state.assetListPage = 1;
    }
    closeDrawer();
    render();
  });
  drawerBody.querySelectorAll("[data-column-toggle]").forEach((input) =>
    input.addEventListener("change", () => setAssetColumnVisibility(input.dataset.columnToggle, input.checked, "columns"))
  );
  drawerBody.querySelectorAll("[data-density]").forEach((button) =>
    button.addEventListener("click", () => setAssetTableDensity(button.dataset.density, "columns"))
  );
  drawerBody.querySelector("[data-column-check-all]")?.addEventListener("change", (event) => setAllAssetColumns(event.target.checked));
  drawerBody.querySelector("[data-reset-list-settings]")?.addEventListener("click", () => {
    state.assetListSettings = defaultAssetListSettings();
    saveAssetListSettings();
    render();
    openAssetAdvancedSearch("columns", "assets");
  });
}

function openAssetListSettings(context = currentAdvancedContext()) {
  openAssetAdvancedSearch("columns", context);
}

function renderAssetInbound() {
  const filtered = buildInboundOrders().filter(matchesInboundOrder);
  const pagination = paginateRows(filtered, "inbound");
  const displayRows = pagination.rows;
  const visibleIds = new Set(displayRows.map((order) => order.id));
  state.selectedInboundOrderIds = state.selectedInboundOrderIds.filter((id) => visibleIds.has(id));
  const allChecked = displayRows.length > 0 && displayRows.every((order) => state.selectedInboundOrderIds.includes(order.id));

  return `<section class="asset-inbound-ledger">
    <div class="asset-inbound-toolbar">
      <div class="asset-list-actions">
        <div class="table-action-menu">
          <button class="table-action primary has-caret" type="button" data-open-kind="asset">新增<span class="action-caret" aria-hidden="true"></span></button>
          <div class="table-dropdown">
            <button type="button" data-open-kind="asset">新增资产</button>
            <button type="button" data-import-action="asset">批量导入</button>
          </div>
        </div>
        <div class="table-action-menu">
          <button class="table-action has-caret" type="button">打印<span class="action-caret" aria-hidden="true"></span></button>
          <div class="table-dropdown">
            <button type="button" data-print-action="inbound-order">打印入库单</button>
            <button type="button" data-print-action="inbound-label">打印资产标签</button>
          </div>
        </div>
        <button class="table-action inbound-export" type="button" data-import-action="export">⇱ 导出</button>
      </div>
      <div class="asset-list-search inbound-search">
        <input class="local-search" type="search" placeholder="模糊查询" value="${escapeHtml(state.assetInboundQuery)}" autocomplete="off">
        <button class="table-action primary" data-search aria-label="搜索">⌕</button>
      </div>
    </div>
    <div class="inbound-table-shell">
      <div class="inbound-table-actions">
        <button class="link" data-advanced-search="inbound">高级搜索</button>
        <button class="list-settings-button" data-list-settings="inbound" title="列表设置" aria-label="列表设置">⚙</button>
      </div>
      <div class="inbound-table-scroll">
        <table class="inbound-order-table" data-resizable-table="inbound" style="min-width:${inboundTableMinWidth()}px">
          ${renderInboundColgroup()}
          <thead>
            <tr>
              ${inboundOrderTableColumns.map((column) => renderInboundHeader(column, allChecked, displayRows.length)).join("")}
            </tr>
          </thead>
          <tbody>
            ${
              displayRows.length
                ? displayRows.map(renderInboundOrderRow).join("")
                : `<tr class="empty-row"><td colspan="${inboundOrderTableColumns.length}">${state.assetInboundQuery ? "没有匹配的入库单。" : "暂无入库单，点击新增录入资产。"}</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
    ${renderPagination(pagination, "inbound")}
  </section>`;
}

function renderInboundOrderRow(order) {
  const checked = state.selectedInboundOrderIds.includes(order.id);
  const canCancel = order.status !== "已取消";
  return `<tr>${inboundOrderTableColumns
    .map((column) => {
      const className = column.key === "select" ? ` class="inbound-select-cell"` : "";
      return `<td${className} data-column-key="${escapeHtml(column.key)}">${inboundCellMarkup(order, column, checked, canCancel)}</td>`;
    })
    .join("")}</tr>`;
}

function inboundCellMarkup(order, column, checked, canCancel) {
  if (column.key === "select") {
    return `<input type="checkbox" data-inbound-select="${escapeHtml(order.id)}" aria-label="选择${escapeHtml(order.id)}" ${checked ? "checked" : ""}>`;
  }
  if (column.key === "status") return inboundStatusPill(order.status);
  if (column.key === "id") return `<button class="link inbound-order-link" data-detail="${escapeHtml(order.asset.id)}">${escapeHtml(order.id)}</button>`;
  if (column.key === "action") {
    return canCancel
      ? `<button class="link inbound-cancel-link" data-cancel-inbound="${escapeHtml(order.asset.id)}">取消入库</button>`
      : `<span class="muted-text">已取消</span>`;
  }
  return escapeHtml(order[column.key] || "-");
}

function selectedOrVisibleInboundOrders() {
  const selected = new Set(state.selectedInboundOrderIds);
  const matched = buildInboundOrders().filter(matchesInboundOrder);
  if (selected.size) {
    const selectedOrders = matched.filter((order) => selected.has(order.id));
    if (selectedOrders.length) return selectedOrders;
  }
  return paginateRows(matched, "inbound").rows;
}

function inboundPrintSummary(orders) {
  const totalPrice = orders.reduce((total, order) => total + (Number(order.asset.price) || 0), 0);
  const categories = Array.from(new Set(orders.map((order) => order.asset.category).filter(Boolean))).join("、") || "-";
  const companies = Array.from(new Set(orders.map((order) => order.company).filter(Boolean))).join("、") || "-";
  return `
    <div class="print-summary-grid">
      ${detail("入库单数", orders.length)}
      ${detail("资产数量", orders.length)}
      ${detail("资产分类", escapeHtml(categories))}
      ${detail("所属公司", escapeHtml(companies))}
      ${detail("入库总金额", money(totalPrice))}
      ${detail("打印日期", todayValue())}
    </div>
  `;
}

function inboundOrderPrintMarkup(orders) {
  return `<div class="print-preview">
    <div class="print-preview-head">
      <div>
        <div class="eyebrow">资产入库</div>
        <h3>入库单打印预览</h3>
      </div>
      <span class="tag blue">共 ${orders.length} 条</span>
    </div>
    ${inboundPrintSummary(orders)}
    <div class="print-table-wrap">
      <table class="print-table">
        <thead>
          <tr>
            <th>入库单号</th>
            <th>入库状态</th>
            <th>资产编码</th>
            <th>资产名称</th>
            <th>资产分类</th>
            <th>入库日期</th>
            <th>入库人</th>
            <th>金额</th>
          </tr>
        </thead>
        <tbody>
          ${orders
            .map(
              (order) => `<tr>
                <td>${escapeHtml(order.id)}</td>
                <td>${escapeHtml(order.status)}</td>
                <td>${escapeHtml(order.asset.id)}</td>
                <td>${escapeHtml(order.asset.name)}</td>
                <td>${escapeHtml(order.asset.category)}</td>
                <td>${escapeHtml(order.date || "-")}</td>
                <td>${escapeHtml(order.operator || "-")}</td>
                <td>${money(order.asset.price || 0)}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="print-sign-grid">
      <div>入库人：${escapeHtml(orders[0]?.operator || state.currentUser?.name || "-")}</div>
      <div>采购人：${escapeHtml(orders[0]?.purchaser || "-")}</div>
      <div>管理员签字：</div>
      <div>日期：</div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="button" class="btn primary" data-print-current>打印</button>
    </div>
  </div>`;
}

function inboundLabelPrintMarkup(orders) {
  assetLabelPreviewAssets = orders.map((order) => order.asset).filter(Boolean);
  return assetLabelPrintMarkup(assetLabelPreviewAssets);
}

function openInboundPrintModal(type = "inbound-order") {
  const orders = selectedOrVisibleInboundOrders();
  if (!orders.length) {
    showToast("暂无可打印的入库单");
    return;
  }
  modalTitle.textContent = type === "inbound-label" ? "打印资产标签" : "打印入库单";
  modal.classList.remove("asset-create-modal");
  modal.classList.remove("asset-flow-modal");
  modal.classList.remove("asset-import-modal");
  modal.classList.add("print-preview-modal");
  modal.classList.toggle("asset-label-print-modal", type === "inbound-label");
  modalBody.innerHTML = type === "inbound-label" ? inboundLabelPrintMarkup(orders) : inboundOrderPrintMarkup(orders);
  openModal();
}

function inboundStatusPill(status) {
  const tone = status === "已取消" ? "red" : status === "待入库" ? "blue" : "green";
  return `<span class="inbound-status-pill ${tone}">${escapeHtml(status)}</span>`;
}

function receiveReturnOrderId(asset, index = 0, prefix = "LY", overrideDate = "") {
  const sourceDate = overrideDate || asset.receiveDate || asset.returnDate || asset.purchaseDate || todayValue();
  const compactDate = sourceDate.replace(/\D/g, "").slice(0, 8) || todayValue().replace(/\D/g, "");
  return `${prefix}${compactDate}${String(index + 1).padStart(6, "0")}`;
}

function assetHasLifecycle(asset, action) {
  return (asset.lifecycle || []).some((item) => item?.[1] === action);
}

function hasReceiveRecord(asset) {
  return Boolean(asset?.receiveDate || assetHasLifecycle(asset, "资产领用"));
}

function hasBorrowRecord(asset) {
  return Boolean(asset?.borrowDate || assetHasLifecycle(asset, "资产借用") || assetHasLifecycle(asset, "借用归还"));
}

function latestAssetLifecycleDate(asset, action) {
  const event = [...(asset?.lifecycle || [])].reverse().find((item) => item?.[1] === action);
  return event?.[0] || "";
}

function hasHandoverRecord(asset) {
  return Boolean(
    asset?.handoverDate ||
      latestAssetLifecycleDate(asset, "资产交接") ||
      asset?.status === "交接待签字" ||
      (asset?.status === "审批中" && assetHasLifecycle(asset, "资产交接申请"))
  );
}

function handoverStatusForAsset(asset) {
  if (asset?.status === "交接待签字") return "待签字";
  if (asset?.status === "审批中" && assetHasLifecycle(asset, "资产交接申请")) return "审批中";
  return "已完成";
}

function employeeCodeForName(name = "") {
  const user = state.users.find((item) => item.name === name || item.account === name);
  if (user?.account) return user.account;
  return name && name !== "未分配" ? name : "-";
}

function receiveReturnStatusPill(status) {
  const tone = {
    已完成: "green",
    待处理: "blue",
    待签字: "blue",
    审批中: "amber",
  }[status] || "red";
  return `<span class="receive-return-status-pill ${tone}">${escapeHtml(status)}</span>`;
}

function receiveReturnOrderSearchText(order) {
  return [
    order.status,
    order.id,
    order.date,
    order.handler,
    order.receiver,
    order.employeeCode,
    order.company,
    order.department,
    order.location,
    order.note,
    order.asset.id,
    order.asset.name,
    order.asset.category,
    order.asset.brand,
    order.asset.model,
    order.asset.sn,
    order.asset.owner,
    order.asset.custodian,
    order.asset.ownerCompany,
    order.actionLabel,
  ]
    .join("")
    .toLowerCase();
}

function matchesAdvancedReceiveReturnFilters(order) {
  const filters = state.advancedReceiveReturnFilters || defaultAdvancedReceiveReturnFilters();
  const asset = order.asset || {};
  return (
    matchesTextField(order.status, filters.status) &&
    matchesTextField(order.id, filters.id) &&
    dateInRange(order.date, filters.dateStart, filters.dateEnd) &&
    matchesTextField(order.handler, filters.handler) &&
    matchesTextField(order.receiver, filters.receiver) &&
    matchesTextField(order.company, filters.company) &&
    matchesTextField(order.department || asset.department, filters.department) &&
    matchesTextField(order.location, filters.location) &&
    matchesTextField(order.note || asset.note, filters.note) &&
    matchesTextField(asset.id, filters.assetId) &&
    matchesTextField(asset.name, filters.assetName) &&
    matchesTextField(asset.brand, filters.brand) &&
    matchesTextField(asset.model, filters.model) &&
    matchesTextField(asset.sn, filters.sn) &&
    matchesTextField(asset.owner, filters.owner) &&
    matchesTextField(asset.custodian || order.handler, filters.manager) &&
    matchesTextField(asset.ownerCompany || asset.company || order.company, filters.ownerCompany)
  );
}

function matchesReceiveReturnOrder(order) {
  const keyword = state.assetReceiveReturnQuery.trim().toLowerCase();
  return (!keyword || receiveReturnOrderSearchText(order).includes(keyword)) && matchesAdvancedReceiveReturnFilters(order);
}

function getReceiveReturnOrders() {
  const activeTab = state.assetReceiveReturnTab || "receive";
  const scopedAssets = getScopedAssets();
  const rows = scopedAssets
    .map((asset, index) => {
      if (activeTab === "return") {
        const returned = Boolean(asset.returnDate || assetHasLifecycle(asset, "资产退库"));
        if (!returned) return null;
        return {
          id: receiveReturnOrderId(asset, index, "TK"),
          status: "已完成",
          date: asset.returnDate || asset.receiveDate || todayValue(),
          handler: asset.custodian || state.currentUser?.name || "admin",
	          receiver: asset.owner || "未分配",
	          employeeCode: employeeCodeForName(asset.owner),
	          company: asset.company || asset.ownerCompany || "默认公司",
	          department: asset.department || "默认部门",
	          location: asset.location || "-",
	          note: asset.note || "",
	          actionLabel: "查看",
          actionType: "detail",
          asset,
        };
      }

      if (activeTab === "employee") {
        const requested = assetHasLifecycle(asset, "资产领用") || isReceivableAsset(asset);
        if (!requested) return null;
        return {
          id: receiveReturnOrderId(asset, index, "SQ"),
          status: asset.receiveDate ? "已完成" : "待处理",
          date: asset.receiveDate || asset.purchaseDate || todayValue(),
          handler: asset.custodian || state.currentUser?.name || "admin",
	          receiver: asset.owner && asset.owner !== "未分配" ? asset.owner : "-",
	          employeeCode: employeeCodeForName(asset.owner),
	          company: asset.company || asset.ownerCompany || "默认公司",
	          department: asset.department || "默认部门",
	          location: asset.location || "-",
	          note: asset.note || "",
	          actionLabel: isReceivableAsset(asset) ? "领用" : "查看",
          actionType: isReceivableAsset(asset) ? "receive" : "detail",
          asset,
        };
      }

      if (activeTab === "handover") {
        if (!hasHandoverRecord(asset)) return null;
        const handoverDate = asset.handoverDate || latestAssetLifecycleDate(asset, "资产交接") || asset.receiveDate || asset.borrowDate || todayValue();
        const status = handoverStatusForAsset(asset);
        return {
          id: receiveReturnOrderId(asset, index, "JJ", handoverDate),
          status,
          date: handoverDate,
          handler: asset.custodian || state.currentUser?.name || "admin",
	          receiver: asset.owner || "-",
	          employeeCode: employeeCodeForName(asset.owner),
	          company: asset.company || asset.ownerCompany || "默认公司",
	          department: asset.department || "默认部门",
	          location: asset.location || "-",
	          note: asset.note || "",
	          actionLabel: status === "待签字" ? "签字" : "查看",
          actionType: status === "待签字" ? "handover-sign" : "detail",
          asset,
        };
      }

      if (!hasReceiveRecord(asset)) return null;
      return {
        id: receiveReturnOrderId(asset, index, "LY"),
        status: "已完成",
        date: asset.receiveDate || asset.purchaseDate || todayValue(),
        handler: asset.custodian || state.currentUser?.name || "admin",
		        receiver: asset.owner && asset.owner !== "未分配" ? asset.owner : "-",
	        employeeCode: employeeCodeForName(asset.owner),
	        company: asset.company || asset.ownerCompany || "默认公司",
	        department: asset.department || "默认部门",
		        location: asset.location || "-",
		        note: asset.note || "",
		        actionLabel: "查看",
        actionType: "detail",
        asset,
      };
    })
    .filter(Boolean);

  return rows;
}

function receiveReturnColumns(config = receiveReturnViewConfig()) {
  const isHandover = (state.assetReceiveReturnTab || "receive") === "handover";
  const columns = isHandover ? receiveReturnHandoverColumns : receiveReturnStandardColumns;
  return columns.map((column) => {
    if (column.key === "status") return { ...column, label: config.statusLabel };
    if (column.key === "id") return { ...column, label: config.orderLabel };
    if (column.key === "date") return { ...column, label: config.dateLabel };
    if (column.key === "location") return { ...column, label: config.locationLabel };
    if (column.key === "receiver" && !isHandover) {
      return { ...column, label: (state.assetReceiveReturnTab || "receive") === "employee" ? "申领人" : "领用人" };
    }
    return column;
  });
}

function receiveReturnColumnWidth(column, widthMap = state.receiveReturnColumnWidths) {
  const saved = Number(widthMap?.[column.key]);
  const fallback = Number(column.width) || 96;
  const minWidth = Number(column.minWidth) || 48;
  return Math.max(minWidth, Number.isFinite(saved) ? saved : fallback);
}

function receiveReturnTableMinWidth(columns = receiveReturnColumns(), widthMap = state.receiveReturnColumnWidths) {
  return columns.reduce((total, column) => total + receiveReturnColumnWidth(column, widthMap), 0);
}

function renderReceiveReturnColgroup(columns) {
  return `<colgroup>${columns
    .map((column) => `<col data-column-key="${escapeHtml(column.key)}" style="width:${receiveReturnColumnWidth(column)}px">`)
    .join("")}</colgroup>`;
}

function renderReceiveReturnHeader(column, config, allChecked, rowCount) {
  const content =
    column.key === "select"
      ? `<input type="checkbox" data-receive-return-check-all aria-label="全选${escapeHtml(config.moduleName)}单" ${allChecked ? "checked" : ""} ${rowCount ? "" : "disabled"}>`
      : `<span class="resizable-column-label">${escapeHtml(column.label)}</span>`;
  const resizeHandle =
    column.resizable === false
      ? ""
      : `<span class="column-resize-handle" data-column-resize="receiveReturn:${escapeHtml(column.key)}" role="separator" aria-orientation="vertical" aria-label="调整${escapeHtml(column.label)}列宽"></span>`;
  const className = column.key === "select" ? ` class="receive-return-select-cell"` : "";
  return `<th${className} data-column-key="${escapeHtml(column.key)}" data-min-width="${column.minWidth || 48}">${content}${resizeHandle}</th>`;
}

function renderReceiveReturnRow(order) {
  const checked = state.selectedAssetIds.includes(order.asset.id);
  const columns = receiveReturnColumns();
  return `<tr>${columns
    .map((column) => {
      const className = column.key === "select" ? ` class="receive-return-select-cell"` : "";
      return `<td${className} data-column-key="${escapeHtml(column.key)}">${receiveReturnCellMarkup(order, column, checked)}</td>`;
    })
    .join("")}</tr>`;
}

function receiveReturnActionMarkup(order) {
  if ((state.assetReceiveReturnTab || "receive") === "handover") {
    return order.actionType === "handover-sign"
      ? `<button class="link receive-return-action-link" data-sign-handover-asset="${escapeHtml(order.asset.id)}">签字</button>
         <button class="link receive-return-action-link danger" data-cancel-handover-asset="${escapeHtml(order.asset.id)}">取消交接</button>`
      : `<button class="link receive-return-action-link" data-detail="${escapeHtml(order.asset.id)}">查看</button>`;
  }
  if (order.actionType === "receive") return `<button class="link receive-return-action-link" data-quick-receive-asset="${escapeHtml(order.asset.id)}">领用</button>`;
  if (order.actionType === "return") return `<button class="link receive-return-action-link" data-quick-return-asset="${escapeHtml(order.asset.id)}">退库</button>`;
  if (order.actionType === "handover") return `<button class="link receive-return-action-link" data-quick-handover-asset="${escapeHtml(order.asset.id)}">交接</button>`;
  return `<button class="link receive-return-action-link" data-detail="${escapeHtml(order.asset.id)}">查看</button>`;
}

function receiveReturnCellMarkup(order, column, checked) {
  if (column.key === "select") {
    return `<input type="checkbox" data-receive-return-select="${escapeHtml(order.asset.id)}" aria-label="选择${escapeHtml(order.id)}" ${checked ? "checked" : ""}>`;
  }
  if (column.key === "status") return receiveReturnStatusPill(order.status);
  if (column.key === "id") return `<button class="link receive-return-order-link" data-detail="${escapeHtml(order.asset.id)}">${escapeHtml(order.id)}</button>`;
  if (column.key === "assetId") return escapeHtml(order.asset.id || "-");
  if (column.key === "action") return receiveReturnActionMarkup(order);
  return escapeHtml(order[column.key] || "-");
}

function setReceiveReturnTab(tab) {
  state.assetReceiveReturnTab = tab || "receive";
  state.assetReceiveReturnPage = 1;
  state.selectedAssetIds = [];
  render();
}

function setAllVisibleReceiveReturnAssets(rows, checked) {
  const selected = new Set(state.selectedAssetIds);
  rows.forEach((order) => {
    if (checked) selected.add(order.asset.id);
    else selected.delete(order.asset.id);
  });
  state.selectedAssetIds = Array.from(selected);
}

function getSelectedReceiveReturnOrders() {
  const selected = new Set(state.selectedAssetIds);
  return getReceiveReturnOrders().filter((order) => matchesReceiveReturnOrder(order) && selected.has(order.asset.id));
}

function selectedOrVisibleReceiveReturnOrders() {
  const selected = getSelectedReceiveReturnOrders();
  return selected.length ? selected : currentReceiveReturnRows();
}

function receiveReturnViewConfig() {
  const tab = state.assetReceiveReturnTab || "receive";
  const configs = {
    receive: {
      moduleName: "领用",
      statusLabel: "领用状态",
      orderLabel: "领用单号",
      dateLabel: "领用日期",
      locationLabel: "领用后位置",
      emptyText: "暂无领用记录。",
      searchEmptyText: "没有匹配的领用记录。",
      printLabel: "打印领用单",
      printTitle: "领用单打印预览",
      exportSheetName: "领用信息",
      exportFileName: "资产领用信息",
      toastName: "领用信息",
      columns: ["领用状态", "领用单号", "领用日期", "经办人", "领用人", "工号", "领用后位置", "所属公司", "资产编码", "操作"],
    },
    return: {
      moduleName: "退库",
      statusLabel: "退库状态",
      orderLabel: "退库单号",
      dateLabel: "退库日期",
      locationLabel: "退库后位置",
      emptyText: "暂无退库记录。",
      searchEmptyText: "没有匹配的退库记录。",
      printLabel: "打印领用退库单",
      printTitle: "领用退库单打印预览",
      exportSheetName: "退库信息",
      exportFileName: "资产退库信息",
      toastName: "退库信息",
      columns: ["退库状态", "退库单号", "退库日期", "经办人", "领用人", "工号", "退库后位置", "所属公司", "资产编码", "操作"],
    },
    employee: {
      moduleName: "员工申领",
      statusLabel: "申领状态",
      orderLabel: "申领单号",
      dateLabel: "申领日期",
      locationLabel: "申领后位置",
      emptyText: "暂无员工申领记录。",
      searchEmptyText: "没有匹配的员工申领记录。",
      printLabel: "打印员工申领单",
      printTitle: "员工申领单打印预览",
      exportSheetName: "员工申领信息",
      exportFileName: "员工申领信息",
      toastName: "员工申领信息",
      columns: ["申领状态", "申领单号", "申领日期", "经办人", "申领人", "工号", "申领后位置", "所属公司", "资产编码", "操作"],
    },
    handover: {
      moduleName: "交接",
      statusLabel: "交接状态",
      orderLabel: "交接单号",
      dateLabel: "交接日期",
      emptyText: "暂无交接记录。",
      searchEmptyText: "没有匹配的交接记录。",
      printLabel: "打印交接单",
      printTitle: "交接单打印预览",
      exportSheetName: "交接信息",
      exportFileName: "资产交接信息",
      toastName: "交接信息",
      columns: ["交接状态", "交接单号", "经办人", "接收人", "接收公司", "接收部门", "操作"],
    },
  };
  return configs[tab] || configs.receive;
}

function exportSelectedReceiveReturnOrders() {
  const config = receiveReturnViewConfig();
  const orders = selectedOrVisibleReceiveReturnOrders();
  if (!orders.length) {
    showToast(`暂无可导出的${config.toastName}`);
    return;
  }

  const isHandover = (state.assetReceiveReturnTab || "receive") === "handover";
  const columns = isHandover
    ? [
        ["status", config.statusLabel, 86],
        ["id", config.orderLabel, 180],
        ["handler", "经办人", 96],
        ["receiver", "接收人", 96],
        ["company", "接收公司", 120],
        ["department", "接收部门", 120],
        ["assetId", "资产编码", 130],
        ["assetName", "资产名称", 160],
      ]
    : [
        ["status", config.statusLabel, 86],
        ["id", config.orderLabel, 180],
        ["date", config.dateLabel, 120],
        ["handler", "经办人", 96],
        ["receiver", "领用人", 96],
        ["employeeCode", "工号", 110],
        ["location", config.locationLabel, 150],
        ["company", "所属公司", 120],
        ["assetId", "资产编码", 130],
        ["assetName", "资产名称", 160],
      ];
  const rows = orders.map((order) => ({
    status: order.status || "-",
    id: order.id || "-",
    date: order.date || "-",
    handler: order.handler || "-",
    receiver: order.receiver || "-",
    employeeCode: order.employeeCode || "-",
    location: order.location || "-",
    company: order.company || "-",
    assetId: order.asset.id || "-",
    assetName: order.asset.name || "-",
  }));
  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header"><Font ss:Bold="1" /><Interior ss:Color="#9DC3E6" ss:Pattern="Solid" /></Style>
    <Style ss:ID="Body" />
  </Styles>
  <Worksheet ss:Name="${escapeXml(config.exportSheetName)}">
    <Table>
      ${columns.map(([, , width]) => `<Column ss:Width="${width}" />`).join("")}
      <Row>${columns.map(([, label]) => excelCell(label, "Header")).join("")}</Row>
      ${rows.map((row) => `<Row>${columns.map(([key]) => excelCell(row[key], "Body")).join("")}</Row>`).join("")}
    </Table>
  </Worksheet>
</Workbook>`;
  downloadBlob(`${config.exportFileName}_${todayValue()}_${orders.length}条.xls`, workbook, "application/vnd.ms-excel;charset=utf-8");
  showToast(`已导出 ${orders.length} 条${config.toastName}`);
}

function openReceiveReturnPrintModal() {
  const config = receiveReturnViewConfig();
  const orders = selectedOrVisibleReceiveReturnOrders();
  if (!orders.length) {
    showToast(`暂无可打印的${config.toastName}`);
    return;
  }
  modalTitle.textContent = config.printLabel;
  modal.classList.remove("asset-create-modal");
  modal.classList.remove("asset-flow-modal");
  modal.classList.remove("asset-import-modal");
  modal.classList.add("print-preview-modal");
  modalBody.innerHTML = `<div class="print-preview">
    <div class="print-preview-head">
      <div>
        <div class="eyebrow">${escapeHtml(config.moduleName)}</div>
        <h3>${escapeHtml(config.printTitle)}</h3>
      </div>
      <span class="tag blue">共 ${orders.length} 条</span>
    </div>
    <div class="print-table-wrap">
      <table class="print-table">
        <thead><tr><th>单号</th><th>状态</th><th>日期</th><th>经办人</th><th>${state.assetReceiveReturnTab === "handover" ? "接收人" : "领用人"}</th><th>资产编码</th><th>资产名称</th></tr></thead>
        <tbody>
          ${orders
            .map(
              (order) => `<tr>
                <td>${escapeHtml(order.id)}</td>
                <td>${escapeHtml(order.status)}</td>
                <td>${escapeHtml(order.date || "-")}</td>
                <td>${escapeHtml(order.handler || "-")}</td>
                <td>${escapeHtml(order.receiver || "-")}</td>
                <td>${escapeHtml(order.asset.id || "-")}</td>
                <td>${escapeHtml(order.asset.name || "-")}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="print-sign-grid">
      <div>经办人：${escapeHtml(orders[0]?.handler || state.currentUser?.name || "-")}</div>
      <div>${state.assetReceiveReturnTab === "handover" ? "接收人" : "领用人"}：</div>
      <div>管理员签字：</div>
      <div>日期：</div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="button" class="btn primary" data-print-current>打印</button>
    </div>
  </div>`;
  openModal();
}

function renderAssetReceiveReturn() {
  const config = receiveReturnViewConfig();
  const filtered = getReceiveReturnOrders().filter(matchesReceiveReturnOrder);
  const pagination = paginateRows(filtered, "receiveReturn");
  const displayRows = pagination.rows;
  const visibleIds = new Set(displayRows.map((order) => order.asset.id));
  state.selectedAssetIds = state.selectedAssetIds.filter((id) => visibleIds.has(id));
  const allChecked = displayRows.length > 0 && displayRows.every((order) => state.selectedAssetIds.includes(order.asset.id));
  const tabs = [
    ["receive", "领用"],
    ["return", "退库"],
    ["employee", "员工申领"],
    ["handover", "交接"],
  ];
  const columns = receiveReturnColumns(config);
  const primaryAction =
    state.assetReceiveReturnTab === "return"
      ? `<button class="table-action primary" type="button" data-start-asset-return>＋ 新增</button>`
      : state.assetReceiveReturnTab === "handover"
      ? `<button class="table-action primary" type="button" data-start-asset-handover>＋ 新增</button>`
      : `<button class="table-action primary" type="button" data-start-asset-receive>＋ 新增</button>`;
  const tableHead = `<tr>${columns.map((column) => renderReceiveReturnHeader(column, config, allChecked, displayRows.length)).join("")}</tr>`;

  return `<section class="receive-return-ledger">
    <div class="receive-return-tabs">
      ${tabs
        .map(
          ([key, label]) => `<button class="receive-return-tab ${state.assetReceiveReturnTab === key ? "active" : ""}" type="button" data-receive-return-tab="${key}">${label}</button>`
        )
        .join("")}
    </div>
    <div class="receive-return-toolbar">
      <div class="asset-list-actions">
        ${primaryAction}
        <div class="table-action-menu">
          <button class="table-action has-caret" type="button" data-flow-print-action="receive-return">打印<span class="action-caret" aria-hidden="true"></span></button>
          <div class="table-dropdown">
            <button type="button" data-flow-print-action="receive-return">${escapeHtml(config.printLabel)}</button>
          </div>
        </div>
        <button class="table-action receive-return-export" type="button" data-import-action="export">⇱ 导出</button>
      </div>
      <div class="asset-list-search receive-return-search">
        <input class="local-search" type="search" placeholder="模糊查询" value="${escapeHtml(state.assetReceiveReturnQuery)}" autocomplete="off">
        <button class="table-action primary" data-search aria-label="搜索">⌕</button>
      </div>
    </div>
    <div class="receive-return-table-shell">
      <div class="receive-return-table-actions">
        <button class="link" data-advanced-search="receiveReturn">高级搜索</button>
        <button class="list-settings-button" data-list-settings="receiveReturn" title="列表设置" aria-label="列表设置">⚙</button>
      </div>
      <div class="receive-return-table-scroll">
        <table class="receive-return-table" data-resizable-table="receiveReturn" style="min-width:${receiveReturnTableMinWidth(columns)}px">
          ${renderReceiveReturnColgroup(columns)}
          <thead>
            ${tableHead}
          </thead>
          <tbody>
            ${
              displayRows.length
                ? displayRows.map(renderReceiveReturnRow).join("")
                : `<tr class="empty-row"><td colspan="${columns.length}">${
                    state.assetReceiveReturnQuery ? escapeHtml(config.searchEmptyText) : escapeHtml(config.emptyText)
                  }</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
    ${renderPagination(pagination, "receiveReturn")}
  </section>`;
}

function renderAssetTransferOwner() {
  const rows = getScopedAssets().filter((item) => item.status === "在用");
  return `${pageHeader("变更领用人", "领用后的资产支持在线交接，管理员可变更资产当前领用人。", "发起交接", null, { actionAttr: "data-bulk-asset-action=\"handover\"" })}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>资产编号</th><th>资产名称</th><th>当前领用人</th><th>部门</th><th>使用信息</th><th>操作</th></tr></thead>
          <tbody>${rows.map((item) => `<tr><td>${item.id}</td><td>${item.name}</td><td>${item.owner}</td><td>${item.department}</td><td>${item.location}</td><td><button class="btn" data-quick-handover-asset="${escapeHtml(item.id)}">在线交接</button></td></tr>`).join("")}</tbody>
        </table>
    </section>`;
}

function borrowReturnOrderId(asset, index = 0, prefix = "JY") {
  const sourceDate = asset.borrowDate || asset.returnDate || asset.purchaseDate || todayValue();
  const compactDate = sourceDate.replace(/\D/g, "").slice(0, 8) || todayValue().replace(/\D/g, "");
  return `${prefix}${compactDate}${String(index + 1).padStart(6, "0")}`;
}

function borrowReturnStatusPill(status) {
  const tone =
    status === "已撤销"
      ? "gray"
      : status === "已完成" || status === "已归还"
      ? "green"
      : status === "待归还"
      ? "blue"
      : "amber";
  return `<span class="receive-return-status-pill ${tone}">${escapeHtml(status)}</span>`;
}

function borrowReturnSearchText(row) {
  return [
    row.status,
    row.id,
    row.handler,
    row.borrower,
    row.borrowDate,
    row.expectedReturnDate,
    row.company,
    row.department,
    row.employeeCode,
    row.phone,
    row.email,
    row.location,
    row.signer,
    row.note,
    row.asset.id,
    row.asset.name,
    row.asset.category,
    row.asset.brand,
    row.asset.model,
    row.asset.sn,
    row.asset.location,
  ]
    .join("")
    .toLowerCase();
}

function hasActiveAdvancedBorrowReturnFilters() {
  const filters = state.advancedBorrowReturnFilters || defaultAdvancedBorrowReturnFilters();
  return Object.values(filters).some((value) => String(value || "").trim());
}

function borrowReturnDateInRange(value, start, end) {
  const hasDateFilter = Boolean(start || end);
  const current = String(value || "").trim();
  if (hasDateFilter && !/^\d{4}-\d{2}-\d{2}$/.test(current)) return false;
  return dateInRange(current, start, end);
}

function matchesAdvancedBorrowReturnFilters(row) {
  const filters = state.advancedBorrowReturnFilters || defaultAdvancedBorrowReturnFilters();
  const asset = row.asset || {};
  return (
    matchesTextField(row.status, filters.status) &&
    matchesTextField(row.id, filters.id) &&
    matchesTextField(row.handler, filters.handler) &&
    matchesTextField(row.borrower, filters.borrower) &&
    borrowReturnDateInRange(row.borrowDate, filters.borrowDateStart, filters.borrowDateEnd) &&
    borrowReturnDateInRange(row.expectedReturnDate, filters.expectedReturnDateStart, filters.expectedReturnDateEnd) &&
    matchesTextField(asset.id, filters.assetId) &&
    matchesTextField(asset.sn, filters.sn) &&
    matchesTextField(row.company || asset.company || asset.ownerCompany, filters.company) &&
    matchesTextField(row.department || asset.department, filters.department) &&
    matchesTextField(row.employeeCode, filters.employeeCode) &&
    matchesTextField(row.phone || asset.phone, filters.phone) &&
    matchesTextField(row.email || asset.email, filters.email) &&
    matchesTextField(row.location || asset.location, filters.location)
  );
}

function getBorrowReturnRows() {
  const activeTab = state.assetBorrowReturnTab || "borrow";
  return getScopedAssets()
    .map((asset, index) => {
      if (activeTab === "return") {
        if (!isBorrowReturnableAsset(asset)) return null;
        return {
          id: borrowReturnOrderId(asset, index, "GH"),
          status: "待归还",
          handler: asset.custodian || state.currentUser?.name || "admin",
          borrower: asset.owner || "-",
          borrowDate: asset.borrowDate || "-",
          expectedReturnDate: asset.expectedReturnDate || "-",
          company: asset.company || asset.ownerCompany || "默认公司",
          department: asset.department || "默认部门",
          employeeCode: employeeCodeForName(asset.owner),
          phone: asset.phone || "-",
          email: asset.email || "-",
          location: asset.location || "-",
          signer: asset.owner && asset.owner !== "未分配" ? asset.owner : "-",
          signImage: "-",
          note: asset.note || "",
          actionType: "return",
          asset,
        };
      }
      if (!hasBorrowRecord(asset)) return null;
      const borrowDate = asset.borrowDate || latestAssetLifecycleDate(asset, "资产借用") || "-";
      const canceled = ["已撤销", "已取消"].includes(asset.borrowOrderStatus) || assetHasLifecycle(asset, "取消借用") || assetHasLifecycle(asset, "撤销借用");
      return {
        id: borrowReturnOrderId(asset, index, "JY"),
        status: canceled ? "已撤销" : "已完成",
        handler: asset.custodian || state.currentUser?.name || "admin",
        borrower: asset.owner && asset.owner !== "未分配" ? asset.owner : "-",
        borrowDate,
        expectedReturnDate: asset.expectedReturnDate || "-",
        company: asset.company || asset.ownerCompany || "默认公司",
        department: asset.department || "默认部门",
        employeeCode: employeeCodeForName(asset.owner),
        phone: asset.phone || "-",
        email: asset.email || "-",
        location: asset.location || "-",
        signer: asset.owner && asset.owner !== "未分配" ? asset.owner : "-",
        signImage: "-",
        note: asset.note || "",
        actionType: "detail",
        asset,
      };
    })
    .filter(Boolean);
}

function matchesBorrowReturnRow(row) {
  const keyword = state.assetBorrowReturnQuery.trim().toLowerCase();
  return (!keyword || borrowReturnSearchText(row).includes(keyword)) && matchesAdvancedBorrowReturnFilters(row);
}

function currentBorrowReturnRows() {
  return paginateRows(getBorrowReturnRows().filter(matchesBorrowReturnRow), "borrowReturn").rows;
}

function setBorrowReturnTab(tab) {
  state.assetBorrowReturnTab = tab || "borrow";
  state.assetBorrowReturnPage = 1;
  state.selectedAssetIds = [];
  render();
}

function setAllVisibleBorrowReturnAssets(rows, checked) {
  const selected = new Set(state.selectedAssetIds);
  rows.forEach((row) => {
    if (checked) selected.add(row.asset.id);
    else selected.delete(row.asset.id);
  });
  state.selectedAssetIds = Array.from(selected);
}

function borrowReturnColumnWidth(column, widthMap = state.borrowReturnColumnWidths) {
  const saved = Number(widthMap?.[column.key]);
  const fallback = Number(column.width) || 120;
  const minWidth = Number(column.minWidth) || 72;
  return Math.max(minWidth, Number.isFinite(saved) ? saved : fallback);
}

function borrowReturnTableMinWidth(widthMap = state.borrowReturnColumnWidths) {
  return borrowReturnTableColumns.reduce((total, column) => total + borrowReturnColumnWidth(column, widthMap), 0);
}

function renderBorrowReturnColgroup() {
  return `<colgroup>${borrowReturnTableColumns
    .map((column) => `<col data-column-key="${escapeHtml(column.key)}" style="width:${borrowReturnColumnWidth(column)}px">`)
    .join("")}</colgroup>`;
}

function renderBorrowReturnHeader(column, allChecked, rowCount) {
  const content =
    column.key === "select"
      ? `<input type="checkbox" data-borrow-return-check-all aria-label="全选借用归还单" ${allChecked ? "checked" : ""} ${rowCount ? "" : "disabled"}>`
      : `<span class="resizable-column-label">${escapeHtml(column.label)}</span>`;
  const resizeHandle =
    column.resizable === false
      ? ""
      : `<span class="column-resize-handle" data-column-resize="borrowReturn:${escapeHtml(column.key)}" role="separator" aria-orientation="vertical" aria-label="调整${escapeHtml(column.label)}列宽"></span>`;
  const className = column.key === "select" ? ` class="receive-return-select-cell"` : "";
  return `<th${className} data-column-key="${escapeHtml(column.key)}" data-min-width="${column.minWidth || 72}">${content}${resizeHandle}</th>`;
}

function borrowReturnActionMarkup(row) {
  return (
    row.actionType === "return"
      ? `<button class="link receive-return-action-link" data-quick-borrow-flow="borrowReturn" data-asset-id="${escapeHtml(row.asset.id)}">归还</button>
         <button class="link receive-return-action-link" data-delay-borrow-asset="${escapeHtml(row.asset.id)}">延期</button>`
      : row.actionType === "borrow"
      ? `<button class="link receive-return-action-link" data-quick-borrow-flow="borrow" data-asset-id="${escapeHtml(row.asset.id)}">借用</button>`
      : `<button class="link receive-return-action-link" data-detail="${escapeHtml(row.asset.id)}">查看</button>`
  );
}

function borrowReturnCellMarkup(row, column) {
  const checked = state.selectedAssetIds.includes(row.asset.id);
  if (column.key === "select") {
    return `<input type="checkbox" data-borrow-return-select="${escapeHtml(row.asset.id)}" aria-label="选择${escapeHtml(row.id)}" ${checked ? "checked" : ""}>`;
  }
  if (column.key === "status") return borrowReturnStatusPill(row.status);
  if (column.key === "order") return `<button class="link receive-return-order-link" data-detail="${escapeHtml(row.asset.id)}">${escapeHtml(row.id)}</button>`;
  if (column.key === "assetCode") return `<span class="asset-code-text">${escapeHtml(row.asset.id || "-")}</span>`;
  if (column.key === "category") return escapeHtml(row.asset.category || "-");
  if (column.key === "assetName") return escapeHtml(row.asset.name || "-");
  if (column.key === "brand") return escapeHtml(row.asset.brand || "-");
  if (column.key === "model") return escapeHtml(row.asset.model || "-");
  if (column.key === "sn") return escapeHtml(row.asset.sn || "-");
  if (column.key === "action") return borrowReturnActionMarkup(row);
  return escapeHtml(row[column.key] || "-");
}

function renderBorrowReturnRow(row) {
  return `<tr>${borrowReturnTableColumns
    .map((column) => {
      const className = column.key === "select" ? ` class="receive-return-select-cell"` : "";
      return `<td${className} data-column-key="${escapeHtml(column.key)}">${borrowReturnCellMarkup(row, column)}</td>`;
    })
    .join("")}</tr>`;
}

function renderAssetBorrowReturn() {
  const filtered = getBorrowReturnRows().filter(matchesBorrowReturnRow);
  const pagination = paginateRows(filtered, "borrowReturn");
  const displayRows = pagination.rows;
  const visibleIds = new Set(displayRows.map((row) => row.asset.id));
  state.selectedAssetIds = state.selectedAssetIds.filter((id) => visibleIds.has(id));
  const allChecked = displayRows.length > 0 && displayRows.every((row) => state.selectedAssetIds.includes(row.asset.id));
  const activeTab = state.assetBorrowReturnTab || "borrow";
  const tabs = [
    ["borrow", "借用"],
    ["return", "归还"],
  ];
  const emptyText = activeTab === "return" ? "暂无可归还记录。" : "暂无借用记录。";
  const searchEmptyText = activeTab === "return" ? "没有匹配的归还记录。" : "没有匹配的借用记录。";
  const hasFilter = Boolean(state.assetBorrowReturnQuery.trim()) || hasActiveAdvancedBorrowReturnFilters();
  return `<section class="receive-return-ledger borrow-return-ledger">
    <div class="receive-return-tabs">
      ${tabs
        .map(([key, label]) => `<button class="receive-return-tab ${activeTab === key ? "active" : ""}" type="button" data-borrow-return-tab="${key}">${label}</button>`)
        .join("")}
    </div>
    <div class="receive-return-toolbar">
      <div class="asset-list-actions">
        <button class="table-action primary" type="button" data-start-asset-borrow>＋ 新增</button>
        <div class="table-action-menu">
          <button class="table-action has-caret" type="button" data-borrow-print>打印<span class="action-caret" aria-hidden="true"></span></button>
          <div class="table-dropdown">
            <button type="button" data-borrow-print>打印借用归还单</button>
          </div>
        </div>
        <button class="table-action receive-return-export" type="button" data-import-action="export">⇱ 导出</button>
      </div>
      <div class="asset-list-search receive-return-search">
        <input class="local-search" type="search" placeholder="模糊查询" value="${escapeHtml(state.assetBorrowReturnQuery)}" autocomplete="off">
        <button class="table-action primary" data-search aria-label="搜索">⌕</button>
      </div>
    </div>
    <div class="receive-return-table-shell">
      <div class="receive-return-table-actions">
        <button class="link" type="button" data-borrow-advanced-search>高级搜索</button>
        <button class="list-settings-button" type="button" data-borrow-list-settings title="列表设置" aria-label="列表设置">⚙</button>
      </div>
      <div class="receive-return-table-scroll">
        <table class="receive-return-table borrow-return-table" data-resizable-table="borrowReturn" style="min-width:${borrowReturnTableMinWidth()}px">
          ${renderBorrowReturnColgroup()}
          <thead>
            <tr>
              ${borrowReturnTableColumns.map((column) => renderBorrowReturnHeader(column, allChecked, displayRows.length)).join("")}
            </tr>
          </thead>
          <tbody>
            ${
              displayRows.length
                ? displayRows.map(renderBorrowReturnRow).join("")
                : `<tr class="empty-row"><td colspan="${borrowReturnTableColumns.length}">${hasFilter ? searchEmptyText : emptyText}</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
    ${renderPagination(pagination, "borrowReturn")}
  </section>`;
}

function renderAssetSettings() {
  const activeSection = assetSettingSections.find((section) => section.id === state.route) || assetSettingSections[0];
  if (activeSection.id === "assetLocationSettings") return renderAssetLocationSettings(activeSection);
  if (activeSection.id === "assetCategorySettings") return renderAssetCategorySettings(activeSection);
  if (activeSection.id === "assetCodeRules") return renderAssetCodeRules(activeSection);
  if (activeSection.id === "assetLabelTemplateSettings") return renderAssetLabelTemplateSettings(activeSection);
  return pageHeader(activeSection.label, activeSection.description, null, null, { showExport: false, showBatch: false });
}

function assetCodeRuleFieldByKey(key) {
  return assetCodeRuleFieldDefinitions.find((field) => field.key === key);
}

function assetCodeRuleFieldButton(field, selected = false) {
  const optionValue = state.assetCodeRuleSettings.fieldOptions?.[field.key] || "none";
  const customTextValue = state.assetCodeRuleSettings.customTexts?.[field.key] || "";
  const dateFormatValue = state.assetCodeRuleSettings.dateFormats?.[field.key] || "yyyymmdd";
  return `<div class="asset-code-rule-field ${selected ? "selected" : ""}" data-code-rule-field="${escapeHtml(field.key)}">
    <span class="asset-code-rule-field-name">${escapeHtml(field.label)}${field.help ? ` <i aria-label="自定义文本说明">?</i>` : ""}</span>
    ${
      selected
        ? `<span class="asset-code-rule-field-controls">
            ${
              field.key === "customText"
                ? `<input class="asset-code-rule-custom-input" data-code-rule-custom-text="${escapeHtml(field.key)}" value="${escapeHtml(customTextValue)}" placeholder="请输入文本" maxlength="16" aria-label="自定义文本内容" />`
                : ""
            }
            ${
              field.key === "purchaseDate"
                ? `<select class="asset-code-rule-date-format" data-code-rule-date-format="${escapeHtml(field.key)}" aria-label="购置起租日期格式">
                    ${assetCodeRuleDateFormats.map((format) => `<option value="${escapeHtml(format.value)}" ${dateFormatValue === format.value ? "selected" : ""}>${escapeHtml(format.label)}</option>`).join("")}
                  </select>`
                : ""
            }
            <select data-code-rule-option="${escapeHtml(field.key)}" aria-label="${escapeHtml(field.label)}规则选项">
            <option value="none" ${optionValue === "none" ? "selected" : ""}>无</option>
            <option value="dash" ${optionValue === "dash" ? "selected" : ""}>-</option>
            <option value="slash" ${optionValue === "slash" ? "selected" : ""}>/</option>
          </select>
          </span>`
        : ""
    }
  </div>`;
}

function assetCodeRulePreviewText(settings = state.assetCodeRuleSettings) {
  const normalized = normalizeAssetCodeRuleSettings(settings);
  const labels = normalized.selectedFields
    .map((key) => {
      const field = assetCodeRuleFieldByKey(key);
      const customText = key === "customText" ? String(normalized.customTexts?.customText || "").trim() : "";
      const dateFormat = key === "purchaseDate"
        ? assetCodeRuleDateFormats.find((format) => format.value === normalized.dateFormats?.purchaseDate)?.label
        : "";
      return {
        key,
        label: customText || dateFormat || field?.label,
      };
    })
    .filter((field) => field.label);
  if (!labels.length) return "流水号";
  const text = labels.reduce((result, field) => {
    const separator = assetCodeRuleSeparator(normalized.fieldOptions?.[field.key]);
    const connector = separator || "+";
    return `${result}${field.label}${connector}`;
  }, "");
  return `${text}流水号`;
}

function assetCodeRuleCurrentLength(settings = state.assetCodeRuleSettings) {
  const normalized = normalizeAssetCodeRuleSettings(settings);
  const selectedLength = normalized.selectedFields.reduce((sum, key) => {
    const field = assetCodeRuleFieldByKey(key);
    const fieldLength = key === "customText"
      ? String(normalized.customTexts?.customText || "").trim().length
      : key === "purchaseDate"
        ? assetCodeRuleDateFormats.find((format) => format.value === normalized.dateFormats?.purchaseDate)?.width || field?.width || 0
        : field?.width || 0;
    return sum + fieldLength + assetCodeRuleSeparator(normalized.fieldOptions?.[key]).length;
  }, 0);
  return selectedLength + Math.round(clampNumber(normalized.serialLength, 5, 3, 7));
}

function renderAssetCodeRules(activeSection) {
  const settings = normalizeAssetCodeRuleSettings(state.assetCodeRuleSettings);
  const selected = settings.selectedFields;
  const selectedSet = new Set(selected);
  const available = assetCodeRuleFieldDefinitions.filter((field) => !selectedSet.has(field.key));
  state.assetCodeRuleSettings = settings;
  return `<section class="asset-code-rule-page">
    <header class="asset-code-rule-title">
      <h1>${escapeHtml(activeSection.label)}</h1>
    </header>
    <div class="asset-code-rule-workspace">
      <section class="asset-code-rule-box" aria-label="可选字段">
        <h2>可选字段</h2>
        <div class="asset-code-rule-list" data-code-rule-list="available">
          ${available.map((field) => assetCodeRuleFieldButton(field)).join("")}
        </div>
      </section>
      <div class="asset-code-rule-transfer" aria-hidden="true">
        <strong>⇆</strong>
        <span>左右拖拽</span>
      </div>
      <section class="asset-code-rule-box" aria-label="已选字段">
        <h2>已选字段</h2>
        <div class="asset-code-rule-list" data-code-rule-list="selected">
          ${selected.map((key) => assetCodeRuleFieldByKey(key)).filter(Boolean).map((field) => assetCodeRuleFieldButton(field, true)).join("")}
        </div>
      </section>
    </div>
    <div class="asset-code-rule-serial">
      <label>
        <span>流水号：</span>
        <select data-code-rule-serial>
          ${[3, 4, 5, 6, 7].map((length) => `<option value="${length}" ${settings.serialLength === length ? "selected" : ""}>${length}</option>`).join("")}
        </select>
      </label>
      <span>流水号可选范围为3-7位</span>
    </div>
    <section class="asset-code-rule-preview">
      <p>规则预览：<strong>${escapeHtml(assetCodeRulePreviewText(settings))}</strong></p>
      <p>当前编码规则下资产编码长度：<b>${assetCodeRuleCurrentLength(settings)}位</b></p>
    </section>
    <div class="asset-code-rule-actions">
      <button class="btn primary" type="button" data-code-rule-save>保存</button>
    </div>
  </section>`;
}

function moveAssetCodeRuleField(fieldKey, targetList, beforeKey = "") {
  if (!assetCodeRuleFieldByKey(fieldKey)) return;
  const selected = state.assetCodeRuleSettings.selectedFields.filter((key) => key !== fieldKey);
  if (targetList === "selected") {
    const insertIndex = beforeKey ? selected.indexOf(beforeKey) : -1;
    if (insertIndex >= 0) selected.splice(insertIndex, 0, fieldKey);
    else selected.push(fieldKey);
  }
  state.assetCodeRuleSettings = normalizeAssetCodeRuleSettings({
    ...state.assetCodeRuleSettings,
    selectedFields: selected,
  });
  render();
}

function assetCodeRuleDropTarget(list, pointerY) {
  const fields = [...list.querySelectorAll("[data-code-rule-field]:not(.dragging)")];
  return fields.find((field) => {
    const rect = field.getBoundingClientRect();
    return pointerY < rect.top + rect.height / 2;
  });
}

function bindAssetCodeRuleControls(root = document) {
  const pageHost = root.querySelector(".asset-code-rule-page");
  if (!pageHost) return;
  let pointerDrag = null;

  const clearPointerDrag = () => {
    if (!pointerDrag) return;
    pointerDrag.element.classList.remove("dragging");
    pointerDrag.ghost?.remove();
    pageHost.querySelectorAll("[data-code-rule-list]").forEach((list) => list.classList.remove("drag-over"));
    pointerDrag = null;
  };

  const moveDragGhost = (event) => {
    if (!pointerDrag?.ghost) return;
    pointerDrag.ghost.style.transform = `translate(${event.clientX - pointerDrag.offsetX}px, ${event.clientY - pointerDrag.offsetY}px)`;
  };

  const createDragGhost = (event) => {
    if (!pointerDrag || pointerDrag.ghost) return;
    const rect = pointerDrag.element.getBoundingClientRect();
    const ghost = pointerDrag.element.cloneNode(true);
    ghost.classList.add("asset-code-rule-drag-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    pointerDrag.offsetX = event.clientX - rect.left;
    pointerDrag.offsetY = event.clientY - rect.top;
    pointerDrag.ghost = ghost;
    document.body.appendChild(ghost);
    moveDragGhost(event);
  };

  const dragListAtPoint = (x, y) => {
    const element = document.elementFromPoint(x, y);
    const list = element?.closest?.("[data-code-rule-list]");
    return pageHost.contains(list) ? list : null;
  };

  const handlePointerDragMove = (event) => {
    if (!pointerDrag) return;
    const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
    if (!pointerDrag.started && distance < 6) return;
    pointerDrag.started = true;
    pointerDrag.element.classList.add("dragging");
    createDragGhost(event);
    moveDragGhost(event);
    pageHost.querySelectorAll("[data-code-rule-list]").forEach((list) => list.classList.remove("drag-over"));
    dragListAtPoint(event.clientX, event.clientY)?.classList.add("drag-over");
    event.preventDefault();
  };

  const handlePointerDragEnd = (event) => {
    if (!pointerDrag) return;
    const drag = pointerDrag;
    document.removeEventListener("mousemove", handlePointerDragMove);
    clearPointerDrag();
    if (!drag.started) return;
    const list = dragListAtPoint(event.clientX, event.clientY);
    if (!list) return;
    const beforeKey = assetCodeRuleDropTarget(list, event.clientY)?.dataset.codeRuleField || "";
    moveAssetCodeRuleField(drag.fieldKey, list.dataset.codeRuleList, beforeKey);
  };

  pageHost.querySelectorAll("[data-code-rule-field]").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || event.target.closest("select")) return;
      pointerDrag = {
        element: button,
        fieldKey: button.dataset.codeRuleField || "",
        startX: event.clientX,
        startY: event.clientY,
        started: false,
      };
      document.addEventListener("mousemove", handlePointerDragMove);
      document.addEventListener("mouseup", handlePointerDragEnd, { once: true });
    });
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", button.dataset.codeRuleField || "");
      button.classList.add("dragging");
    });
    button.addEventListener("dragend", () => button.classList.remove("dragging"));
  });

  pageHost.querySelectorAll("[data-code-rule-list]").forEach((list) => {
    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      list.classList.add("drag-over");
    });
    list.addEventListener("dragleave", () => list.classList.remove("drag-over"));
    list.addEventListener("drop", (event) => {
      event.preventDefault();
      list.classList.remove("drag-over");
      const fieldKey = event.dataTransfer?.getData("text/plain") || "";
      const beforeKey = assetCodeRuleDropTarget(list, event.clientY)?.dataset.codeRuleField || "";
      moveAssetCodeRuleField(fieldKey, list.dataset.codeRuleList, beforeKey);
    });
  });

  pageHost.querySelector("[data-code-rule-serial]")?.addEventListener("change", (event) => {
    state.assetCodeRuleSettings = normalizeAssetCodeRuleSettings({
      ...state.assetCodeRuleSettings,
      serialLength: Number(event.target.value),
    });
    render();
  });

  pageHost.querySelectorAll("[data-code-rule-custom-text]").forEach((input) => {
    input.addEventListener("mousedown", (event) => event.stopPropagation());
    input.addEventListener("input", (event) => {
      const key = event.currentTarget.dataset.codeRuleCustomText;
      state.assetCodeRuleSettings.customTexts = {
        ...state.assetCodeRuleSettings.customTexts,
        [key]: event.currentTarget.value,
      };
      const preview = pageHost.querySelector(".asset-code-rule-preview");
      if (preview) {
        preview.innerHTML = `
          <p>规则预览：<strong>${escapeHtml(assetCodeRulePreviewText(state.assetCodeRuleSettings))}</strong></p>
          <p>当前编码规则下资产编码长度：<b>${assetCodeRuleCurrentLength(state.assetCodeRuleSettings)}位</b></p>
        `;
      }
    });
  });

  pageHost.querySelectorAll("[data-code-rule-date-format]").forEach((select) => {
    select.addEventListener("mousedown", (event) => event.stopPropagation());
    select.addEventListener("change", (event) => {
      const key = event.currentTarget.dataset.codeRuleDateFormat;
      state.assetCodeRuleSettings.dateFormats = {
        ...state.assetCodeRuleSettings.dateFormats,
        [key]: event.currentTarget.value,
      };
      render();
    });
  });

  pageHost.querySelectorAll("[data-code-rule-option]").forEach((select) => {
    select.addEventListener("mousedown", (event) => event.stopPropagation());
    select.addEventListener("change", (event) => {
      const key = event.currentTarget.dataset.codeRuleOption;
      state.assetCodeRuleSettings.fieldOptions = {
        ...state.assetCodeRuleSettings.fieldOptions,
        [key]: event.currentTarget.value,
      };
      render();
    });
  });

  pageHost.querySelector("[data-code-rule-save]")?.addEventListener("click", () => {
    state.assetCodeRuleSettings = normalizeAssetCodeRuleSettings(state.assetCodeRuleSettings);
    if (state.assetCodeRuleSettings.selectedFields.includes("customText") && !String(state.assetCodeRuleSettings.customTexts?.customText || "").trim()) {
      showToast("请输入自定义文本");
      return;
    }
    saveAssetCodeRuleSettings();
    showToast("资产编码规则已保存");
  });
}

function bindAssetLabelTemplateSettings(root = document) {
  const pageHost = root.querySelector(".asset-label-template-page");
  if (!pageHost) return;
  const form = pageHost.querySelector("[data-label-template-settings-form]");

  const refreshSettingsPanel = () => {
    if (!form) return;
    state.assetLabelSettings = readAssetLabelSettingsForm(form);
    saveAssetLabelSettings();
    const preview = pageHost.querySelector("[data-label-template-config-preview]");
    if (preview) preview.innerHTML = assetLabelTemplateConfigPreview(state.assetLabelSettings);
    const defaultPreview = pageHost.querySelector("[data-default-label-editor-preview]");
    if (defaultPreview) defaultPreview.outerHTML = defaultAssetLabelEditorPreview(state.assetLabelSettings);
    const scaleValue = pageHost.querySelector("[data-label-scale-value]");
    if (scaleValue) scaleValue.textContent = String(Math.round(state.assetLabelSettings.contentScale));
    const logoScale = assetLabelLogoScale(state.assetLabelSettings);
    const logoScaleInput = pageHost.querySelector("[data-label-logo-scale]");
    if (logoScaleInput) logoScaleInput.value = String(logoScale);
    const logoScaleValue = pageHost.querySelector("[data-label-logo-scale-value]");
    if (logoScaleValue) logoScaleValue.textContent = String(logoScale);
    pageHost.querySelectorAll("[data-label-font-value]").forEach((input) => {
      const index = Number(input.dataset.labelFontValue || 0);
      input.value = String(assetLabelFieldFontSize(state.assetLabelSettings, index));
    });
    const sizeSummary = pageHost.querySelector("[data-label-size-summary]");
    if (sizeSummary) sizeSummary.textContent = `${Math.round(state.assetLabelSettings.labelWidth)}*${Math.round(state.assetLabelSettings.labelHeight)}mm`;
  };

  pageHost.querySelectorAll("[data-label-template-card]").forEach((card) => {
    card.addEventListener("click", () => {
      const templateKey = card.dataset.labelTemplateCard;
      state.assetLabelSettings = normalizeAssetLabelSettings(assetLabelTemplateDefaults(templateKey));
      saveAssetLabelSettings();
      render();
    });
  });

  form?.querySelector("[data-label-template-select]")?.addEventListener("change", (event) => {
    state.assetLabelSettings = normalizeAssetLabelSettings(assetLabelTemplateDefaults(event.currentTarget.value));
    saveAssetLabelSettings();
    render();
  });

  form?.querySelectorAll("input, textarea, select").forEach((input) => {
    if (input.dataset.labelTemplateSelect !== undefined) return;
    input.addEventListener("input", refreshSettingsPanel);
    input.addEventListener("change", refreshSettingsPanel);
  });

  form?.querySelectorAll("[data-label-scale-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = form.querySelector("[data-label-content-scale]");
      if (!input) return;
      input.value = String(clampNumber(Number(input.value) + Number(button.dataset.labelScaleStep || 0), state.assetLabelSettings.contentScale, 50, 160));
      refreshSettingsPanel();
    });
  });

  const updateLogoScale = (nextScale) => {
    if (!form) return;
    const scale = Math.round(clampNumber(nextScale, assetLabelLogoScale(state.assetLabelSettings), 50, 160));
    const logoScaleInput = form.querySelector('[name="logoScale"]');
    if (logoScaleInput) logoScaleInput.value = String(scale);
    refreshSettingsPanel();
  };

  form?.querySelector("[data-label-logo-scale]")?.addEventListener("input", (event) => {
    updateLogoScale(Number(event.currentTarget.value));
  });

  form?.querySelectorAll("[data-label-logo-scale-step]").forEach((button) => {
    button.addEventListener("click", () => {
      updateLogoScale(assetLabelLogoScale(state.assetLabelSettings) + Number(button.dataset.labelLogoScaleStep || 0));
    });
  });

  form?.querySelectorAll("[data-label-number-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = form.querySelector(`[name="${button.dataset.labelNumberStep}"]`);
      if (!input) return;
      const step = Number(button.dataset.step || 0);
      const min = Number(input.min || -Infinity);
      const max = Number(input.max || Infinity);
      input.value = String(clampNumber(Number(input.value) + step, Number(input.value), min, max));
      refreshSettingsPanel();
    });
  });

  form?.querySelectorAll("[data-label-font-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const rowIndex = Number(button.dataset.labelFontStep || 0);
      const input = form.querySelector(`[data-label-font-value="${rowIndex}"]`);
      if (!input) return;
      const step = Number(button.dataset.step || 0);
      input.value = String(Math.round(clampNumber(Number(input.value) + step, state.assetLabelSettings.fontSize, 5, 22)));
      refreshSettingsPanel();
    });
  });

  form?.querySelector("[data-label-template-reset]")?.addEventListener("click", () => {
    state.assetLabelSettings = normalizeAssetLabelSettings(assetLabelTemplateDefaults(state.assetLabelSettings.templateKey));
    saveAssetLabelSettings();
    render();
  });

  form?.querySelector("[data-label-template-save]")?.addEventListener("click", () => {
    state.assetLabelSettings = readAssetLabelSettingsForm(form);
    saveAssetLabelSettings();
    refreshSettingsPanel();
    showToast("标签模板配置已保存");
  });

  pageHost.querySelector("[data-label-template-add]")?.addEventListener("click", () => {
    if (form) state.assetLabelSettings = readAssetLabelSettingsForm(form);
    const template = createAssetLabelCustomTemplate(state.assetLabelSettings);
    render();
    showToast(`已新增模板：${template.name}`);
  });

  pageHost.querySelector("[data-label-template-delete]")?.addEventListener("click", (event) => {
    const templateKey = event.currentTarget.dataset.labelTemplateDelete;
    const template = assetLabelTemplateByKey(templateKey);
    if (!template.custom) return;
    if (!window.confirm(`确定删除“${template.name}”吗？`)) return;
    const removed = deleteAssetLabelCustomTemplate(templateKey);
    if (!removed) return;
    render();
    showToast(`已删除模板：${removed.name}`);
  });
  pageHost.querySelectorAll("[data-label-logo-upload]").forEach((drop) => {
    const fileInput = drop.querySelector("[data-label-logo-file]");
    drop.addEventListener("click", () => fileInput?.click());
    drop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput?.click();
      }
    });
    fileInput?.addEventListener("click", (event) => event.stopPropagation());
    fileInput?.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        showToast("请选择图片文件");
        fileInput.value = "";
        return;
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const logoInput = form?.querySelector('[name="logoImage"]');
        const showLogoInput = form?.querySelector('[name="showLogo"]');
        const logoTextInput = form?.querySelector('[name="logoText"]');
        if (logoInput) logoInput.value = String(reader.result || "");
        if (showLogoInput) {
          if (showLogoInput.type === "checkbox") showLogoInput.checked = true;
          showLogoInput.value = "on";
        }
        if (logoTextInput && !logoTextInput.value.trim()) logoTextInput.value = file.name.replace(/\.[^.]+$/, "").slice(0, 12);
        refreshSettingsPanel();
        fileInput.value = "";
        render();
        showToast("Logo 已上传");
      });
      reader.readAsDataURL(file);
    });
  });
}

function locationCodeForName(name, index = 0) {
  const codeMap = {
    杭州公司: "access",
    封存仓库: "FC",
    "19幢1楼": "19-1",
    "19幢2楼": "19-2",
    "19幢3楼": "19-3",
    "19幢4楼": "19-4",
    "19幢5楼": "19-5",
    "19幢6楼": "19-6",
    "11幢6楼": "11-6",
    下沙龙湖天街: "LHTJ",
    宁波仓库: "CK",
    东南亚: "NTX",
    马来西亚: "0-1",
    新加坡: "0-2",
  };
  const fallbackIndex = Number.isFinite(index) ? index + 1 : flattenLocationTree().length + 1;
  return codeMap[name] || `LOC-${String(fallbackIndex).padStart(2, "0")}`;
}

function buildLocationSettingRows() {
  return flattenLocationTree().map((node) => ({
    ...node,
    code: node.code || locationCodeForName(node.name, node.index),
    parent: node.parentName,
  }));
}

function filteredLocationSettingRows(query = state.locationSettingsQuery) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return buildLocationSettingRows();
  return buildLocationSettingRows().filter((row) =>
    [row.name, row.code, row.parent, row.path].some((value) => String(value || "").toLowerCase().includes(keyword))
  );
}

function renderLocationSettingTree() {
  const renderNodes = (nodes, level = 0) =>
    nodes
      .map((node) => {
        const hasChildren = Boolean(node.children?.length);
        const open = state.locationTreeOpen[node.id] === true;
        return `<div class="location-tree-group ${open ? "open" : ""}" style="--tree-level:${level}">
        <button class="location-tree-node" type="button" ${hasChildren ? `data-location-tree-toggle="${escapeHtml(node.id)}" aria-expanded="${open ? "true" : "false"}"` : `data-location-focus="${escapeHtml(node.id)}"`}>
          <span class="location-tree-caret" aria-hidden="true"></span>
          <span>${escapeHtml(node.name)}</span>
        </button>
        ${hasChildren ? `<div class="location-tree-children" ${open ? "" : "hidden"}>${renderNodes(node.children || [], level + 1)}</div>` : ""}
      </div>`;
      })
      .join("");
  return renderNodes(assetLocationTree);
}

function renderAssetCodeSwitch(enabled) {
  return `<span class="asset-code-switch ${enabled ? "on" : "off"}"><span>${enabled ? "开" : "关"}</span><i aria-hidden="true"></i></span>`;
}

function renderAssetCodeSwitchButton(row) {
  return `<button class="asset-code-switch-button" type="button" data-location-toggle-code="${escapeHtml(row.id)}" aria-pressed="${row.enabled ? "true" : "false"}">${renderAssetCodeSwitch(row.enabled)}</button>`;
}

function filteredAssetCategoryRows(query = state.assetCategorySettingsQuery) {
  const keyword = query.trim().toLowerCase();
  const rows = flattenAssetCategoryTree();
  if (!keyword) return rows;
  return rows.filter((row) =>
    [row.code, row.name, row.parentName, row.usefulLife, row.unit, row.path].some((value) => String(value || "").toLowerCase().includes(keyword))
  );
}

function renderAssetCategoryTree() {
  const renderNodes = (nodes, level = 0) =>
    nodes
      .map((node) => {
        const hasChildren = Boolean(node.children?.length);
        const open = state.assetCategoryTreeOpen[node.id] === true;
        return `<div class="location-tree-group asset-category-tree-group ${open ? "open" : ""}" style="--tree-level:${level}">
        <button class="location-tree-node asset-category-tree-node" type="button" ${hasChildren ? `data-category-tree-toggle="${escapeHtml(node.id)}" aria-expanded="${open ? "true" : "false"}"` : `data-category-focus="${escapeHtml(node.id)}"`}>
          <span class="location-tree-caret" aria-hidden="true"></span>
          <span>${escapeHtml(node.name)}</span>
        </button>
        ${hasChildren ? `<div class="location-tree-children asset-category-tree-children" ${open ? "" : "hidden"}>${renderNodes(node.children || [], level + 1)}</div>` : ""}
      </div>`;
      })
      .join("");
  return renderNodes(assetCategoryTree);
}

function renderAssetCategorySwitchButton(row) {
  return `<button class="asset-code-switch-button" type="button" data-category-toggle-code="${escapeHtml(row.id)}" aria-pressed="${row.enabled ? "true" : "false"}">${renderAssetCodeSwitch(row.enabled)}</button>`;
}

function renderAssetCategoryRows(rows) {
  return rows.length
    ? rows
        .map(
          (row) => `<tr>
                    <td data-category-row="${escapeHtml(row.id)}">${escapeHtml(row.code)}</td>
                    <td>${escapeHtml(row.name)}</td>
                    <td>${escapeHtml(row.parentName)}</td>
                    <td>${escapeHtml(row.usefulLife)}</td>
                    <td>${escapeHtml(row.unit)}</td>
                    <td>${renderAssetCategorySwitchButton(row)}</td>
                    <td><button class="link" type="button" data-category-edit="${escapeHtml(row.id)}">编辑</button><span class="action-separator">|</span><button class="link" type="button" data-category-delete="${escapeHtml(row.id)}">删除</button></td>
                  </tr>`
        )
        .join("")
    : `<tr><td colspan="7" class="empty-cell">暂无匹配分类</td></tr>`;
}

function toggleAssetCategoryTreeGroup(id) {
  state.assetCategoryTreeOpen = {
    ...state.assetCategoryTreeOpen,
    [id]: state.assetCategoryTreeOpen[id] === false,
  };
  render();
}

function toggleAssetCategoryCodeEnabled(id) {
  const found = findAssetCategoryNodeById(id);
  if (!found) return;
  found.node.enabled = !found.node.enabled;
  saveAssetCategoryTree();
  refreshAssetCategorySettingTable();
}

function assetCategoryParentOptions(selected = "", editingId = "") {
  const editingNode = editingId ? findAssetCategoryNodeById(editingId)?.node : null;
  const blockedIds = new Set([editingId, ...flattenAssetCategoryTree(editingNode?.children || []).map((node) => node.id)].filter(Boolean));
  return [
    `<option value="" ${selected ? "" : "selected"}>暂无上级</option>`,
    ...flattenAssetCategoryTree()
      .filter((node) => !blockedIds.has(node.id))
      .map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === selected ? "selected" : ""}>${escapeHtml(`${"　".repeat(node.level)}${node.name}`)}</option>`),
  ].join("");
}

function assetCategoryFormMarkup(category = null) {
  const found = category ? findAssetCategoryNodeById(category.id) : null;
  const parentId = found?.parent?.id || "";
  const enabled = category?.enabled !== false;
  return `<form id="demoForm" class="location-form asset-category-form" data-mode="${category ? "category-edit" : "category-create"}" data-category-id="${escapeHtml(category?.id || "")}">
    <div class="location-form-body">
      <label class="location-form-row">
        <span><em>*</em> 分类编码：</span>
        <input name="categoryCode" required placeholder="请输入" value="${escapeHtml(category?.code || "")}" autocomplete="off">
      </label>
      <label class="location-form-row">
        <span><em>*</em> 分类名称：</span>
        <input name="categoryName" required placeholder="请输入" value="${escapeHtml(category?.name || "")}" autocomplete="off">
      </label>
      <label class="location-form-row">
        <span>上级分类：</span>
        <select name="parentId">${assetCategoryParentOptions(parentId, category?.id || "")}</select>
      </label>
      <label class="location-form-row">
        <span>使用期限：</span>
        <input name="usefulLife" type="number" min="0" step="1" placeholder="请输入" value="${escapeHtml(category?.usefulLife || "0")}" autocomplete="off">
      </label>
      <label class="location-form-row">
        <span>计量单位：</span>
        <input name="unit" placeholder="请输入" value="${escapeHtml(category?.unit || "台")}" autocomplete="off">
      </label>
      <div class="location-form-row location-form-switch-row">
        <span>资产编码开关：</span>
        <input type="hidden" name="enabled" value="${enabled ? "true" : "false"}" data-location-enabled-input>
        <button class="location-switch ${enabled ? "on" : ""}" type="button" data-location-enabled-toggle aria-pressed="${enabled ? "true" : "false"}">
          <strong>${enabled ? "开" : "关"}</strong>
          <b aria-hidden="true"></b>
        </button>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">确定</button>
    </div>
  </form>`;
}

function openAssetCategoryModal(id = "") {
  const category = id ? findAssetCategoryNodeById(id)?.node : null;
  modalTitle.textContent = category ? "编辑分类" : "新增分类";
  modal.classList.add("location-modal");
  modal.classList.remove("asset-create-modal", "asset-flow-modal", "asset-import-modal", "print-preview-modal", "asset-label-print-modal");
  modalBody.innerHTML = assetCategoryFormMarkup(category);
  openModal();
}

function insertAssetCategoryNode(node, parentId = "") {
  if (!parentId) {
    assetCategoryTree.push(node);
    return true;
  }
  const parent = findAssetCategoryNodeById(parentId)?.node;
  if (!parent) return false;
  parent.children = parent.children || [];
  parent.children.push(node);
  state.assetCategoryTreeOpen[parent.id] = true;
  return true;
}

function removeAssetCategoryNodeById(id, tree = assetCategoryTree) {
  const index = tree.findIndex((node) => node.id === id);
  if (index >= 0) return tree.splice(index, 1)[0];
  for (const node of tree) {
    const removed = removeAssetCategoryNodeById(id, node.children || []);
    if (removed) return removed;
  }
  return null;
}

function commitAssetCategoryForm(form) {
  const code = formValue(form, "categoryCode");
  const name = formValue(form, "categoryName");
  const parentId = formValue(form, "parentId");
  const usefulLife = formValue(form, "usefulLife");
  const unit = formValue(form, "unit");
  const enabled = formValue(form, "enabled") !== "false";
  if (!code || !name) {
    showToast("请填写分类编码和分类名称");
    return false;
  }

  const editingId = form.dataset.categoryId || "";
  const duplicate = flattenAssetCategoryTree().find((row) => row.code === code && row.id !== editingId);
  if (duplicate) {
    showToast(`分类编码已被“${duplicate.name}”使用`);
    return false;
  }
  const duplicateName = flattenAssetCategoryTree().find((row) => row.name === name && row.id !== editingId);
  if (duplicateName) {
    showToast(`分类名称已存在：${name}`);
    return false;
  }

  if (editingId) {
    const found = findAssetCategoryNodeById(editingId);
    if (!found) return false;
    const beforeRows = descendantCategoryRows(found.node);
    Object.assign(found.node, { code, name, usefulLife, unit, enabled });
    if ((found.parent?.id || "") !== parentId) {
      const moved = removeAssetCategoryNodeById(editingId);
      if (!insertAssetCategoryNode(moved, parentId)) assetCategoryTree.push(moved);
    }
    const afterNode = findAssetCategoryNodeById(editingId)?.node;
    const afterRows = descendantCategoryRows(afterNode);
    updateAssetCategoryReferenceMap(new Map(beforeRows.map((row, index) => [row.name, afterRows[index]?.name]).filter(([, nextName]) => Boolean(nextName))));
  } else {
    insertAssetCategoryNode({ id: createAssetCategoryId(), code, name, usefulLife, unit, enabled, children: [] }, parentId);
  }
  saveAssetCategoryTree();
  return true;
}

function deleteAssetCategory(id) {
  const found = findAssetCategoryNodeById(id);
  if (!found) return;
  const deletedNodes = descendantCategoryRows(found.node);
  const referenced = assetReferencesCategoryNames(deletedNodes.map((node) => node.name));
  if (referenced.length) {
    showToast(`已有 ${referenced.length} 个资产使用该分类，不能删除`);
    return;
  }
  const childCount = deletedNodes.length - 1;
  const confirmed = window.confirm(`确定删除“${found.node.name}”吗？${childCount ? `这会同时删除 ${childCount} 个下级分类。` : ""}`);
  if (!confirmed) return;
  removeAssetCategoryNodeById(id);
  saveAssetCategoryTree();
  render();
  showToast("分类已删除");
}

function focusAssetCategoryRow(id) {
  const cell = document.querySelector(`[data-category-row="${cssEscape(id)}"]`);
  const row = cell?.closest("tr");
  if (!row) return;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.add("location-row-flash");
  setTimeout(() => row.classList.remove("location-row-flash"), 1200);
}

function refreshAssetCategorySettingTable() {
  const rows = filteredAssetCategoryRows();
  const pagination = paginateRows(rows, "assetCategory");
  const tbody = document.querySelector("[data-category-table-body]");
  const paginationHost = document.querySelector("[data-category-pagination-host]");
  if (tbody) tbody.innerHTML = renderAssetCategoryRows(pagination.rows);
  if (paginationHost) paginationHost.innerHTML = renderPagination(pagination, "assetCategory");
  bindPaginationEvents(paginationHost || document);
}

function handleAssetCategoryTableClick(event) {
  const edit = event.target.closest("[data-category-edit]");
  if (edit) {
    openAssetCategoryModal(edit.dataset.categoryEdit);
    return;
  }
  const remove = event.target.closest("[data-category-delete]");
  if (remove) {
    deleteAssetCategory(remove.dataset.categoryDelete);
    return;
  }
  const toggle = event.target.closest("[data-category-toggle-code]");
  if (toggle) {
    toggleAssetCategoryCodeEnabled(toggle.dataset.categoryToggleCode);
  }
}

function renderAssetCategorySettings(activeSection) {
  const rows = filteredAssetCategoryRows();
  const pagination = paginateRows(rows, "assetCategory");
  return `
    <section class="location-settings-shell asset-category-settings-shell">
      <aside class="location-settings-tree-panel asset-category-tree-panel">
        <h2>分类</h2>
        <label class="location-search">
          <input type="search" placeholder="模糊搜索" value="${escapeHtml(state.assetCategorySettingsQuery)}" data-category-search>
          <span aria-hidden="true">⌕</span>
        </label>
        <div class="location-tree-list asset-category-tree-list">
          ${renderAssetCategoryTree()}
        </div>
      </aside>
      <article class="location-settings-table-panel asset-category-table-panel" data-category-settings-panel>
        <div class="location-settings-toolbar asset-category-toolbar">
          <div class="asset-list-actions">
            <button class="table-action primary" type="button" data-category-create>＋ 新增分类</button>
            <div class="table-action-menu location-import-export-menu">
              <button class="table-action has-caret" type="button">导入/导出<span class="action-caret" aria-hidden="true"></span></button>
              <div class="table-dropdown wide">
                <button type="button" data-category-workbook-action="template">下载模板</button>
                <button type="button" data-category-workbook-action="import">导入分类</button>
                <button type="button" data-category-workbook-action="export">导出分类</button>
              </div>
            </div>
          </div>
        </div>
        <div class="location-table-wrap asset-category-table-wrap">
          <table class="location-settings-table asset-category-settings-table">
            <colgroup>
              <col class="category-col-code">
              <col class="category-col-name">
              <col class="category-col-parent">
              <col class="category-col-life">
              <col class="category-col-unit">
              <col class="category-col-switch">
              <col class="category-col-actions">
            </colgroup>
            <thead>
              <tr>
                <th>分类编码</th>
                <th>分类名称</th>
                <th>上级分类</th>
                <th>使用期限</th>
                <th>计量单位</th>
                <th>资产编码开关 ⓘ</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody data-category-table-body>
              ${renderAssetCategoryRows(pagination.rows)}
            </tbody>
          </table>
        </div>
        <div data-category-pagination-host>
          ${renderPagination(pagination, "assetCategory")}
        </div>
      </article>
    </section>`;
}

function renderLocationSettingTableRows(rows) {
  return rows.length
    ? rows
        .map(
          (row) => `<tr>
                    <td data-location-row="${escapeHtml(row.id)}">${escapeHtml(row.name)}</td>
                    <td>${escapeHtml(row.code)}</td>
                    <td>${escapeHtml(row.parent)}</td>
                    <td>${renderAssetCodeSwitchButton(row)}</td>
                    <td><button class="link" type="button" data-location-edit="${escapeHtml(row.id)}">编辑</button><span class="action-separator">|</span><button class="link" type="button" data-location-delete="${escapeHtml(row.id)}">删除</button></td>
                  </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="empty-cell">暂无匹配位置</td></tr>`;
}

function toggleLocationTreeGroup(id) {
  state.locationTreeOpen = {
    ...state.locationTreeOpen,
    [id]: state.locationTreeOpen[id] !== true,
  };
  render();
}

function locationImportExportDropdown() {
  return `<div class="table-action-menu location-import-export-menu">
    <button class="table-action has-caret" type="button">导入/导出<span class="action-caret" aria-hidden="true"></span></button>
    <div class="table-dropdown wide">
      <button type="button" data-location-workbook-action="template">下载模板</button>
      <button type="button" data-location-workbook-action="import">导入位置</button>
      <button type="button" data-location-workbook-action="export">导出位置</button>
    </div>
  </div>`;
}

function renderAssetLocationSettings(activeSection) {
  const rows = filteredLocationSettingRows();
  return `
    <section class="location-settings-shell">
      <aside class="location-settings-tree-panel">
        <h2>位置</h2>
        <label class="location-search">
          <input type="search" placeholder="模糊查询" value="${escapeHtml(state.locationSettingsQuery)}" data-location-search>
          <span aria-hidden="true">⌕</span>
        </label>
        <div class="location-tree-list">
          ${renderLocationSettingTree()}
        </div>
      </aside>
      <article class="location-settings-table-panel" data-location-settings-panel>
        <div class="location-settings-toolbar">
          <div class="asset-list-actions">
            <button class="table-action primary" type="button" data-location-create>＋ 新增位置</button>
            ${locationImportExportDropdown()}
          </div>
        </div>
        <input type="file" accept=".xlsx" data-location-import-file hidden>
        <div class="location-table-wrap">
          <table class="location-settings-table">
            <colgroup>
              <col class="location-col-name">
              <col class="location-col-code">
              <col class="location-col-parent">
              <col class="location-col-switch">
              <col class="location-col-actions">
            </colgroup>
            <thead>
              <tr>
                <th>位置名称</th>
                <th>位置编码</th>
                <th>上级位置</th>
                <th>资产编码开关</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody data-location-table-body>
              ${renderLocationSettingTableRows(rows)}
            </tbody>
          </table>
        </div>
        <div class="asset-list-pagination location-settings-pagination">
          <span data-location-result-count>共 ${rows.length} 条</span>
          <button class="page-btn" type="button" disabled aria-label="上一页">‹</button>
          <button class="page-btn active" type="button" aria-current="page">1</button>
          <button class="page-btn" type="button" disabled aria-label="下一页">›</button>
          <select aria-label="每页条数"><option>20 条/页</option></select>
        </div>
      </article>
    </section>`;
}

function locationParentOptions(selected = "", editingId = "") {
  const editingNode = editingId ? findLocationNodeById(editingId)?.node : null;
  const blockedIds = new Set([editingId, ...flattenLocationTree(editingNode?.children || []).map((node) => node.id)].filter(Boolean));
  return [
    `<option value="" ${selected ? "" : "selected"}>暂无上级</option>`,
    ...flattenLocationTree()
      .filter((node) => !blockedIds.has(node.id))
      .map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === selected ? "selected" : ""}>${escapeHtml(`${"　".repeat(node.level)}${node.path}`)}</option>`),
  ].join("");
}

function locationFormMarkup(location = null) {
  const parentId = location ? findLocationNodeById(location.id)?.parent?.id || "" : "";
  const enabled = location?.enabled !== false;
  return `<form id="demoForm" class="location-form" data-mode="${location ? "location-edit" : "location-create"}" data-location-id="${escapeHtml(location?.id || "")}">
    <div class="location-form-body">
      <label class="location-form-row">
        <span><em>*</em> 位置名称：</span>
        <input name="locationName" required placeholder="请输入" value="${escapeHtml(location?.name || "")}" autocomplete="off">
      </label>
      <label class="location-form-row">
        <span>上级位置：</span>
        <select name="parentId">${locationParentOptions(parentId, location?.id || "")}</select>
      </label>
      <label class="location-form-row">
        <span>位置编码：</span>
        <input name="locationCode" placeholder="请输入" value="${escapeHtml(location?.code || "")}" autocomplete="off">
      </label>
      <div class="location-form-row location-form-switch-row">
        <span>资产编码开关：</span>
        <input type="hidden" name="enabled" value="${enabled ? "true" : "false"}" data-location-enabled-input>
        <button class="location-switch ${enabled ? "on" : ""}" type="button" data-location-enabled-toggle aria-pressed="${enabled ? "true" : "false"}">
          <strong>${enabled ? "开" : "关"}</strong>
          <b aria-hidden="true"></b>
        </button>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">确定</button>
    </div>
  </form>`;
}

function openLocationModal(id = "") {
  const location = id ? findLocationNodeById(id)?.node : null;
  modalTitle.textContent = location ? "编辑位置" : "新增位置";
  modal.classList.add("location-modal");
  modal.classList.remove("asset-create-modal");
  modal.classList.remove("asset-flow-modal");
  modal.classList.remove("asset-import-modal");
  modal.classList.remove("print-preview-modal");
  modal.classList.remove("asset-label-print-modal");
  modalBody.innerHTML = locationFormMarkup(location);
  openModal();
}

function commitLocationForm(form) {
  const name = formValue(form, "locationName");
  const code = formValue(form, "locationCode") || locationCodeForName(name);
  const parentId = formValue(form, "parentId");
  const enabled = formValue(form, "enabled") !== "false";
  if (!name) {
    showToast("请填写位置名称");
    return false;
  }

  const editingId = form.dataset.locationId || "";
  let beforeRows = [];
  if (editingId) {
    const found = findLocationNodeById(editingId);
    if (!found) return false;
    const node = found.node;
    beforeRows = descendantLocationRows(node, found.parent ? locationPathById(found.parent.id).split(" / ").filter(Boolean) : []);
    Object.assign(node, { name, code, enabled });
    if ((found.parent?.id || "") !== parentId) {
      const moved = removeLocationNodeById(editingId);
      if (!insertLocationNode(moved, parentId)) {
        assetLocationTree.push(moved);
      }
    }
  } else {
    const node = { id: createLocationId(), name, code, enabled, children: [] };
    insertLocationNode(node, parentId);
  }

  refreshAssetLocationOptions();
  if (editingId) {
    const afterNode = findLocationNodeById(editingId)?.node;
    const afterRows = descendantLocationRows(afterNode, locationParentPathById(editingId));
    updateAssetLocationReferenceMap(new Map(beforeRows.map((row, index) => [row.path, afterRows[index]?.path]).filter(([, nextPath]) => Boolean(nextPath))));
  }
  saveAssetLocationTree();
  return true;
}

function deleteLocation(id) {
  const found = findLocationNodeById(id);
  if (!found) return;
  const deletedNodes = descendantLocationRows(found.node, found.parent ? locationPathById(found.parent.id).split(" / ").filter(Boolean) : []);
  const referenced = assetReferencesLocationPaths(deletedNodes.map((node) => node.path));
  if (referenced.length) {
    showToast(`已有 ${referenced.length} 个资产使用该位置，不能删除`);
    return;
  }
  const childCount = deletedNodes.length - 1;
  const confirmed = window.confirm(`确定删除“${found.node.name}”吗？${childCount ? `这会同时删除 ${childCount} 个下级位置。` : ""}`);
  if (!confirmed) return;
  removeLocationNodeById(id);
  refreshAssetLocationOptions();
  saveAssetLocationTree();
  render();
  showToast("位置已删除");
}

function toggleLocationCodeEnabled(id) {
  const found = findLocationNodeById(id);
  if (!found) return;
  found.node.enabled = !found.node.enabled;
  saveAssetLocationTree();
  render();
}

function focusLocationRow(id) {
  const cell = document.querySelector(`[data-location-row="${cssEscape(id)}"]`);
  const row = cell?.closest("tr");
  if (!row) return;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.add("location-row-flash");
  setTimeout(() => row.classList.remove("location-row-flash"), 1200);
}

function refreshLocationSettingTable() {
  const rows = filteredLocationSettingRows();
  const tbody = document.querySelector("[data-location-table-body]");
  const count = document.querySelector("[data-location-result-count]");
  if (tbody) tbody.innerHTML = renderLocationSettingTableRows(rows);
  if (count) count.textContent = `共 ${rows.length} 条`;
}

function handleLocationTableClick(event) {
  const edit = event.target.closest("[data-location-edit]");
  if (edit) {
    openLocationModal(edit.dataset.locationEdit);
    return;
  }
  const remove = event.target.closest("[data-location-delete]");
  if (remove) {
    deleteLocation(remove.dataset.locationDelete);
    return;
  }
  const toggle = event.target.closest("[data-location-toggle-code]");
  if (toggle) {
    toggleLocationCodeEnabled(toggle.dataset.locationToggleCode);
  }
}

function bindLocationFormControls(root = modal) {
  const button = root.querySelector("[data-location-enabled-toggle]");
  const input = root.querySelector("[data-location-enabled-input]");
  if (!button || !input) return;
  button.addEventListener("click", () => {
    const enabled = button.getAttribute("aria-pressed") !== "true";
    input.value = enabled ? "true" : "false";
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.classList.toggle("on", enabled);
    button.querySelector("strong").textContent = enabled ? "开" : "关";
  });
}

function assetKpi(label, value, note) {
  return `<div class="asset-kpi"><div class="detail-label">${label}</div><strong>${value}</strong><div class="panel-subtitle">${note}</div></div>`;
}

function assetToolbar(rows) {
  const filters = state.assetFilters;
  return `<div class="toolbar advanced-toolbar">
    <input class="local-search" type="search" placeholder="编号/名称/型号/责任人/标签" value="${escapeHtml(state.query)}">
    <select data-select-filter="status">${optionList(uniqueAssetValues("status", rows), filters.status)}</select>
    <select data-select-filter="location">${locationOptionList(filters.location, { includeAll: true })}</select>
    <select data-select-filter="risk">${optionList(uniqueAssetValues("risk", rows), filters.risk)}</select>
    <button class="btn primary" data-search>查询</button>
    <button class="btn" data-reset>重置</button>
  </div>`;
}

function riskBadge(risk) {
  const color = risk === "正常" ? "green" : risk === "故障" ? "red" : "amber";
  return `<span class="tag ${color}">${risk}</span>`;
}

function completeness(value) {
  const color = value >= 90 ? "green" : value >= 80 ? "amber" : "red";
  return `<div class="complete"><span>${value}%</span><i><b class="${color}" style="width:${value}%"></b></i></div>`;
}

function employeeRequestActionIcon(kind) {
  const icons = {
    receive: `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M11 5h10v10H11V5Z" fill="#ffffff" opacity=".94"/>
      <path d="M13.5 5v6l2.5-1.7 2.5 1.7V5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M5.7 20.4h6.8l3 3h6.1c2.8 0 4.8-1.4 5.9-3.7" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4.5 24.9h7.8" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/>
    </svg>`,
    borrow: `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M17 6h9v9h-9V6Z" fill="#ffffff" opacity=".94"/>
      <path d="M7 17h8v8H7v-8Z" fill="#ffffff" opacity=".94"/>
      <path d="M10.8 8.4a7 7 0 0 0-4.2 6.4m14.6 8.8a7 7 0 0 0 4.2-6.4" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/>
      <path d="m7.1 10.5 3.8-2.2.7 4.4M24.9 21.5l-3.8 2.2-.7-4.4" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    giveBack: `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M8 6h16v18H8V6Z" fill="#ffffff" opacity=".95"/>
      <path d="M11.5 11h9M11.5 16h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M16 25.5V15.8m0 9.7-4-4m4 4 4-4" fill="none" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    returnAsset: `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M8 7h17v18H8V7Z" fill="#ffffff" opacity=".95"/>
      <path d="M13 13h8M13 18h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M20.2 22.4h-6.5a4.2 4.2 0 1 1 0-8.4h.7" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/>
      <path d="m13.8 10.9-3.2 3.2 3.2 3.2" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    handover: `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="13" cy="10.5" r="4.2" fill="#ffffff" opacity=".95"/>
      <path d="M5.8 25c1.1-5 4-7.7 7.2-7.7s6.1 2.7 7.2 7.7H5.8Z" fill="#ffffff" opacity=".95"/>
      <circle cx="22.4" cy="12.2" r="3" fill="none" stroke="#ffffff" stroke-width="2.3"/>
      <path d="M25.8 17.2a8 8 0 0 1 3.1 5.2M26.4 9.2l2.5-2.5m0 0v4.1m0-4.1h-4.1" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  };
  return icons[kind] || icons.receive;
}

function renderEmployeeRequestAction(item) {
  return `<button class="employee-request-action" type="button" data-open-request="${escapeHtml(item.request)}">
    <span class="employee-request-action-icon ${item.tone}">${employeeRequestActionIcon(item.icon)}</span>
    <span class="employee-request-action-label">${escapeHtml(item.label)}</span>
  </button>`;
}

function employeeRequestStatusGroup(status = "") {
  if (["审批中", "待审批", "待审核", "待处理"].includes(status)) return "pending";
  if (["已完成", "已同意", "已通过", "同意", "通过"].includes(status)) return "approved";
  if (["已驳回", "驳回", "已拒绝", "拒绝"].includes(status)) return "rejected";
  return "pending";
}

function employeeRequestTabs(rows) {
  return [
    { key: "all", label: "全部", count: rows.length },
    { key: "pending", label: "待审批", count: rows.filter((item) => employeeRequestStatusGroup(item.status) === "pending").length },
    { key: "approved", label: "已同意", count: rows.filter((item) => employeeRequestStatusGroup(item.status) === "approved").length },
    { key: "rejected", label: "已驳回", count: rows.filter((item) => employeeRequestStatusGroup(item.status) === "rejected").length },
  ];
}

function renderEmployeeRequestTabs(tabs, activeTab) {
  return `<div class="employee-request-tabs" role="tablist" aria-label="我的申请状态">
    ${tabs
      .map(
        (tab) => `<button class="${activeTab === tab.key ? "active" : ""}" type="button" role="tab" aria-selected="${activeTab === tab.key ? "true" : "false"}" data-employee-request-tab="${tab.key}">
          ${tab.label} (${tab.count})
        </button>`
      )
      .join("")}
  </div>`;
}

function employeeRequestCardStatus(item) {
  const group = employeeRequestStatusGroup(item.status);
  if (group === "approved") return { label: "自动同意", tone: "approved" };
  if (group === "rejected") return { label: "已驳回", tone: "rejected" };
  return { label: item.status || "待审批", tone: "pending" };
}

function renderEmployeeRequestCard(item) {
  const status = employeeRequestCardStatus(item);
  return `<article class="employee-request-card">
    <div class="employee-request-card-main">
      <div class="employee-request-card-title">
        <span class="employee-request-status-pill ${status.tone}">${escapeHtml(status.label)}</span>
        <strong>${escapeHtml(item.type)}</strong>
      </div>
      <div class="employee-request-card-fields">
        <div><span>单据编号</span><strong>${escapeHtml(item.id)}</strong></div>
        <div><span>发起时间</span><strong>${escapeHtml(item.date || "-")}</strong></div>
        <div><span>审批时间</span><strong>${employeeRequestStatusGroup(item.status) === "pending" ? "-" : escapeHtml(item.date || "-")}</strong></div>
        <div><span>资产数量</span><strong>-</strong></div>
      </div>
    </div>
    <button class="btn employee-request-detail" type="button" data-request="${escapeHtml(item.id)}">查看详情</button>
  </article>`;
}

function renderRequests() {
  if (state.currentUser?.roleCode !== "employee") {
    return `<section class="panel approval-blank-panel" aria-label="审批"></section>`;
  }

  const actions = [
    { label: "自助资产领用", request: "资产领用", icon: "receive", tone: "blue" },
    { label: "自助资产借用", request: "资产借用", icon: "borrow", tone: "sky" },
    { label: "自助资产归还", request: "资产归还", icon: "giveBack", tone: "orange" },
    { label: "自助资产退还", request: "资产退还", icon: "returnAsset", tone: "violet" },
    { label: "自助资产交接", request: "资产交接", icon: "handover", tone: "green" },
  ];
  const rows = getScopedRequests();
  const tabs = employeeRequestTabs(rows);
  const activeTab = tabs.some((tab) => tab.key === state.employeeRequestTab) ? state.employeeRequestTab : "all";
  const visibleRows = activeTab === "all" ? rows : rows.filter((item) => employeeRequestStatusGroup(item.status) === activeTab);

  return `<section class="employee-request-page">
    <section class="employee-request-head" aria-label="员工申请">
      <h1 class="employee-request-title">员工申请</h1>
      <div class="employee-request-actions-grid">
        ${actions.map(renderEmployeeRequestAction).join("")}
      </div>
    </section>
    <section class="employee-request-history" aria-label="我的申请">
      <div class="employee-request-list-head">
        ${renderEmployeeRequestTabs(tabs, activeTab)}
        <button class="employee-request-advanced" type="button" data-employee-request-advanced>高级搜索</button>
      </div>
      <div class="employee-request-card-list">
        ${
          visibleRows.length
            ? visibleRows
                .map(renderEmployeeRequestCard)
                .join("")
            : `<div class="employee-request-empty">当前分类下还没有可展示的申请。</div>`
        }
      </div>
    </section>
  </section>`;
}

function renderStocktake() {
  const rows = getScopedStocktakes();
  return `
    ${pageHeader("资产盘点", "支持普通管理员扫码盘点、员工自助盘点、照片水印和盘盈盘亏处理。", "新建盘点", "stocktake")}
    <section class="panel">
      ${toolbar(["盘点任务名称", "状态", "负责人"])}
      <div class="table-wrap">
        <table>
          <thead><tr><th>任务编号</th><th>盘点任务</th><th>范围</th><th>负责人</th><th>进度</th><th>差异</th><th>计划日期</th><th>操作</th></tr></thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map((item) => {
                      const percent = Math.round((item.checked / item.total) * 100);
                      return `<tr>
                        <td>${item.id}</td><td>${item.name}</td><td>${item.scope}</td><td>${item.owner}</td>
                        <td>${statusTag(item.progress)} <div class="panel-subtitle">${item.checked}/${item.total} · ${percent}%</div></td>
                        <td>${item.diff}</td><td>${item.date}</td><td><button class="btn" data-stocktake="${item.id}">查看明细</button></td>
                      </tr>`;
                    })
                    .join("")
                : `<tr class="empty-row"><td colspan="8">当前角色没有可查看的盘点任务。</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderConsumables() {
  const rows = state.consumables;
  return `
    ${pageHeader("耗材库存", "低值耗材不进入固定资产台账，但需要入库、领用、退库、调拨和库存预警。", "耗材入库", "consumable")}
    <section class="panel">
      ${toolbar(["耗材名称/型号", "仓库", "库存状态"])}
      <div class="table-wrap">
        <table>
          <thead><tr><th>耗材名称</th><th>型号</th><th>当前库存</th><th>最小库存</th><th>仓库</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${rows
              .map(
                ([name, model, stock, min, warehouse]) => `<tr>
                  <td>${name}</td><td>${model}</td><td>${stock}</td><td>${min}</td><td>${warehouse}</td>
                  <td>${stock < min ? statusTag("待执行") : statusTag("在用")}</td>
                  <td><button class="btn" data-open-request="耗材领用">领取</button> <button class="btn" data-open-request="耗材入库">入库</button></td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderRepair() {
  const failures = getScopedFailures();
  const subtitle =
    state.currentUser?.roleCode === "employee"
      ? "员工只能查看本人相关报修记录，提交后由普通管理员继续处理。"
      : "员工和管理员均可报修，普通管理员处理后形成维修记录并回写资产履历。";
  return `
    ${pageHeader("故障维修", subtitle, "新建报修", "repair")}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>关联资产</th><th>故障描述</th><th>上报人</th><th>状态</th><th>处理人</th><th>操作</th></tr></thead>
          <tbody>
            ${
              failures.length
                ? failures
                    .map(
                      (item) =>
                        `<tr><td>${item.name}</td><td>屏幕闪烁，影响办公</td><td>${item.owner}</td><td>${statusTag("维修中")}</td><td>普通管理员</td><td><button class="btn" data-detail="${item.id}">${state.currentUser?.roleCode === "employee" ? "查看" : "处理"}</button></td></tr>`
                    )
                    .join("")
                : `<tr class="empty-row"><td colspan="6">当前范围内没有维修工单。</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderContracts() {
  return `
    ${pageHeader("合同供应商", "供应商、合同、采购订单和资产入库关联，支撑采购到入库闭环。", "新增合同", "contract")}
    <section class="grid stats-grid">
      ${["京东供应商", "阿里供应商", "微软代理商", "泛微OA服务商"]
        .map(
          (name, index) => `<article class="stat-card" data-watermark="SP">
            <div class="stat-top"><span>${name}</span>${statusTag(index === 3 ? "待执行" : "在用")}</div>
            <div class="stat-value">${index + 2}</div>
            <div class="stat-note">关联合同 / 采购订单 / 入库单</div>
          </article>`
        )
        .join("")}
    </section>`;
}

function roleFormFromRole(role) {
  return {
    id: role?.id || "",
    name: role?.name || "",
    type: role?.type || "admin",
    description: role?.description || "",
    permissions: [...(role?.permissions || ["employee:view", "asset:view"])],
  };
}

function currentRoleForm() {
  if (state.roleForm && !state.roleForm.id && !state.selectedRoleId) {
    return state.roleForm;
  }
  const selected = state.roles.find((role) => role.id === state.selectedRoleId) || state.roles[0];
  if (!state.selectedRoleId && selected) {
    state.selectedRoleId = selected.id;
  }
  if (!state.roleForm || state.roleForm.id !== (selected?.id || "")) {
    state.roleForm = roleFormFromRole(selected);
  }
  return state.roleForm;
}

function filteredRoleDefinitions() {
  const keyword = state.roleQuery.trim().toLowerCase();
  return state.roles.filter((role) => {
    if (state.roleTab === "system" && role.type === "employee") return false;
    if (state.roleTab === "employee" && role.type !== "employee") return false;
    if (!keyword) return true;
    return [role.name, role.description, role.id].some((value) => String(value || "").toLowerCase().includes(keyword));
  });
}

function rolePermissionSummary(role) {
  const permissions = role.permissions || [];
  return rolePermissionModules
    .map((module) => {
      const actions = module.actions
        .filter(([action]) => permissions.includes(`${module.code}:${action}`))
        .map(([, label]) => label);
      return actions.length ? `${module.name}：${actions.join("、")}` : "";
    })
    .filter(Boolean)
    .join("；");
}

function roleAssignedUsers(role) {
  if (!role) return [];
  return state.users.filter((user) => {
    if (user.roleDefinitionId) return user.roleDefinitionId === role.id;
    if (role.id === user.roleCode) return true;
    return user.roleDefinitionId === role.id;
  });
}

function roleListItemMarkup(role) {
  const editable = !role.builtIn;
  return `<div class="role-list-item ${role.id === state.selectedRoleId ? "active" : ""}">
    <button class="role-list-main" type="button" data-role-select="${escapeHtml(role.id)}" aria-label="查看${escapeHtml(role.name)}">
      <span class="role-name">${escapeHtml(role.name)}</span>
    </button>
    ${
      editable
        ? `<span class="role-row-actions">
            <button class="role-edit-icon" type="button" data-role-edit="${escapeHtml(role.id)}" title="编辑${escapeHtml(role.name)}" aria-label="编辑${escapeHtml(role.name)}">✎</button>
          </span>`
        : ""
    }
  </div>`;
}

function rolePermissionGroups() {
  return [
    {
      id: "system",
      name: "系统",
      modules: rolePermissionModules.filter((module) =>
        ["employee", "department", "role", "selfService", "integration", "form"].includes(module.code)
      ),
    },
    {
      id: "asset",
      name: "资产",
      modules: rolePermissionModules.filter((module) => ["asset", "stocktake", "consumable"].includes(module.code)),
    },
    {
      id: "approval",
      name: "审批",
      modules: rolePermissionModules.filter((module) => ["request"].includes(module.code)),
    },
  ].filter((group) => group.modules.length);
}

function roleModuleCodes(module) {
  return module.actions.map(([action]) => `${module.code}:${action}`);
}

function roleGroupCodes(group) {
  return group.modules.flatMap(roleModuleCodes);
}

function roleCheckedCount(codes, permissions) {
  return codes.filter((code) => permissions.has(code)).length;
}

function rolePermissionSelection(form = state.roleForm) {
  const groups = rolePermissionGroups();
  const permissions = new Set(form?.permissions || []);
  let group = groups.find((item) => item.id === state.rolePermissionGroup);
  if (!group) {
    group = groups.find((item) => roleGroupCodes(item).some((code) => permissions.has(code))) || groups[0];
  }
  let module = group?.modules.find((item) => item.code === state.rolePermissionModule);
  if (!module) {
    module = group?.modules.find((item) => roleModuleCodes(item).some((code) => permissions.has(code))) || group?.modules[0];
  }
  state.rolePermissionGroup = group?.id || "";
  state.rolePermissionModule = module?.code || "";
  return { groups, group, module, permissions };
}

function resetRolePermissionSelection(form = state.roleForm) {
  state.rolePermissionGroup = "";
  state.rolePermissionModule = "";
  rolePermissionSelection(form);
}

function rolePermissionCascadeMarkup(form, disabled) {
  const { groups, group: activeGroup, module: activeModule, permissions } = rolePermissionSelection(form);
  const allCodes = groups.flatMap(roleGroupCodes);
  const allChecked = roleCheckedCount(allCodes, permissions);
  const groupCodes = activeGroup ? roleGroupCodes(activeGroup) : [];
  const groupChecked = roleCheckedCount(groupCodes, permissions);
  const moduleCodes = activeModule ? roleModuleCodes(activeModule) : [];
  const moduleChecked = roleCheckedCount(moduleCodes, permissions);

  return `<div class="role-permission-cascade" data-role-permission-cascade>
    <section class="role-permission-column">
      <div class="role-permission-column-head">
        <label><input type="checkbox" data-role-all-permissions ${allChecked === allCodes.length ? "checked" : ""} ${disabled}> 全选</label>
        <strong>角色授权</strong>
      </div>
      <div class="role-permission-column-list">
        ${groups
          .map((group) => {
            const codes = roleGroupCodes(group);
            const checkedCount = roleCheckedCount(codes, permissions);
            return `<div class="role-permission-row ${group.id === activeGroup?.id ? "active" : ""}" data-role-permission-group="${escapeHtml(group.id)}">
              <input type="checkbox" aria-label="${escapeHtml(group.name)}全选" data-role-group-check="${escapeHtml(group.id)}" ${checkedCount === codes.length ? "checked" : ""} ${disabled}>
              <span class="role-permission-row-name">${escapeHtml(group.name)}</span>
              <em data-role-group-count="${escapeHtml(group.id)}">(${checkedCount}/${codes.length})</em>
              <b aria-hidden="true">&rsaquo;</b>
            </div>`;
          })
          .join("")}
      </div>
    </section>

    <section class="role-permission-column">
      <div class="role-permission-column-head">
        <label><input type="checkbox" data-role-active-group-check ${groupChecked === groupCodes.length ? "checked" : ""} ${disabled}> 全选</label>
        <strong data-role-active-group-title>${escapeHtml(activeGroup?.name || "-")}</strong>
      </div>
      <div class="role-permission-column-list">
        ${groups
          .flatMap((group) =>
            group.modules.map((module) => {
              const codes = roleModuleCodes(module);
              const checkedCount = roleCheckedCount(codes, permissions);
              return `<div class="role-permission-row ${module.code === activeModule?.code ? "active" : ""}" data-role-module-row="${escapeHtml(module.code)}" data-role-module-group="${escapeHtml(group.id)}" ${group.id === activeGroup?.id ? "" : "hidden"}>
                <input type="checkbox" aria-label="${escapeHtml(module.name)}全选" data-role-module="${escapeHtml(module.code)}" ${checkedCount === codes.length ? "checked" : ""} ${disabled}>
                <span class="role-permission-row-name">${escapeHtml(module.name)}</span>
                <em data-role-module-count="${escapeHtml(module.code)}">(${checkedCount}/${codes.length})</em>
                <b aria-hidden="true">&rsaquo;</b>
              </div>`;
            })
          )
          .join("")}
      </div>
    </section>

    <section class="role-permission-column">
      <div class="role-permission-column-head">
        <label><input type="checkbox" data-role-active-module-check ${moduleChecked === moduleCodes.length ? "checked" : ""} ${disabled}> 全选</label>
        <strong data-role-active-module-title>${escapeHtml(activeModule?.name || "-")}</strong>
      </div>
      <div class="role-permission-column-list">
        ${groups
          .flatMap((group) =>
            group.modules.map((module) => `<div class="role-permission-action-panel" data-role-action-panel="${escapeHtml(module.code)}" ${module.code === activeModule?.code ? "" : "hidden"}>
              ${module.actions
                .map(([action, label]) => {
                  const code = `${module.code}:${action}`;
                  return `<label class="role-permission-action ${permissions.has(code) ? "checked" : ""}">
                    <input type="checkbox" data-role-permission="${escapeHtml(code)}" ${permissions.has(code) ? "checked" : ""} ${disabled}>
                    <span>${escapeHtml(label)}</span>
                  </label>`;
                })
                .join("")}
            </div>`)
          )
          .join("")}
      </div>
    </section>
  </div>`;
}

function roleConfigFormMarkup(form, options = {}) {
  const readonly = Boolean(options.readonly);
  const permissionsExpanded = Boolean(options.permissionsExpanded);
  const disabled = readonly ? "disabled" : "";
  return `<form id="demoForm" class="role-config-form" data-mode="role-definition">
    <div class="role-modal-fields">
      <div class="role-error" data-role-form-error ${state.roleError ? "" : "hidden"}>${escapeHtml(state.roleError || "")}</div>
      <input type="hidden" data-role-field="type" value="${escapeHtml(form.type || "admin")}">
      <label class="role-modal-field required">
        <span>角色名称：</span>
        <input data-role-field="name" value="${escapeHtml(form.name)}" placeholder="请输入" ${disabled}>
      </label>
      <label class="role-modal-field">
        <span>描述：</span>
        <input data-role-field="description" value="${escapeHtml(form.description)}" placeholder="请输入" ${disabled}>
      </label>
    </div>

    <details class="role-permission-section" ${permissionsExpanded ? "open" : ""}>
      <summary>
        <span>权限配置</span>
        <em>${form.permissions.length} / ${allRolePermissionCodes().length}</em>
      </summary>
      ${rolePermissionCascadeMarkup(form, disabled)}
    </details>

    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      ${!readonly && form.id ? `<button type="button" class="btn role-delete-modal ${state.pendingRoleDeleteId === form.id ? "confirming" : ""}" data-role-delete="${escapeHtml(form.id)}">${state.pendingRoleDeleteId === form.id ? "确认删除" : "删除角色"}</button>` : ""}
      ${readonly ? "" : `<button type="submit" class="btn primary">${form.id ? "保存角色" : "新增角色"}</button>`}
    </div>
  </form>`;
}

function openRoleDefinitionModal(roleId = "") {
  const role = roleId ? state.roles.find((item) => item.id === roleId) : null;
  state.selectedRoleId = role?.id || "";
  state.pendingRoleDeleteId = "";
  state.roleError = "";
  state.roleForm = role
    ? roleFormFromRole(role)
    : {
        id: "",
        name: "",
        type: "admin",
        description: "",
        permissions: ["employee:view", "asset:view"],
      };
  resetRolePermissionSelection(state.roleForm);
  modalTitle.textContent = role ? "编辑角色" : "新增角色";
  modal.classList.add("role-modal");
  modal.classList.remove("asset-create-modal", "asset-flow-modal", "asset-import-modal", "print-preview-modal", "asset-label-print-modal", "location-modal", "profile-center-modal");
  modalBody.innerHTML = roleConfigFormMarkup(state.roleForm, {
    readonly: Boolean(role?.builtIn),
    permissionsExpanded: Boolean(role),
  });
  openModal();
  refreshRoleModuleState(modal);
}

function filteredRoleUsers(role) {
  const keyword = state.roleUserQuery.trim().toLowerCase();
  const users = roleAssignedUsers(role).filter((user) => user.roleCode !== "employee" || role?.type === "employee");
  if (!keyword) return users;
  return users.filter((user) =>
    [user.account, user.name, user.department, user.phone, user.email, user.roleName].some((value) =>
      String(value || "").toLowerCase().includes(keyword)
    )
  );
}

function roleUserRowsMarkup(users) {
  if (!users.length) {
    return `<tr class="empty-row"><td colspan="8">当前暂无账号绑定该角色。</td></tr>`;
  }
  return users
    .map(
      (user) => `<tr>
        <td><input type="checkbox" aria-label="选择${escapeHtml(user.account)}"></td>
        <td>${escapeHtml(user.account)}</td>
        <td>${escapeHtml(user.name)}</td>
        <td>${escapeHtml(user.department || "-")}</td>
        <td>${escapeHtml(user.company || "默认公司")}</td>
        <td>${escapeHtml(user.phone || "-")}</td>
        <td>${statusTag(user.bindStatus || "已绑定")}</td>
        <td>
          <button class="role-table-link" type="button" data-role-user-action="edit" data-account="${escapeHtml(user.account)}">编辑</button>
          <button class="role-table-link" type="button" data-role-user-action="reset" data-account="${escapeHtml(user.account)}">重置密码</button>
          <button class="role-table-link danger" type="button" data-role-user-action="delete" data-account="${escapeHtml(user.account)}">删除</button>
        </td>
      </tr>`
    )
    .join("");
}

function roleEmployeeCandidates() {
  return state.users.filter((user) => user.roleCode === "employee");
}

function roleEmployeeOptionLabel(user) {
  return [user.name, user.account, user.department].filter(Boolean).join(" / ");
}

function roleUserFormMarkup(role) {
  return `<form id="demoForm" class="role-user-form" data-mode="role-user">
    <div class="role-user-fields">
      <label class="role-user-field required"><span>账号：</span><input name="account" placeholder="请输入" required autocomplete="off"></label>
      <label class="role-user-field required"><span>密码：</span><input name="password" type="password" placeholder="请输入" required autocomplete="new-password"></label>
      <label class="role-user-field required"><span>确认密码：</span><input name="confirmPassword" type="password" placeholder="请输入" required autocomplete="new-password"></label>
      <label class="role-user-field">
        <span>关联员工：</span>
        <div class="role-user-lookup">
          <input name="employeeKeyword" placeholder="模糊搜索" autocomplete="off">
          <span class="role-user-lookup-icon" aria-hidden="true"></span>
        </div>
      </label>
    </div>
    <input type="hidden" name="roleId" value="${escapeHtml(role?.id || "admin")}">
    <div class="modal-actions role-user-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">新增管理员</button>
    </div>
  </form>`;
}

function roleUserEditFormMarkup(user) {
  return `<form id="demoForm" class="role-user-form" data-mode="role-user-edit">
    <div class="role-user-fields">
      <label class="role-user-field"><span>账号：</span><input name="account" value="${escapeHtml(user.account)}" disabled></label>
      <label class="role-user-field required"><span>姓名：</span><input name="name" value="${escapeHtml(user.name)}" placeholder="请输入" required autocomplete="off"></label>
      <label class="role-user-field"><span>手机号：</span><input name="phone" value="${escapeHtml(user.phone || "")}" placeholder="请输入" autocomplete="off"></label>
      <label class="role-user-field"><span>邮箱：</span><input name="email" value="${escapeHtml(user.email || "")}" placeholder="请输入" autocomplete="off"></label>
      <label class="role-user-field"><span>所属部门：</span><input name="department" value="${escapeHtml(user.department || "")}" placeholder="请输入" autocomplete="off"></label>
      <label class="role-user-field"><span>状态：</span><input name="bindStatus" value="${escapeHtml(user.bindStatus || "已绑定")}" placeholder="请输入" autocomplete="off"></label>
    </div>
    <input type="hidden" name="accountKey" value="${escapeHtml(user.account)}">
    <div class="modal-actions role-user-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">保存</button>
    </div>
  </form>`;
}

function roleUserResetPasswordMarkup(user) {
  return `<form id="demoForm" class="role-user-form role-user-reset-form" data-mode="role-user-reset-password">
    <div class="role-user-fields">
      <label class="role-user-field"><span>账号：</span><input value="${escapeHtml(user.account)}" disabled></label>
      <label class="role-user-field required"><span>新密码：</span><input name="password" type="password" placeholder="请输入" required autocomplete="new-password"></label>
      <label class="role-user-field required"><span>确认密码：</span><input name="confirmPassword" type="password" placeholder="请输入" required autocomplete="new-password"></label>
    </div>
    <input type="hidden" name="accountKey" value="${escapeHtml(user.account)}">
    <div class="modal-actions role-user-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">确定</button>
    </div>
  </form>`;
}

function openRoleUserModal() {
  const currentRole = state.roles.find((role) => role.id === state.selectedRoleId);
  const selectedRole = currentRole || state.roles.find((role) => role.id === "admin") || state.roles.find((role) => role.type === "admin") || state.roles[0];
  modalTitle.textContent = "新增管理员";
  modal.classList.add("role-modal", "role-user-modal");
  modal.classList.remove("asset-create-modal", "asset-flow-modal", "asset-import-modal", "print-preview-modal", "asset-label-print-modal", "location-modal", "profile-center-modal");
  modalBody.innerHTML = roleUserFormMarkup(selectedRole);
  openModal();
}

function openRoleUserActionModal(account, action) {
  const user = state.users.find((item) => item.account === account);
  if (!user) {
    showToast("未找到管理员账号");
    return;
  }
  if (action === "delete") {
    deleteRoleUser(account);
    return;
  }
  modalTitle.textContent = action === "reset" ? "重置密码" : "编辑管理员";
  modal.classList.add("role-modal", "role-user-modal");
  modal.classList.remove("asset-create-modal", "asset-flow-modal", "asset-import-modal", "print-preview-modal", "asset-label-print-modal", "location-modal", "profile-center-modal");
  modalBody.innerHTML = action === "reset" ? roleUserResetPasswordMarkup(user) : roleUserEditFormMarkup(user);
  openModal();
}

function deleteRoleUser(account) {
  const user = state.users.find((item) => item.account === account);
  if (!user) {
    showToast("未找到管理员账号");
    return;
  }
  if (user.account === state.currentUser?.account) {
    showToast("不能删除当前登录账号");
    return;
  }
  if (user.roleCode === "employee") {
    showToast("员工账号请到员工信息中维护");
    return;
  }
  const confirmed = window.confirm(`确定删除管理员账号“${user.account}”吗？`);
  if (!confirmed) return;
  state.users = state.users.filter((item) => item.account !== account);
  if (!["本地注册", "角色管理新增"].includes(user.identitySource)) {
    state.deletedRoleUserAccounts = Array.from(new Set([...(state.deletedRoleUserAccounts || []), account]));
    saveDeletedRoleUsers();
  }
  saveRegisteredUsers();
  render();
  showToast("管理员已删除");
}

function findRoleEmployee(keyword) {
  const normalized = String(keyword || "").trim().toLowerCase();
  if (!normalized) return { user: null, ambiguous: false };
  const candidates = roleEmployeeCandidates();
  const exact = candidates.find((user) =>
    [roleEmployeeOptionLabel(user), user.account, user.name, user.phone, user.email].some((value) => String(value || "").trim().toLowerCase() === normalized)
  );
  if (exact) return { user: exact, ambiguous: false };
  const matches = candidates.filter((user) =>
    [roleEmployeeOptionLabel(user), user.account, user.name, user.phone, user.email, user.department].some((value) =>
      String(value || "").toLowerCase().includes(normalized)
    )
  );
  return { user: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
}

function saveRoleUserFromForm(form) {
  const data = new FormData(form);
  const roleId = String(data.get("roleId") || "admin");
  const role = state.roles.find((item) => item.id === roleId) || state.roles.find((item) => item.id === "admin");
  const accountInput = String(data.get("account") || "").trim();
  const password = String(data.get("password") || "");
  const confirmPassword = String(data.get("confirmPassword") || "");
  const employeeKeyword = String(data.get("employeeKeyword") || "").trim();
  if (!accountInput || !password || !confirmPassword) {
    showToast("请填写账号、密码和确认密码");
    return false;
  }
  if (password.length < 6) {
    showToast("密码至少 6 位");
    return false;
  }
  if (password !== confirmPassword) {
    showToast("两次密码不一致");
    return false;
  }
  const employeeResult = employeeKeyword ? findRoleEmployee(employeeKeyword) : { user: null, ambiguous: false };
  if (employeeKeyword && !employeeResult.user) {
    showToast(employeeResult.ambiguous ? "请从搜索结果中选择一个员工" : "未找到关联员工");
    return false;
  }
  const employee = employeeResult.user;
  const account = createUserIdFragment(accountInput);
  if (state.users.some((user) => user.account === account)) {
    showToast("账号已存在");
    return false;
  }
  state.users.push({
    name: employee?.name || account,
    account,
    password,
    phone: employee?.phone || "",
    email: employee?.email || "",
    department: employee?.department || "默认部门",
    company: employee?.company || "默认公司",
    roleCode: role?.type === "employee" ? "employee" : role?.type === "super_admin" ? "super_admin" : "admin",
    roleName: role?.name || "普通管理员",
    roleDefinitionId: role?.id || "admin",
    scope: role?.description || role?.scope || "按角色授权",
    loginType: "超级管理员分配账号",
    identitySource: "角色管理新增",
    externalSubject: `assigned:${account}`,
    linkedEmployeeAccount: employee?.account || "",
    bindStatus: employee ? "已绑定" : "未关联员工",
  });
  state.selectedRoleId = role?.id || "admin";
  saveRegisteredUsers();
  return true;
}

function saveRoleUserEditForm(form) {
  const data = new FormData(form);
  const account = String(data.get("accountKey") || "").trim();
  const user = state.users.find((item) => item.account === account);
  if (!user) {
    showToast("未找到管理员账号");
    return false;
  }
  const name = String(data.get("name") || "").trim();
  if (!name) {
    showToast("请填写姓名");
    return false;
  }
  user.name = name;
  user.phone = String(data.get("phone") || "").trim();
  user.email = String(data.get("email") || "").trim();
  user.department = String(data.get("department") || "").trim() || "默认部门";
  user.bindStatus = String(data.get("bindStatus") || "").trim() || "已绑定";
  saveRegisteredUsers();
  return true;
}

function saveRoleUserResetPasswordForm(form) {
  const data = new FormData(form);
  const account = String(data.get("accountKey") || "").trim();
  const user = state.users.find((item) => item.account === account);
  if (!user) {
    showToast("未找到管理员账号");
    return false;
  }
  const password = String(data.get("password") || "");
  const confirmPassword = String(data.get("confirmPassword") || "");
  if (password.length < 6) {
    showToast("密码至少 6 位");
    return false;
  }
  if (password !== confirmPassword) {
    showToast("两次密码不一致");
    return false;
  }
  user.password = password;
  saveRegisteredUsers();
  return true;
}

function renderRoleManagement() {
  const roles = filteredRoleDefinitions();
  const selectedRole = roles.find((role) => role.id === state.selectedRoleId) || roles.find((role) => role.id === "admin") || roles[0] || state.roles[0];
  if (selectedRole && state.selectedRoleId !== selectedRole.id) state.selectedRoleId = selectedRole.id;
  const assignedUsers = filteredRoleUsers(selectedRole);

  return `<div class="system-content role-management">
    <aside class="role-side-panel">
      <div class="role-side-head">
        <h2>角色管理</h2>
        <span class="role-pill">超级管理员</span>
      </div>
      <div class="role-tabs">
        <button class="role-tab ${state.roleTab === "system" ? "active" : ""}" type="button" data-role-tab="system">系统角色</button>
        <button class="role-tab ${state.roleTab === "employee" ? "active" : ""}" type="button" data-role-tab="employee">员工角色</button>
      </div>
      <label class="role-search">
        <input type="search" placeholder="请输入关键字" value="${escapeHtml(state.roleQueryDraft ?? state.roleQuery)}" data-role-search>
        <button type="button" aria-label="搜索角色" data-role-search-submit>⌕</button>
      </label>
      <div class="role-list-title">
        <span>新增角色</span>
        <button class="role-inline-add" data-role-create title="新增角色" aria-label="新增角色">＋</button>
      </div>
      <div class="role-list">
        ${
          roles.length
            ? roles.map(roleListItemMarkup).join("")
            : `<div class="empty-note">没有匹配的角色。</div>`
        }
      </div>
    </aside>

    <section class="role-detail-panel">
      <div class="role-table-toolbar">
        <div class="role-toolbar-actions">
          <button class="btn primary" data-role-user-create>＋ 新增管理员</button>
        </div>
        <label class="role-main-search">
          <input type="search" placeholder="模糊查询" value="${escapeHtml(state.roleUserQueryDraft ?? state.roleUserQuery)}" data-role-user-search>
          <button type="button" aria-label="搜索" data-role-user-search-submit>⌕</button>
        </label>
      </div>
      <div class="table-wrap role-account-table">
        <table>
          <thead><tr><th><input type="checkbox" aria-label="全选账号"></th><th>账号</th><th>姓名</th><th>所在部门</th><th>所属公司</th><th>手机号</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>${roleUserRowsMarkup(assignedUsers)}</tbody>
        </table>
      </div>
    </section>
  </div>`;
}

function renderSystemPlaceholder(title, description) {
  return `<div class="system-content">
    <section class="panel system-placeholder">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${escapeHtml(title)}</h2>
          <div class="panel-subtitle">${escapeHtml(description)}</div>
        </div>
      </div>
      <p class="empty-note">该模块内容正在整理中，当前已优先补齐角色管理配置。</p>
    </section>
  </div>`;
}

function renderSelfServiceManagement() {
  const signChildren = selfServiceSignChildren();
  const signActive = state.selfServiceMenu === "签字设置" || signChildren.includes(state.selfServiceMenu);
  const signOpen = state.selfServiceSignOpen || signChildren.includes(state.selfServiceMenu);
  return `<div class="system-content self-service-management">
    <aside class="self-service-panel">
      <div class="self-service-heading">
        <h2>自助管理</h2>
      </div>
      <div class="self-service-rule" aria-hidden="true"></div>
      <div class="self-service-list">
        <button class="self-service-item ${state.selfServiceMenu === "员工自助管理" ? "active" : ""}" type="button" data-self-service-menu="员工自助管理">
          <span>员工自助管理</span>
        </button>
        <div class="self-service-group ${signOpen ? "open" : ""}">
          <button class="self-service-item self-service-parent ${signActive ? "active" : ""}" type="button" data-self-service-toggle="签字设置" aria-expanded="${signOpen ? "true" : "false"}">
            <span>签字设置</span>
            <span class="self-service-caret" aria-hidden="true"></span>
          </button>
          <div class="self-service-children" aria-hidden="${signOpen ? "false" : "true"}">
            ${signChildren
              .map(
                (child) => `<button class="self-service-child ${state.selfServiceMenu === child ? "active" : ""}" type="button" data-self-service-menu="${escapeHtml(child)}">
                  ${escapeHtml(child)}
                </button>`
              )
              .join("")}
          </div>
        </div>
      </div>
    </aside>
    ${renderSelfServiceContent()}
  </div>`;
}

function selfServiceSignChildren() {
  return selfServiceSignPages().map((page) => page.menu);
}

function renderSelfServiceContent() {
  if (state.selfServiceMenu === "员工自助管理") return renderSelfServiceMainSettings();
  if (selfServiceSignChildren().includes(state.selfServiceMenu)) return renderSelfServiceSignSettings();
  return `<section class="panel self-service-placeholder" data-self-service-content>
    <h2>${escapeHtml(state.selfServiceMenu)}</h2>
    <p class="empty-note">该子栏目用于配置签字确认范围，内容后续补充。</p>
  </section>`;
}

function currentSelfServiceSignPage() {
  return selfServiceSignPages().find((page) => page.menu === state.selfServiceMenu) || selfServiceSignPages()[0];
}

function renderSelfServiceSignSettings() {
  const page = currentSelfServiceSignPage();
  return `<section class="panel self-service-sign-panel" data-self-service-content>
    <form class="self-service-sign-form" data-self-service-sign-form>
      <div class="self-service-sign-list">
        ${page.items.map(renderSelfServiceSignBlock).join("")}
      </div>
      <div class="self-service-config-actions">
        <button class="btn primary" type="submit">保存</button>
      </div>
    </form>
  </section>`;
}

function renderSelfServiceSignBlock(item) {
  const settings = state.selfServiceSettings.signSettings?.[item.key] || normalizeSelfServiceSignItemSettings({}, item);
  const timingOptions = item.timingOptions || [];
  const timingControls = timingOptions
    .map((option) => {
      const checked = Boolean(settings.timings?.[option.key]);
      return `<label class="self-service-sign-check">
        <input type="checkbox" name="${escapeHtml(item.key)}Timing_${escapeHtml(option.key)}" data-self-service-sign-field="${escapeHtml(item.key)}:timing:${escapeHtml(option.key)}" ${checked ? "checked" : ""} ${option.disabled ? "disabled" : ""}>
        <span>${escapeHtml(option.label)}</span>
      </label>`;
    })
    .join("");
  const directSignControl = timingControls
    ? ""
    : `<label class="self-service-sign-check primary">
        <input type="checkbox" name="${escapeHtml(item.key)}EmployeeSign" data-self-service-sign-field="${escapeHtml(item.key)}:employeeSign" ${settings.employeeSign ? "checked" : ""}>
        <span>启用</span>
      </label>`;
  const noticeContent = String(settings.noticeContent || "").slice(0, selfServiceNoticeContentLimit);
  return `<section class="self-service-sign-block" data-self-service-sign-block="${escapeHtml(item.key)}">
    <div class="self-service-sign-title">
      <h2>${escapeHtml(item.title)} <button class="self-service-help" type="button" aria-label="${escapeHtml(item.help)}" data-help-text="${escapeHtml(item.help)}">i</button></h2>
    </div>
    <div class="self-service-sign-row">
      <div class="self-service-sign-label">员工签字</div>
      ${directSignControl}
      ${timingControls ? `<div class="self-service-sign-inline">${timingControls}</div>` : ""}
    </div>
    <div class="self-service-sign-row">
      <div class="self-service-sign-label">展示须知内容</div>
      <label class="self-service-sign-check">
        <input type="checkbox" name="${escapeHtml(item.key)}NoticeEnabled" data-self-service-sign-field="${escapeHtml(item.key)}:noticeEnabled" ${settings.noticeEnabled ? "checked" : ""}>
        <span>${escapeHtml(item.noticeLabel || "须知内容")}</span>
      </label>
    </div>
    <div class="self-service-sign-row textarea-row">
      <label class="self-service-sign-label" for="${escapeHtml(item.key)}NoticeContent">须知内容</label>
      <div class="self-service-textarea-wrap self-service-notice-wrap">
        <textarea id="${escapeHtml(item.key)}NoticeContent" name="${escapeHtml(item.key)}NoticeContent" maxlength="${selfServiceNoticeContentLimit}" rows="3" placeholder="请输入${escapeHtml(item.noticeLabel || "须知内容")}" data-self-service-notice="${escapeHtml(item.key)}">${escapeHtml(noticeContent)}</textarea>
        <div class="self-service-char-count"><span data-self-service-notice-count="${escapeHtml(item.key)}">${noticeContent.length}</span> / ${selfServiceNoticeContentLimit}</div>
      </div>
    </div>
  </section>`;
}

const selfServiceSettingItems = [
  {
    key: "receiveAsset",
    title: "自助资产领用",
    help: "员工可发起系统内空闲资产的领用，并可限制员工发起领用的资产分类。",
    enableLabel: "启用自助资产领用",
    categoryLabel: "自助申请资产类别",
    hasCategories: true,
  },
  {
    key: "returnAsset",
    title: "自助资产退还",
    help: "员工可选择名下领用资产进行退还。",
    enableLabel: "启用自助资产退还",
    hasCategories: false,
  },
  {
    key: "borrowAsset",
    title: "自助资产借用",
    help: "员工可发起系统内空闲资产的借用，并可限制员工发起借用的资产分类。",
    enableLabel: "启用自助资产借用",
    categoryLabel: "自助申请资产类别",
    hasCategories: true,
  },
  {
    key: "giveBackAsset",
    title: "自助归还",
    help: "员工可选择名下借用资产进行归还。",
    enableLabel: "启用自助归还",
    hasCategories: false,
  },
  {
    key: "handoverAsset",
    title: "自助资产交接",
    help: "员工可自行交接名下资产。",
    enableLabel: "启用自助资产交接",
    hasCategories: false,
  },
  {
    key: "deviceRequest",
    title: "办公设备申领",
    help: "当员工需要申请一台设备，但是系统内没有满足条件的设备时可发起申领。",
    enableLabel: "启用办公设备申领",
    hasCategories: false,
    extraSwitches: [
      {
        key: "allowEmployeeAddDevice",
        label: "允许员工添加设备",
        ariaLabel: "办公设备申领允许员工添加设备",
        defaultValue: true,
      },
    ],
  },
];

function selfServiceSettingMeta(key) {
  return selfServiceSettingItems.find((item) => item.key === key) || selfServiceSettingItems[0];
}

function selfServiceCategoryChips(itemKey, settings) {
  const expanded = Boolean(state.selfServiceCategoryExpanded?.[itemKey]);
  const limit = expanded ? settings.categories.length : 10;
  const visible = settings.categories.slice(0, limit);
  const hiddenCount = Math.max(0, settings.categories.length - visible.length);
  const chips = visible
    .map(
      (name) => `<span class="self-service-category-chip">
        ${escapeHtml(name)}
        <button type="button" data-self-service-remove-category="${escapeHtml(name)}" data-self-service-item="${escapeHtml(itemKey)}" aria-label="移除${escapeHtml(name)}">×</button>
      </span>`
    )
    .join("");
  return `${chips}${hiddenCount ? `<button class="self-service-category-chip more" type="button" data-self-service-expand-categories="${escapeHtml(itemKey)}">+ ${hiddenCount} ...</button>` : ""}`;
}

function renderSelfServiceMainSettings() {
  return `<section class="panel self-service-config-panel" data-self-service-content>
    <form class="self-service-config-form" data-self-service-form>
      <div class="self-service-config-list">
        ${selfServiceSettingItems.map(renderSelfServiceSettingBlock).join("")}
      </div>
      <div class="self-service-config-actions">
        <button class="btn primary" type="submit">保存</button>
      </div>
    </form>
  </section>`;
}

function renderSelfServiceSettingBlock(meta) {
  const settings = state.selfServiceSettings[meta.key];
  const categoryRow = meta.hasCategories
    ? `<div class="self-service-config-row category-row">
          <label>${escapeHtml(meta.categoryLabel || "自助申请资产类别")}</label>
          <div class="self-service-category-box" data-self-service-category-box>
            ${selfServiceCategoryChips(meta.key, settings)}
          </div>
        </div>`
    : "";
  const extraSwitchRows = (meta.extraSwitches || [])
    .map((item) => {
      const switchId = `${meta.key}${item.key.charAt(0).toUpperCase()}${item.key.slice(1)}`;
      const checked = settings[item.key] === undefined ? Boolean(item.defaultValue) : Boolean(settings[item.key]);
      return `<div class="self-service-config-row compact">
          <label for="${escapeHtml(switchId)}">${escapeHtml(item.label)}</label>
          <button class="self-service-switch ${checked ? "on" : ""}" type="button" data-self-service-switch="${escapeHtml(item.key)}" data-self-service-item="${escapeHtml(meta.key)}" role="switch" aria-checked="${checked ? "true" : "false"}" aria-label="${escapeHtml(item.ariaLabel || item.label)}">
            <span></span>
          </button>
          <input id="${escapeHtml(switchId)}" name="${escapeHtml(switchId)}" type="hidden" value="${checked ? "true" : "false"}">
        </div>`;
    })
    .join("");
  return `<div class="self-service-config-block" data-self-service-block="${escapeHtml(meta.key)}">
      <div class="self-service-config-title">
        <h2>${escapeHtml(meta.title)} <button class="self-service-help" type="button" aria-label="${escapeHtml(meta.help)}" data-help-text="${escapeHtml(meta.help)}">i</button></h2>
      </div>
      <div class="self-service-config-rule" aria-hidden="true"></div>
      <div class="self-service-config-rows">
        <div class="self-service-config-row compact">
          <label for="${escapeHtml(meta.key)}Enabled">启用</label>
          <button class="self-service-switch ${settings.enabled ? "on" : ""}" type="button" data-self-service-switch="enabled" data-self-service-item="${escapeHtml(meta.key)}" role="switch" aria-checked="${settings.enabled ? "true" : "false"}" aria-label="${escapeHtml(meta.enableLabel)}">
            <span></span>
          </button>
          <input id="${escapeHtml(meta.key)}Enabled" name="${escapeHtml(meta.key)}Enabled" type="hidden" value="${settings.enabled ? "true" : "false"}">
        </div>
        ${categoryRow}
        ${extraSwitchRows}
        <div class="self-service-config-row compact">
          <label for="${escapeHtml(meta.key)}RemarkRequired">备注必填</label>
          <button class="self-service-switch ${settings.remarkRequired ? "on" : ""}" type="button" data-self-service-switch="remarkRequired" data-self-service-item="${escapeHtml(meta.key)}" role="switch" aria-checked="${settings.remarkRequired ? "true" : "false"}" aria-label="${escapeHtml(meta.title)}备注必填">
            <span></span>
          </button>
          <input id="${escapeHtml(meta.key)}RemarkRequired" name="${escapeHtml(meta.key)}RemarkRequired" type="hidden" value="${settings.remarkRequired ? "true" : "false"}">
        </div>
        <div class="self-service-config-row textarea-row">
          <label for="${escapeHtml(meta.key)}RemarkPrompt">备注提示语</label>
          <div class="self-service-textarea-wrap">
            <textarea id="${escapeHtml(meta.key)}RemarkPrompt" name="${escapeHtml(meta.key)}RemarkPrompt" maxlength="300" rows="3" placeholder="请输入提示语" data-self-service-remark="${escapeHtml(meta.key)}">${escapeHtml(settings.remarkPrompt)}</textarea>
            <div class="self-service-char-count"><span data-self-service-remark-count="${escapeHtml(meta.key)}">${settings.remarkPrompt.length}</span> / 300</div>
          </div>
        </div>
      </div>
    </div>`;
}

function setSelfServiceMenu(menu) {
  state.selfServiceMenu = menu || "员工自助管理";
  if (selfServiceSignChildren().includes(state.selfServiceMenu)) state.selfServiceSignOpen = true;
  refreshSelfServiceManagement();
}

function toggleSelfServiceSignGroup() {
  state.selfServiceSignOpen = !state.selfServiceSignOpen;
  refreshSelfServiceManagement();
}

function toggleSelfServiceReceiveSetting(key) {
  const [itemKey, fieldKey] = key.split(":");
  const meta = selfServiceSettingMeta(itemKey);
  const allowedFields = ["enabled", "remarkRequired", ...(meta.extraSwitches || []).map((item) => item.key)];
  if (!state.selfServiceSettings[itemKey] || !allowedFields.includes(fieldKey)) return;
  state.selfServiceSettings[itemKey][fieldKey] = !state.selfServiceSettings[itemKey][fieldKey];
  saveSelfServiceSettings();
  refreshSelfServiceManagement();
}

function removeSelfServiceReceiveCategory(itemKey, category) {
  const settings = state.selfServiceSettings[itemKey];
  if (!settings) return;
  const nextCategories = settings.categories.filter((item) => item !== category);
  if (!nextCategories.length) {
    showToast("至少保留一个可申请资产类别");
    return;
  }
  settings.categories = nextCategories;
  saveSelfServiceSettings();
  refreshSelfServiceManagement();
}

function saveSelfServiceReceiveSettings(form) {
  const data = new FormData(form);
  selfServiceSettingItems.forEach((meta) => {
    const extraSwitches = meta.extraSwitches || [];
    const normalizer = meta.hasCategories
      ? normalizeSelfServiceAssetRequestSettings
      : (settings) => normalizeSelfServiceBasicSettings(settings, extraSwitches);
    const extraSwitchValues = Object.fromEntries(
      extraSwitches.map((item) => {
        const switchId = `${meta.key}${item.key.charAt(0).toUpperCase()}${item.key.slice(1)}`;
        return [item.key, String(data.get(switchId)) === "true"];
      })
    );
    state.selfServiceSettings[meta.key] = normalizer({
      ...state.selfServiceSettings[meta.key],
      ...extraSwitchValues,
      enabled: String(data.get(`${meta.key}Enabled`)) === "true",
      remarkRequired: String(data.get(`${meta.key}RemarkRequired`)) === "true",
      remarkPrompt: String(data.get(`${meta.key}RemarkPrompt`) || "").trim(),
    });
  });
  saveSelfServiceSettings();
  showToast("员工自助配置已保存");
  refreshSelfServiceManagement();
}

function syncSelfServiceSignNoticeDrafts() {
  const inputs = document.querySelectorAll("[data-self-service-notice]");
  if (!inputs.length) return;
  state.selfServiceSettings.signSettings = normalizeSelfServiceSignSettings(state.selfServiceSettings.signSettings || {});
  inputs.forEach((input) => {
    const item = selfServiceSignItemDefinitions().find((definition) => definition.key === input.dataset.selfServiceNotice);
    if (!item) return;
    const current = state.selfServiceSettings.signSettings[item.key] || normalizeSelfServiceSignItemSettings({}, item);
    state.selfServiceSettings.signSettings[item.key] = normalizeSelfServiceSignItemSettings(
      {
        ...current,
        noticeContent: String(input.value || "").slice(0, selfServiceNoticeContentLimit),
      },
      item
    );
  });
}

function toggleSelfServiceSignSetting(key) {
  const [itemKey, fieldKey, timingKey] = key.split(":");
  const item = selfServiceSignItemDefinitions().find((definition) => definition.key === itemKey);
  if (!item) return;
  state.selfServiceSettings.signSettings = normalizeSelfServiceSignSettings(state.selfServiceSettings.signSettings || {});
  syncSelfServiceSignNoticeDrafts();
  const current = state.selfServiceSettings.signSettings[itemKey] || normalizeSelfServiceSignItemSettings({}, item);
  if (fieldKey === "employeeSign") {
    current.employeeSign = !current.employeeSign;
  } else if (fieldKey === "noticeEnabled") {
    current.noticeEnabled = !current.noticeEnabled;
  } else if (fieldKey === "timing" && (item.timingOptions || []).some((option) => option.key === timingKey)) {
    if ((item.timingOptions || []).some((option) => option.key === timingKey && option.disabled)) return;
    current.timings = { ...(current.timings || {}), [timingKey]: !current.timings?.[timingKey] };
    current.employeeSign = Object.values(current.timings).some(Boolean);
  } else {
    return;
  }
  state.selfServiceSettings.signSettings[itemKey] = normalizeSelfServiceSignItemSettings(current, item);
  saveSelfServiceSettings();
  refreshSelfServiceManagement();
}

function saveSelfServiceSignSettings(form) {
  const data = new FormData(form);
  const currentPage = currentSelfServiceSignPage();
  state.selfServiceSettings.signSettings = normalizeSelfServiceSignSettings(state.selfServiceSettings.signSettings || {});
  currentPage.items.forEach((item) => {
    const timings = Object.fromEntries(
      (item.timingOptions || []).map((option) => [`${option.key}`, option.disabled ? true : data.has(`${item.key}Timing_${option.key}`)])
    );
    const hasTimingOptions = Boolean((item.timingOptions || []).length);
    state.selfServiceSettings.signSettings[item.key] = normalizeSelfServiceSignItemSettings(
      {
        employeeSign: hasTimingOptions ? Object.values(timings).some(Boolean) : data.has(`${item.key}EmployeeSign`),
        noticeEnabled: data.has(`${item.key}NoticeEnabled`),
        noticeContent: String(data.get(`${item.key}NoticeContent`) || "").trim(),
        timings,
      },
      item
    );
  });
  saveSelfServiceSettings();
  showToast("签字设置已保存");
  refreshSelfServiceManagement();
}

function refreshSelfServiceManagement() {
  const root = document.querySelector(".self-service-management");
  if (!root) {
    render();
    return;
  }
  const signChildren = selfServiceSignChildren();
  const signActive = state.selfServiceMenu === "签字设置" || signChildren.includes(state.selfServiceMenu);
  const signOpen = Boolean(state.selfServiceSignOpen);
  const group = root.querySelector(".self-service-group");
  const parent = root.querySelector("[data-self-service-toggle]");
  group?.classList.toggle("open", signOpen);
  parent?.classList.toggle("active", signActive);
  parent?.setAttribute("aria-expanded", signOpen ? "true" : "false");
  root.querySelector(".self-service-children")?.setAttribute("aria-hidden", signOpen ? "false" : "true");
  root.querySelectorAll("[data-self-service-menu]").forEach((button) => {
    button.classList.toggle("active", button.dataset.selfServiceMenu === state.selfServiceMenu);
  });
  const content = root.querySelector("[data-self-service-content]");
  if (content) content.outerHTML = renderSelfServiceContent();
  bindSelfServiceSettingsEvents();
}

function bindSelfServiceSettingsEvents() {
  document.querySelectorAll("[data-self-service-switch]").forEach((el) =>
    el.addEventListener("click", () => toggleSelfServiceReceiveSetting(`${el.dataset.selfServiceItem}:${el.dataset.selfServiceSwitch}`))
  );
  document.querySelectorAll("[data-self-service-sign-field]").forEach((el) =>
    el.addEventListener("change", () => toggleSelfServiceSignSetting(el.dataset.selfServiceSignField))
  );
  document.querySelectorAll("[data-self-service-remove-category]").forEach((el) =>
    el.addEventListener("click", () => removeSelfServiceReceiveCategory(el.dataset.selfServiceItem, el.dataset.selfServiceRemoveCategory))
  );
  document.querySelectorAll("[data-self-service-expand-categories]").forEach((el) => el.addEventListener("click", () => {
    state.selfServiceCategoryExpanded = {
      ...(state.selfServiceCategoryExpanded || {}),
      [el.dataset.selfServiceExpandCategories]: true,
    };
    refreshSelfServiceManagement();
  }));
  document.querySelectorAll("[data-self-service-remark]").forEach((el) => el.addEventListener("input", (event) => {
    const counter = document.querySelector(`[data-self-service-remark-count="${cssEscape(event.currentTarget.dataset.selfServiceRemark)}"]`);
    if (counter) counter.textContent = String(event.currentTarget.value.length);
  }));
  document.querySelectorAll("[data-self-service-notice]").forEach((el) => el.addEventListener("input", (event) => {
    const counter = document.querySelector(`[data-self-service-notice-count="${cssEscape(event.currentTarget.dataset.selfServiceNotice)}"]`);
    if (counter) counter.textContent = String(event.currentTarget.value.length);
  }));
  document.querySelector("[data-self-service-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSelfServiceReceiveSettings(event.currentTarget);
  });
  document.querySelector("[data-self-service-sign-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSelfServiceSignSettings(event.currentTarget);
  });
}

function renderSystemMainContent() {
  if (state.systemMenu === "角色管理") return renderRoleManagement();
  if (state.systemMenu === "员工自助") return renderSelfServiceManagement();
  const descriptions = {
    员工信息: "维护员工档案、账号归属和员工端登录基础信息。",
    组织架构: "维护公司、部门和组织同步后的层级结构。",
    员工自助: "配置员工领用、退库、借用、报修和签字确认能力。",
    系统对接: "维护飞书、钉钉、企业微信、OA 等外部系统连接。",
    表单管理: "维护资产、审批、盘点相关表单字段和模板。",
  };
  return renderSystemPlaceholder(state.systemMenu, descriptions[state.systemMenu] || "系统配置模块。");
}

function renderSettings() {
  const items = ["员工信息", "组织架构", "角色管理", "员工自助", "系统对接", "表单管理"];
  return `<section class="system-page ${state.systemMenu === "员工自助" ? "self-service-system-page" : ""}">
    <aside class="system-menu-shell">
      <div class="asset-subnav system-menu">
        <div class="asset-subnav-heading">
          <span class="asset-subnav-accent" aria-hidden="true"></span>
          <h2>系统</h2>
        </div>
        <div class="asset-subnav-rule" aria-hidden="true"></div>
        <div class="asset-subnav-list">
        ${items
          .map(
            (item) => `<button class="asset-subnav-item ${state.systemMenu === item ? "active" : ""}" type="button" data-system-menu="${item}">
              <span class="asset-subnav-dot" aria-hidden="true"></span>
              <span class="asset-subnav-label">${item}</span>
            </button>`
          )
          .join("")}
        </div>
      </div>
    </aside>
    ${renderSystemMainContent()}
  </section>`;
}

function pageHeader(title, subtitle, action = null, kind = null, options = {}) {
  const buttons = [];
  if (action && options.actionAttr) {
    buttons.push(`<button class="btn primary" ${options.actionAttr}>${action}</button>`);
  } else if (action && kind) {
    buttons.push(`<button class="btn primary" data-open-kind="${kind}">${action}</button>`);
  }
  if (options.showExport !== false) {
    buttons.push(`<button class="btn">导出</button>`);
  }
  const showBatch = options.showBatch ?? state.currentUser?.roleCode !== "employee";
  if (showBatch) {
    buttons.push(`<button class="btn">批量操作</button>`);
  }
  return `<section class="hero"><h1>${title}</h1><p>${subtitle}</p>${buttons.length ? `<div class="quick-actions">${buttons.join("")}</div>` : ""}</section>`;
}

function toolbar(placeholders) {
  return `<div class="toolbar">
    <input class="local-search" type="search" placeholder="${placeholders[0]}" value="${escapeHtml(state.query)}">
    <select><option>${placeholders[1]}</option><option>全部</option><option>在用</option><option>闲置</option><option>维修中</option></select>
    <select><option>${placeholders[2]}</option><option>全部</option><option>设备</option><option>软件</option></select>
    <button class="btn primary" data-search>查询</button>
    <button class="btn" data-reset>重置</button>
  </div>`;
}

function renderLogin() {
  return `<section class="login-replica-shell">
    <div class="container container-show" data-login-stage>
      <div class="login-box">
        <div class="title">Login</div>
        <form data-auth-login-form>
          <div class="input"><input name="account" placeholder="Input your username" autocomplete="username"></div>
          <div class="input"><input name="password" type="password" placeholder="Input your password" autocomplete="current-password"></div>
          <button class="btn login-btn" type="submit">登录</button>
        </form>
        <div class="change-box login-change">
          <button class="change-btn toSign" type="button" data-auth-flip="register">去注册</button>
        </div>
      </div>

      <div class="sign-box">
        <div class="title">Sign</div>
        <form data-auth-register-form>
          <div class="input"><input name="name" placeholder="Have A Good Name?" autocomplete="name"></div>
          <div class="input"><input name="password" type="password" placeholder="Keep Secret" autocomplete="new-password"></div>
          <button class="btn sign-btn" type="submit">注册</button>
        </form>
        <div class="change-box sign-change">
          <button class="change-btn toLogin" type="button" data-auth-flip="login">去登陆</button>
        </div>
      </div>
    </div>
  </section>`;
}

function renderBindReview() {
  const pending = state.pendingAuth;
  if (!pending) return renderLogin();

  const targetUser = pending.targetAccount ? state.users.find((user) => user.account === pending.targetAccount) : null;

  return `<section class="bind-shell">
    <article class="bind-card bind-highlight">
      <div class="eyebrow">身份绑定确认</div>
      <h1>${pending.name}</h1>
      <p>${pending.provider} 认证已成功。本系统需要先确认本地用户归属，再根据三类本地角色决定进入管理端还是员工端。</p>
      <div class="detail-grid">
        ${detail("Provider", pending.provider)}
        ${detail("外部 Subject", pending.subject)}
        ${detail("邮箱", pending.email)}
        ${detail("部门", pending.department)}
        ${detail("建议策略", pending.suggestion)}
        ${detail("当前动作", pending.suggestedAction === "bind_existing" ? "绑定现有用户" : "自动新增普通员工")}
      </div>
    </article>
    <article class="bind-card">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">处理建议</h2>
          <div class="panel-subtitle">高权限不直接继承自 OIDC。绑定和授权都在本地系统中完成。</div>
        </div>
      </div>
      <div class="permission-list">
        ${
          pending.suggestedAction === "bind_existing"
            ? `<div class="permission-item">
                <div>
                  <strong>绑定到现有本地用户</strong>
                  <div class="panel-subtitle">${targetUser?.name || pending.targetAccount} / ${targetUser?.roleName || "待确认角色"}</div>
                </div>
                ${targetUser ? roleBadge(targetUser.roleCode) : statusTag("待执行")}
              </div>`
            : `<div class="permission-item">
                <div>
                  <strong>新增普通员工</strong>
                  <div class="panel-subtitle">自动创建本地用户，后续仍可由管理员调整角色。</div>
                </div>
                ${roleBadge("employee")}
              </div>`
        }
        <div class="permission-item">
          <div>
            <strong>保留在待处理队列</strong>
            <div class="panel-subtitle">适合需要人工复核邮箱冲突或组织归属的情况。</div>
          </div>
          ${statusTag("待执行")}
        </div>
      </div>
      <div class="quick-actions">
        ${
          pending.suggestedAction === "bind_existing"
            ? `<button class="btn primary" data-bind-action="bind">确认绑定并登录</button>`
            : `<button class="btn primary" data-bind-action="create">自动新增并登录</button>`
        }
        <button class="btn ghost" data-bind-action="queue">暂存待处理</button>
        <button class="btn" data-bind-action="back">返回登录入口</button>
      </div>
    </article>
  </section>`;
}

function render() {
  if (isAuthenticated()) {
    ensureAccessibleRoute();
    ensureNavOpenForRoute();
  }

  renderChrome();

  if (!isAuthenticated()) {
    renderNav();
    renderSecondaryNav();
    page.innerHTML = state.authView === "bind" ? renderBindReview() : renderLogin();
    bindPageEvents();
    return;
  }

  renderNav();
  renderSecondaryNav();
  requestAnimationFrame(syncNavIndicator);
  const renderers = {
    home: renderHome,
    assets: () => renderAssets("资产列表", state.assets),
    assetInbound: renderAssetInbound,
    assetReceiveReturn: renderAssetReceiveReturn,
    assetBorrowReturn: renderAssetBorrowReturn,
    assetSettings: renderAssetSettings,
    assetLocationSettings: renderAssetSettings,
    assetCategorySettings: renderAssetSettings,
    assetCodeRules: renderAssetSettings,
    assetLabelTemplateSettings: renderAssetSettings,
    software: () => renderAssets("软件许可", state.assets.filter((item) => item.type === "软件许可")),
    consumables: renderConsumables,
    requests: renderRequests,
    stocktake: renderStocktake,
    repair: renderRepair,
    contracts: renderContracts,
    settings: renderSettings,
  };
  page.innerHTML = (renderers[state.route] || renderHome)();
  bindPageEvents();
}

function setResizableTableWidth(context, columnKey, width) {
  if (context === "assetList") {
    setAssetListColumnWidth(columnKey, width);
    return;
  }
  if (context === "inbound") {
    setInboundColumnWidth(columnKey, width);
    return;
  }
  if (context === "receiveReturn") {
    setReceiveReturnColumnWidth(columnKey, width);
    return;
  }
  if (context !== "borrowReturn") return;
  const column = borrowReturnTableColumns.find((item) => item.key === columnKey);
  if (!column) return;
  const minWidth = Number(column.minWidth) || 72;
  const nextWidth = Math.max(minWidth, Math.round(width));
  document.querySelectorAll(`[data-resizable-table="${context}"]`).forEach((table) => {
    const col = table.querySelector(`col[data-column-key="${CSS.escape(columnKey)}"]`);
    if (col) col.style.width = `${nextWidth}px`;
    const widthMap = { ...(state.borrowReturnColumnWidths || {}), [columnKey]: nextWidth };
    table.style.minWidth = `${borrowReturnTableMinWidth(widthMap)}px`;
  });
}

function resizableColumnConfig(context, columnKey, th) {
  if (context === "assetList") {
    const column = assetTableColumns.find((item) => item.key === columnKey);
    if (!column) return null;
    return {
      minWidth: Number(column.minWidth || th.dataset.minWidth) || 48,
      startWidth: assetTableColumnWidth(column) || th.getBoundingClientRect().width,
      commit: (width) => commitAssetListColumnWidth(columnKey, width),
    };
  }
  if (context === "borrowReturn") {
    const column = borrowReturnTableColumns.find((item) => item.key === columnKey);
    if (!column) return null;
    return {
      minWidth: Number(column.minWidth || th.dataset.minWidth) || 72,
      startWidth: borrowReturnColumnWidth(column) || th.getBoundingClientRect().width,
      commit: (width) => {
        state.borrowReturnColumnWidths = normalizeBorrowReturnColumnWidths({
          ...(state.borrowReturnColumnWidths || {}),
          [columnKey]: width,
        });
        saveBorrowReturnColumnWidths();
      },
    };
  }
  if (context === "inbound") {
    const column = inboundOrderTableColumns.find((item) => item.key === columnKey);
    if (!column) return null;
    return {
      minWidth: Number(column.minWidth || th.dataset.minWidth) || 48,
      startWidth: inboundColumnWidth(column) || th.getBoundingClientRect().width,
      commit: (width) => commitInboundColumnWidth(columnKey, width),
    };
  }
  if (context === "receiveReturn") {
    const column = receiveReturnColumns().find((item) => item.key === columnKey);
    if (!column) return null;
    return {
      minWidth: Number(column.minWidth || th.dataset.minWidth) || 48,
      startWidth: receiveReturnColumnWidth(column) || th.getBoundingClientRect().width,
      commit: (width) => commitReceiveReturnColumnWidth(columnKey, width),
    };
  }
  return null;
}

function bindResizableTableColumns() {
  document.querySelectorAll("[data-column-resize]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const [context, columnKey] = (handle.dataset.columnResize || "").split(":");
      const table = handle.closest("[data-resizable-table]");
      const th = handle.closest("th");
      if (!context || !columnKey || !table || !th) return;

      const config = resizableColumnConfig(context, columnKey, th);
      if (!config) return;
      const { minWidth, startWidth, commit } = config;
      const startX = event.clientX;
      let latestWidth = startWidth;
      let frameId = 0;
      document.body.classList.add("is-resizing-column");
      table.classList.add("is-column-resizing");
      handle.classList.add("active");
      handle.setPointerCapture?.(event.pointerId);

      const applyLatestWidth = () => {
        frameId = 0;
        setResizableTableWidth(context, columnKey, latestWidth);
      };

      const onPointerMove = (moveEvent) => {
        latestWidth = Math.max(minWidth, startWidth + moveEvent.clientX - startX);
        if (!frameId) frameId = requestAnimationFrame(applyLatestWidth);
      };

      const onPointerUp = (upEvent) => {
        if (frameId) {
          cancelAnimationFrame(frameId);
          frameId = 0;
        }
        setResizableTableWidth(context, columnKey, latestWidth);
        commit(latestWidth);
        handle.releasePointerCapture?.(upEvent.pointerId);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerUp);
        document.body.classList.remove("is-resizing-column");
        table.classList.remove("is-column-resizing");
        handle.classList.remove("active");
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
    });
  });
}

function updateSearchQuery(value, source = "local", immediate = false) {
  const nextValue = value.trim();
  if (state.route === "assets") {
    if (state.assetListQuery !== nextValue) state.assetListPage = 1;
    state.assetListQuery = nextValue;
  } else if (state.route === "assetInbound") {
    if (state.assetInboundQuery !== nextValue) state.assetInboundPage = 1;
    state.assetInboundQuery = nextValue;
  } else if (state.route === "assetReceiveReturn") {
    if (state.assetReceiveReturnQuery !== nextValue) state.assetReceiveReturnPage = 1;
    state.assetReceiveReturnQuery = nextValue;
  } else if (state.route === "assetBorrowReturn") {
    if (state.assetBorrowReturnQuery !== nextValue) state.assetBorrowReturnPage = 1;
    state.assetBorrowReturnQuery = nextValue;
  } else {
    state.query = nextValue;
  }
  clearTimeout(searchRenderTimer);
  const shouldRender = ["assets", "assetInbound", "assetReceiveReturn", "assetBorrowReturn", "requests", "repair"].includes(state.route);
  if (!shouldRender) return;

  const renderSearchResults = () => {
    render();
    const selector = ".local-search";
    const input = document.querySelector(selector);
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };

  if (immediate) {
    renderSearchResults();
    return;
  }

  searchRenderTimer = setTimeout(renderSearchResults, 180);
}

let dashboardBarTooltipElement = null;

function ensureDashboardBarTooltip() {
  if (dashboardBarTooltipElement) return dashboardBarTooltipElement;
  const tooltip = document.createElement("div");
  tooltip.className = "dashboard-bar-tooltip";
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  dashboardBarTooltipElement = tooltip;
  return tooltip;
}

function hideDashboardBarTooltip() {
  if (!dashboardBarTooltipElement) return;
  dashboardBarTooltipElement.classList.remove("show");
  dashboardBarTooltipElement.hidden = true;
}

function renderDashboardBarTooltipContent(tooltip, title, detail) {
  const titleNode = document.createElement("strong");
  titleNode.textContent = title;

  const detailNode = document.createElement("span");
  detailNode.className = "dashboard-bar-tooltip-detail";

  const dotNode = document.createElement("i");
  dotNode.setAttribute("aria-hidden", "true");

  const textNode = document.createElement("span");
  textNode.textContent = detail;

  detailNode.replaceChildren(dotNode, textNode);
  tooltip.replaceChildren(titleNode, detailNode);
}

function positionDashboardBarTooltip(bar) {
  const title = bar.dataset.tooltipTitle || "";
  const detail = bar.dataset.tooltipDetail || "";
  if (!title && !detail) return hideDashboardBarTooltip();

  const tooltip = ensureDashboardBarTooltip();
  renderDashboardBarTooltipContent(tooltip, title, detail);
  tooltip.hidden = false;
  tooltip.classList.remove("show", "left", "right");
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";

  const barVisual = bar.querySelector("span") || bar;
  const barRect = barVisual.getBoundingClientRect();
  const cardRect = bar.closest(".dashboard-chart-card")?.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 14;
  const leftLimit = Math.max(viewportPadding, (cardRect?.left ?? 0) + viewportPadding);
  const rightLimit = Math.min(window.innerWidth - viewportPadding, (cardRect?.right ?? window.innerWidth) - viewportPadding);

  let placement = "right";
  let left = barRect.right + gap;
  if (left + tooltipRect.width > rightLimit) {
    placement = "left";
    left = barRect.left - gap - tooltipRect.width;
  }
  if (left < leftLimit) {
    left = Math.min(Math.max(barRect.left + barRect.width / 2 - tooltipRect.width / 2, leftLimit), rightLimit - tooltipRect.width);
  }

  const top = Math.min(
    Math.max(barRect.top + barRect.height / 2 - tooltipRect.height / 2, viewportPadding),
    window.innerHeight - tooltipRect.height - viewportPadding
  );

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
  tooltip.classList.add("show", placement);
}

function bindDashboardBarTooltips(root = document) {
  root.querySelectorAll("[data-dashboard-bar-tooltip]").forEach((bar) => {
    bar.addEventListener("pointerenter", () => positionDashboardBarTooltip(bar));
    bar.addEventListener("pointermove", () => positionDashboardBarTooltip(bar));
    bar.addEventListener("pointerleave", hideDashboardBarTooltip);
    bar.addEventListener("mouseenter", () => positionDashboardBarTooltip(bar));
    bar.addEventListener("mousemove", () => positionDashboardBarTooltip(bar));
    bar.addEventListener("mouseleave", hideDashboardBarTooltip);
    bar.addEventListener("focus", () => positionDashboardBarTooltip(bar));
    bar.addEventListener("blur", hideDashboardBarTooltip);
  });
}

function bindPageEvents() {
  bindPlaceholderSelects();
  bindInlineSelects();
  bindAssetCodeRuleControls();
  bindAssetLabelTemplateSettings();
  bindAssetCodeInputs();
  bindResizableTableColumns();
  bindDashboardBarTooltips();
  document.querySelectorAll("[data-route]").forEach((el) =>
    el.addEventListener("click", () => setRoute(el.dataset.route))
  );
  document.querySelectorAll(
    ".table-action, .receive-return-action-link, [data-open-kind], [data-import-action], [data-start-asset-receive], [data-start-asset-return], [data-start-asset-borrow]"
  ).forEach((el) => el.addEventListener("click", closeAccountMenus, { capture: true }));
  document.querySelectorAll("[data-nav-group]").forEach((el) =>
    el.addEventListener("click", () => toggleNavGroup(el.dataset.navGroup))
  );
  document.querySelectorAll("[data-asset-subnav-toggle]").forEach((el) =>
    el.addEventListener("click", () => toggleAssetSubnavGroup(el.dataset.assetSubnavToggle))
  );
  document.querySelectorAll("[data-asset-distribution-mode]").forEach((el) =>
    el.addEventListener("click", () => {
      state.assetDistributionMode = el.dataset.assetDistributionMode === "location" ? "location" : "organization";
      render();
    })
  );
  document.querySelectorAll("[data-asset-category-metric]").forEach((el) =>
    el.addEventListener("click", () => {
      state.assetCategoryMetricMode = el.dataset.assetCategoryMetric === "amount" ? "amount" : "count";
      render();
    })
  );
  document.querySelectorAll("[data-system-menu]").forEach((el) =>
    el.addEventListener("click", () => {
      state.systemMenu = el.dataset.systemMenu;
      if (state.systemMenu === "员工自助" && !state.selfServiceMenu) state.selfServiceMenu = "员工自助管理";
      state.roleForm = null;
      render();
    })
  );
  document.querySelectorAll("[data-self-service-toggle]").forEach((el) =>
    el.addEventListener("click", toggleSelfServiceSignGroup)
  );
  document.querySelectorAll("[data-self-service-menu]").forEach((el) =>
    el.addEventListener("click", () => setSelfServiceMenu(el.dataset.selfServiceMenu || "员工自助管理"))
  );
  bindSelfServiceSettingsEvents();
  bindRoleManagementEvents();
  document.querySelectorAll("[data-location-tree-toggle]").forEach((el) =>
    el.addEventListener("click", () => toggleLocationTreeGroup(el.dataset.locationTreeToggle))
  );
  document.querySelectorAll("[data-category-tree-toggle]").forEach((el) =>
    el.addEventListener("click", () => toggleAssetCategoryTreeGroup(el.dataset.categoryTreeToggle))
  );
  document.querySelectorAll("[data-location-focus]").forEach((el) =>
    el.addEventListener("click", () => focusLocationRow(el.dataset.locationFocus))
  );
  document.querySelectorAll("[data-category-focus]").forEach((el) =>
    el.addEventListener("click", () => focusAssetCategoryRow(el.dataset.categoryFocus))
  );
  document.querySelector("[data-location-search]")?.addEventListener("input", (event) => {
    state.locationSettingsQuery = event.target.value;
    refreshLocationSettingTable();
  });
  document.querySelector("[data-category-search]")?.addEventListener("input", (event) => {
    state.assetCategorySettingsQuery = event.target.value;
    state.assetCategoryPage = 1;
    refreshAssetCategorySettingTable();
  });
  document.querySelector("[data-location-create]")?.addEventListener("click", () => openLocationModal());
  document.querySelector("[data-category-create]")?.addEventListener("click", () => openAssetCategoryModal());
  document.querySelectorAll("[data-location-workbook-action]").forEach((el) =>
    el.addEventListener("click", () => triggerLocationWorkbookAction(el.dataset.locationWorkbookAction))
  );
  document.querySelectorAll("[data-category-workbook-action]").forEach((el) =>
    el.addEventListener("click", () => {
      const action = el.dataset.categoryWorkbookAction;
      if (action === "export") showToast(`已模拟导出 ${flattenAssetCategoryTree().length} 条分类`);
      else if (action === "template") showToast("已模拟下载资产分类导入模板");
      else showToast("已模拟打开分类导入");
    })
  );
  document.querySelector("[data-location-import-file]")?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    handleLocationImportFile(file);
  });
  document.querySelector("[data-location-settings-panel]")?.addEventListener("click", handleLocationTableClick);
  document.querySelector("[data-category-settings-panel]")?.addEventListener("click", handleAssetCategoryTableClick);
  document.querySelectorAll("[data-detail]").forEach((el) =>
    el.addEventListener("click", () => openAssetDetail(el.dataset.detail))
  );
  document.querySelectorAll("[data-asset-action]").forEach((el) =>
    el.addEventListener("click", () => handleAssetAction(el.dataset.assetAction, el.dataset.action))
  );
  document.querySelectorAll("[data-asset-select]").forEach((el) =>
    el.addEventListener("change", () => {
      setSelectedAsset(el.dataset.assetSelect, el.checked);
      render();
    })
  );
  document.querySelector("[data-asset-check-all]")?.addEventListener("change", (event) => {
    setAllVisibleAssets(event.target.checked);
    render();
  });
  document.querySelectorAll("[data-inbound-select]").forEach((el) =>
    el.addEventListener("change", () => {
      setSelectedInboundOrder(el.dataset.inboundSelect, el.checked);
      render();
    })
  );
  document.querySelector("[data-inbound-check-all]")?.addEventListener("change", (event) => {
    setAllVisibleInboundOrders(currentInboundPageOrders(), event.target.checked);
    render();
  });
  document.querySelectorAll("[data-receive-return-tab]").forEach((el) =>
    el.addEventListener("click", () => setReceiveReturnTab(el.dataset.receiveReturnTab))
  );
  document.querySelectorAll("[data-receive-return-select]").forEach((el) =>
    el.addEventListener("change", () => {
      setSelectedAsset(el.dataset.receiveReturnSelect, el.checked);
      render();
    })
  );
  document.querySelector("[data-receive-return-check-all]")?.addEventListener("change", (event) => {
    setAllVisibleReceiveReturnAssets(currentReceiveReturnRows(), event.target.checked);
    render();
  });
  document.querySelectorAll("[data-borrow-return-tab]").forEach((el) =>
    el.addEventListener("click", () => setBorrowReturnTab(el.dataset.borrowReturnTab))
  );
  document.querySelectorAll("[data-employee-request-tab]").forEach((el) =>
    el.addEventListener("click", () => {
      state.employeeRequestTab = el.dataset.employeeRequestTab || "all";
      render();
    })
  );
  document.querySelector("[data-employee-request-advanced]")?.addEventListener("click", () => showToast("高级搜索已预留，可接入申请单号、类型和时间筛选"));
  document.querySelectorAll("[data-borrow-return-select]").forEach((el) =>
    el.addEventListener("change", () => {
      setSelectedAsset(el.dataset.borrowReturnSelect, el.checked);
      render();
    })
  );
  document.querySelector("[data-borrow-return-check-all]")?.addEventListener("change", (event) => {
    setAllVisibleBorrowReturnAssets(currentBorrowReturnRows(), event.target.checked);
    render();
  });
  document.querySelectorAll("[data-cancel-inbound]").forEach((el) =>
    el.addEventListener("click", () => cancelInboundOrder(el.dataset.cancelInbound))
  );
  document.querySelectorAll("[data-bulk-asset-action]").forEach((el) =>
    el.addEventListener("click", () => handleBulkAssetAction(el.dataset.bulkAssetAction))
  );
  document.querySelectorAll("[data-edit-action]").forEach((el) =>
    el.addEventListener("click", () => handleEditAction(el.dataset.editAction))
  );
  document.querySelectorAll("[data-import-action]").forEach((el) =>
    el.addEventListener("click", () => handleImportAction(el.dataset.importAction))
  );
  document.querySelectorAll("[data-print-action]").forEach((el) =>
    el.addEventListener("click", () => openInboundPrintModal(el.dataset.printAction))
  );
  document.querySelectorAll("[data-print-asset-labels]").forEach((el) =>
    el.addEventListener("click", () => openAssetLabelPrintModal())
  );
  document.querySelectorAll("[data-flow-print-action]").forEach((el) =>
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      if (el.dataset.flowPrintAction === "receive-return") openReceiveReturnPrintModal();
    })
  );
  document.querySelectorAll("[data-quick-receive-asset]").forEach((el) =>
    el.addEventListener("click", () => openQuickAssetReceive(el.dataset.quickReceiveAsset))
  );
  document.querySelectorAll("[data-quick-return-asset]").forEach((el) =>
    el.addEventListener("click", () => openQuickAssetReturn(el.dataset.quickReturnAsset))
  );
  document.querySelectorAll("[data-quick-handover-asset]").forEach((el) =>
    el.addEventListener("click", () => openQuickAssetHandover(el.dataset.quickHandoverAsset))
  );
  document.querySelectorAll("[data-sign-handover-asset]").forEach((el) =>
    el.addEventListener("click", () => signHandoverOrder(el.dataset.signHandoverAsset))
  );
  document.querySelectorAll("[data-cancel-handover-asset]").forEach((el) =>
    el.addEventListener("click", () => cancelHandoverOrder(el.dataset.cancelHandoverAsset))
  );
  document.querySelectorAll("[data-quick-borrow-flow]").forEach((el) =>
    el.addEventListener("click", () => openQuickBorrowFlow(el.dataset.assetId, el.dataset.quickBorrowFlow))
  );
  document.querySelectorAll("[data-delay-borrow-asset]").forEach((el) =>
    el.addEventListener("click", () => delayBorrowAsset(el.dataset.delayBorrowAsset))
  );
  document.querySelectorAll("[data-start-asset-borrow]").forEach((el) => el.addEventListener("click", openBlankAssetBorrowModal));
  document.querySelectorAll("[data-borrow-advanced-search]").forEach((el) =>
    el.addEventListener("click", () => openAssetAdvancedSearch("search", "borrowReturn"))
  );
  document.querySelectorAll("[data-borrow-list-settings]").forEach((el) =>
    el.addEventListener("click", () => openAssetListSettings("borrowReturn"))
  );
  document.querySelectorAll("[data-borrow-print]").forEach((el) =>
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      showToast("已生成借用归还单打印预览");
    })
  );
  document.querySelectorAll("[data-start-asset-receive]").forEach((el) => el.addEventListener("click", openBlankAssetReceiveModal));
  document.querySelectorAll("[data-start-asset-return]").forEach((el) => el.addEventListener("click", openBlankAssetReturnModal));
  document.querySelectorAll("[data-start-asset-handover]").forEach((el) => el.addEventListener("click", openBlankAssetHandoverModal));
  document.querySelectorAll("[data-asset-filter]").forEach((el) =>
    el.addEventListener("click", () => {
      state.assetFilters[el.dataset.assetFilter] = el.dataset.value;
      state.assetListPage = 1;
      render();
    })
  );
  document.querySelectorAll("[data-select-filter]").forEach((el) =>
    el.addEventListener("change", () => {
      state.assetFilters[el.dataset.selectFilter] = el.value;
      state.assetListPage = 1;
      render();
    })
  );
  document.querySelectorAll("[data-request]").forEach((el) =>
    el.addEventListener("click", () => openRequestDetail(el.dataset.request))
  );
  document.querySelectorAll("[data-stocktake]").forEach((el) =>
    el.addEventListener("click", () => openStocktakeDetail(el.dataset.stocktake))
  );
  document.querySelectorAll("[data-open-request]").forEach((el) =>
    el.addEventListener("click", () => openRequestModal(el.dataset.openRequest))
  );
  document.querySelectorAll("[data-open-kind]").forEach((el) =>
    el.addEventListener("click", () => openKindModal(el.dataset.openKind))
  );
  document.querySelectorAll("[data-advanced-search]").forEach((el) =>
    el.addEventListener("click", () => openAssetAdvancedSearch("search", el.dataset.advancedSearch || currentAdvancedContext()))
  );
  document.querySelectorAll("[data-list-settings]").forEach((el) =>
    el.addEventListener("click", () => openAssetListSettings(el.dataset.listSettings || currentAdvancedContext()))
  );
  bindPaginationEvents(document);
  document.querySelectorAll("[data-search]").forEach((el) =>
    el.addEventListener("click", () => {
      updateSearchQuery(document.querySelector(".local-search")?.value || "", "local", true);
    })
  );
  document.querySelectorAll(".local-search").forEach((el) => {
    el.addEventListener("input", () => updateSearchQuery(el.value, "local"));
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter") updateSearchQuery(el.value, "local", true);
    });
  });
  document.querySelectorAll("[data-reset]").forEach((el) =>
    el.addEventListener("click", () => {
      state.query = "";
      state.assetListQuery = "";
      state.assetInboundQuery = "";
      state.assetReceiveReturnQuery = "";
      state.assetBorrowReturnQuery = "";
      state.assetListPage = 1;
      state.assetInboundPage = 1;
      state.assetReceiveReturnPage = 1;
      state.assetBorrowReturnPage = 1;
      resetAssetFilters();
      render();
    })
  );
  document.querySelector("[data-auth-login-form]")?.addEventListener("submit", handleLoginSubmit);
  document.querySelector("[data-auth-register-form]")?.addEventListener("submit", handleRegisterSubmit);
  document.querySelectorAll("[data-auth-flip]").forEach((el) =>
    el.addEventListener("click", () => {
      const showRegister = el.dataset.authFlip === "register";
      document.querySelector(".login-box")?.classList.toggle("animate_login", showRegister);
      document.querySelector(".sign-box")?.classList.toggle("animate_sign", showRegister);
    })
  );
  document.querySelectorAll("[data-login-account]").forEach((el) =>
    el.addEventListener("click", () => loginAsAccount(el.dataset.loginAccount))
  );
  document.querySelectorAll("[data-oidc-login]").forEach((el) =>
    el.addEventListener("click", () => beginOidcLogin(el.dataset.oidcLogin))
  );
  document.querySelectorAll("[data-bind-action]").forEach((el) =>
    el.addEventListener("click", () => handlePendingAuth(el.dataset.bindAction))
  );
  document.querySelectorAll("[data-quick-login]").forEach((el) =>
    el.addEventListener("click", () => loginAsAccount(el.dataset.quickLogin))
  );
  document.querySelectorAll("[data-terminal]").forEach((el) =>
    el.addEventListener("click", () => {
      state.selectedTerminal = el.dataset.terminal;
      render();
    })
  );
  document.querySelectorAll("[data-switch-terminal]").forEach((el) => el.addEventListener("click", switchTerminal));
  document.querySelector("[data-open-help]")?.addEventListener("click", openHelpModal);
  document.querySelector("[data-feishu-login]")?.addEventListener("click", beginFeishuOAuthLogin);
  document.querySelector("[data-account-toggle]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = event.currentTarget.closest("[data-account-menu]");
    const open = !menu?.classList.contains("open");
    document.querySelectorAll("[data-account-menu]").forEach((item) => {
      item.classList.toggle("open", item === menu && open);
      item.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", item === menu && open ? "true" : "false");
    });
  });
  document.querySelector("[data-account-profile]")?.addEventListener("click", openProfileCenter);
  document.querySelector("[data-logout]")?.addEventListener("click", logout);
}

function isInsideRoleManagement(target) {
  return Boolean(target?.closest?.(".role-management"));
}

function bindRoleManagementEvents() {
  if (roleEventsBound) return;
  roleEventsBound = true;
  document.addEventListener("click", (event) => {
    if (!isInsideRoleManagement(event.target) && !event.target.closest?.(".role-modal")) return;
    const permissionGroup = event.target.closest("[data-role-permission-group]");
    if (permissionGroup && !event.target.closest("input")) {
      selectRolePermissionGroup(permissionGroup.dataset.rolePermissionGroup, modal);
      return;
    }
    const permissionModule = event.target.closest("[data-role-module-row]");
    if (permissionModule && !event.target.closest("input")) {
      selectRolePermissionModule(permissionModule.dataset.roleModuleRow, modal);
      return;
    }
    const tabButton = event.target.closest("[data-role-tab]");
    if (tabButton) {
      state.roleTab = tabButton.dataset.roleTab || "system";
      state.roleQuery = "";
      state.roleQueryDraft = "";
      state.pendingRoleDeleteId = "";
      render();
      return;
    }
    const createButton = event.target.closest("[data-role-create]");
    if (createButton) {
      createRoleDefinitionDraft();
      return;
    }
    const editButton = event.target.closest("[data-role-edit]");
    if (editButton) {
      openRoleDefinitionModal(editButton.dataset.roleEdit);
      return;
    }
    const userCreateButton = event.target.closest("[data-role-user-create]");
    if (userCreateButton) {
      openRoleUserModal();
      return;
    }
    const roleSearchButton = event.target.closest("[data-role-search-submit]");
    if (roleSearchButton) {
      submitRoleSearch("role");
      return;
    }
    const userActionButton = event.target.closest("[data-role-user-action]");
    if (userActionButton) {
      openRoleUserActionModal(userActionButton.dataset.account || "", userActionButton.dataset.roleUserAction || "edit");
      return;
    }
    const searchSubmitButton = event.target.closest("[data-role-user-search-submit]");
    if (searchSubmitButton) {
      submitRoleSearch("user");
      return;
    }
    const deleteButton = event.target.closest("[data-role-delete]");
    if (deleteButton && !deleteButton.disabled) {
      deleteRoleDefinition(deleteButton.dataset.roleDelete);
      return;
    }
    const selectButton = event.target.closest("[data-role-select]");
    if (selectButton) {
      selectRoleDefinition(selectButton.dataset.roleSelect);
    }
  });
  document.addEventListener("input", (event) => {
    if (!isInsideRoleManagement(event.target) && !event.target.closest?.(".role-modal")) return;
    if (event.target.matches("[data-role-search]")) {
      state.roleQueryDraft = event.target.value;
      return;
    }
    if (event.target.matches("[data-role-user-search]")) {
      state.roleUserQueryDraft = event.target.value;
      return;
    }
    if (event.target.matches("[data-role-field]")) {
      syncRoleFormFromDom(modal);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (!isInsideRoleManagement(event.target)) return;
    if (event.key !== "Enter") return;
    if (event.target.matches("[data-role-search]")) {
      event.preventDefault();
      submitRoleSearch("role");
      return;
    }
    if (event.target.matches("[data-role-user-search]")) {
      event.preventDefault();
      submitRoleSearch("user");
    }
  });
  document.addEventListener("change", (event) => {
    if (!isInsideRoleManagement(event.target) && !event.target.closest?.(".role-modal")) return;
    if (event.target.matches("[data-role-all-permissions]")) {
      setRolePermissionCodes(allRolePermissionCodes(), event.target.checked, modal);
      return;
    }
    if (event.target.matches("[data-role-active-group-check]")) {
      const group = rolePermissionGroups().find((item) => item.id === state.rolePermissionGroup);
      if (group) setRolePermissionCodes(roleGroupCodes(group), event.target.checked, modal);
      return;
    }
    if (event.target.matches("[data-role-group-check]")) {
      toggleRoleGroup(event.target.dataset.roleGroupCheck, event.target.checked, modal);
      return;
    }
    if (event.target.matches("[data-role-active-module-check]")) {
      const module = rolePermissionModules.find((item) => item.code === state.rolePermissionModule);
      if (module) setRolePermissionCodes(roleModuleCodes(module), event.target.checked, modal);
      return;
    }
    if (event.target.matches("[data-role-module]")) {
      toggleRoleModule(event.target.dataset.roleModule, event.target.checked, modal);
      return;
    }
    if (event.target.matches("[data-role-permission]")) {
      syncRoleFormFromDom(modal);
      refreshRoleModuleState(modal);
    }
  });
}

function bindPaginationEvents(root = document) {
  root.querySelectorAll("[data-pagination]").forEach((pagination) => {
    const context = pagination.dataset.pagination || "assetList";
    pagination.querySelectorAll("[data-page]").forEach((button) =>
      button.addEventListener("click", () => setPaginationPage(context, button.dataset.page))
    );
    pagination.querySelector("[data-page-size]")?.addEventListener("change", (event) => {
      setPaginationPageSize(context, event.target.value);
    });
    pagination.querySelector("[data-page-jump]")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") setPaginationPage(context, event.currentTarget.value);
    });
    pagination.querySelector("[data-page-jump]")?.addEventListener("change", (event) => {
      if (event.currentTarget.value) setPaginationPage(context, event.currentTarget.value);
    });
  });
}

function handleAssetAction(id, action) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  if (canDirectHandle(asset, action)) {
    openDirectActionModal(asset, action);
    return;
  }
  openRequestModal(`资产${action}`, asset);
}

function cancelInboundOrder(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  const orderId = buildInboundOrders().find((order) => order.asset.id === assetId)?.id;
  asset.inboundStatus = "已取消";
  asset.lifecycle = [...(asset.lifecycle || []), [todayValue(), "取消入库", `${state.currentUser?.name || "admin"} 取消资产入库单`]];
  saveAssets();
  state.selectedAssetIds = state.selectedAssetIds.filter((id) => id !== assetId);
  if (orderId) state.selectedInboundOrderIds = state.selectedInboundOrderIds.filter((id) => id !== orderId);
  state.assetListPage = 1;
  render();
  showToast(`已取消 ${asset.id} 的入库单`);
}

function handleBulkAssetAction(action) {
  if (action === "edit") {
    handleEditAction("modify");
    return;
  }

  if (action === "receive") {
    const selected = requireSelectedAssets("领用");
    if (!selected.length) return;
    const invalid = selected.filter((asset) => !isReceivableAsset(asset));
    if (invalid.length) {
      showToast("只能领用空闲、闲置、上架或待验收资产");
      return;
    }
    openAssetReceiveModal(selected);
    return;
  }

  if (action === "return") {
    const selected = requireSelectedAssets("退库");
    if (!selected.length) return;
    if (selected.some((asset) => !isReturnableAsset(asset))) {
      showToast("只能退库在用资产");
      return;
    }
    openAssetReturnModal(selected);
    return;
  }

  if (action === "borrow") {
    const selected = requireSelectedAssets("借用");
    if (!selected.length) return;
    if (selected.some((asset) => !isBorrowableAsset(asset))) {
      showToast("只能借用空闲、闲置、上架或待验收资产");
      return;
    }
    openAssetBorrowModal(selected);
    return;
  }

  if (action === "borrowReturn") {
    const selected = requireSelectedAssets("借用归还");
    if (!selected.length) return;
    if (selected.some((asset) => !isBorrowReturnableAsset(asset))) {
      showToast("只能归还借用中的资产");
      return;
    }
    openAssetBorrowReturnModal(selected);
    return;
  }

  if (action === "handover") {
    const selected = requireSelectedAssets("交接");
    if (!selected.length) return;
    if (selected.some((asset) => !isHandoverAsset(asset))) {
      showToast("只能交接在用或借用中的资产");
      return;
    }
    openAssetHandoverModal(selected);
  }
}

function handleEditAction(action) {
  if (action === "modify") {
    const selected = requireSelectedAssets("编辑");
    if (!selected.length) return;
    if (selected.length > 1) {
      showToast("编辑一次只能选择一条资产");
      return;
    }
    openAssetEditModal(selected[0]);
    return;
  }

  if (action === "delete") {
    const selected = requireSelectedAssets("删除");
    if (!selected.length) return;
    const ids = new Set(selected.map((asset) => asset.id));
    state.assets = state.assets.filter((asset) => !ids.has(asset.id));
    state.selectedAssetIds = [];
    saveAssets();
    render();
    showToast(`已删除 ${selected.length} 条资产`);
    return;
  }

  if (action === "copy") {
    const selected = requireSelectedAssets("复制");
    if (!selected.length) return;
    if (selected.length > 1) {
      showToast("复制资产一次只能选择一条资产");
      return;
    }
    const source = selected[0];
    const copy = normalizeSavedAsset({
      ...source,
      id: generateAssetCode(source.category),
      name: `${source.name || "未命名资产"} 副本`,
      status: "空闲",
      owner: "未分配",
      receiveDate: "",
      borrowDate: "",
      expectedReturnDate: "",
      returnDate: "",
      lifecycle: [[todayValue(), "复制资产", `从 ${source.id} 复制生成`]],
    });
    state.assets.unshift(copy);
    state.selectedAssetIds = [copy.id];
    saveAssets();
    render();
    showToast(`已复制资产 ${copy.id}`);
    return;
  }

  if (action === "batch") {
    const selected = requireSelectedAssets("批量修改");
    if (!selected.length) return;
    openAssetBatchEditModal(selected);
  }
}

function handleImportAction(action) {
  if (action === "export") {
    if (state.route === "assetInbound") {
      exportSelectedInboundOrders();
      return;
    }
    if (state.route === "assetReceiveReturn") {
      exportSelectedReceiveReturnOrders();
      return;
    }
    showToast("已模拟导出资产列表");
    return;
  }
  const config = {
    asset: {
      title: "资产导入",
      kind: "asset",
      template: "资产导入模板.xlsx",
      templateHref: "assets/asset-import-template.xlsx",
      mode: "资产导入",
      note: "按模板批量新增资产，导入成功后进入资产台账。",
    },
    update: {
      title: "更新导入",
      kind: "update",
      template: "资产更新模板.xlsx",
      mode: "更新导入",
      note: "按资产编码匹配已有资产，只更新模板内填写的字段。",
    },
    receive: {
      title: "批量领用导入",
      kind: "receive",
      template: "批量领用导入模板.xlsx",
      mode: "批量领用导入",
      note: "按资产编码和领用人批量生成领用记录。",
    },
  };
  openAssetImportModal(config[action] || config.asset);
}

function openQuickAssetReceive(id) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  if (!isReceivableAsset(asset)) {
    showToast("当前资产状态不能领用");
    return;
  }
  state.selectedAssetIds = [asset.id];
  openAssetReceiveModal([asset]);
}

function openBlankAssetReceiveModal() {
  state.selectedAssetIds = [];
  openAssetReceiveModal([]);
}

function openBlankAssetReturnModal() {
  state.selectedAssetIds = [];
  openAssetReturnModal([]);
}

function openBlankAssetHandoverModal() {
  state.selectedAssetIds = [];
  openAssetHandoverModal([]);
}

function openBlankAssetBorrowModal() {
  state.selectedAssetIds = [];
  openAssetBorrowModal([]);
}

function openQuickAssetReturn(id) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  if (!isReturnableAsset(asset)) {
    showToast("当前资产状态不能退库");
    return;
  }
  state.selectedAssetIds = [asset.id];
  openAssetReturnModal([asset]);
}

function openQuickAssetHandover(id) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  if (!isHandoverAsset(asset)) {
    showToast("当前资产状态不能交接");
    return;
  }
  state.selectedAssetIds = [asset.id];
  openAssetHandoverModal([asset]);
}

function signHandoverOrder(id) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  asset.status = "在用";
  asset.handoverDate = asset.handoverDate || todayValue();
  asset.lifecycle = [...(asset.lifecycle || []), [todayValue(), "交接签字", `${asset.owner || "接收人"} 已确认交接`]];
  saveAssets();
  render();
  showToast("交接签字已完成");
}

function cancelHandoverOrder(id) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  asset.status = "在用";
  asset.lifecycle = [...(asset.lifecycle || []), [todayValue(), "取消交接", `${state.currentUser?.name || "admin"} 取消交接单`]];
  saveAssets();
  state.selectedAssetIds = state.selectedAssetIds.filter((assetId) => assetId !== id);
  render();
  showToast("交接单已取消");
}

function openQuickBorrowFlow(id, flow) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  state.selectedAssetIds = [asset.id];
  if (flow === "borrow") {
    if (!isBorrowableAsset(asset)) {
      showToast("当前资产状态不能借用");
      return;
    }
    openAssetBorrowModal([asset]);
    return;
  }
  if (!isBorrowReturnableAsset(asset)) {
    showToast("当前资产状态不能归还");
    return;
  }
  openAssetBorrowReturnModal([asset]);
}

function delayBorrowAsset(id) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  if (!isBorrowReturnableAsset(asset)) {
    showToast("只能延期借用中的资产");
    return;
  }
  const baseDate = asset.expectedReturnDate || todayValue();
  const nextDate = new Date(baseDate);
  nextDate.setDate(nextDate.getDate() + 7);
  asset.expectedReturnDate = nextDate.toISOString().slice(0, 10);
  asset.lifecycle = [...(asset.lifecycle || []), [todayValue(), "借用延期", `${state.currentUser?.name || "admin"} 延期 ${asset.name} 至 ${asset.expectedReturnDate}`]];
  saveAssets();
  render();
  showToast(`已延期至 ${asset.expectedReturnDate}`);
}

function drawerActionMarkup(item) {
  if (!state.currentUser) return "";

  if (state.currentUser.roleCode === "employee") {
    const primaryAction = item.owner === state.currentUser.name ? "归还" : "领用";
    return `<div class="detail-actions">
      <button class="btn primary" data-asset-action="${item.id}" data-action="${primaryAction}">${assetActionLabel(item, primaryAction)}</button>
      <button class="btn" data-asset-action="${item.id}" data-action="报修">${assetActionLabel(item, "报修")}</button>
    </div>`;
  }

  return `<div class="detail-actions">
    <button class="btn primary" data-asset-action="${item.id}" data-action="调拨">${assetActionLabel(item, "调拨")}</button>
    <button class="btn" data-asset-action="${item.id}" data-action="维修">${assetActionLabel(item, "维修")}</button>
	  </div>`;
}

function assetDetailText(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function assetDetailReadonly(label, value, options = {}) {
  const { html = false, unit = "", wide = false, tall = false } = options;
  const content = html ? value || "-" : escapeHtml(assetDetailText(value));
  return `<label class="asset-detail-form-item ${wide ? "wide" : ""}">
    <span>${escapeHtml(label)}：</span>
    <div class="asset-detail-readonly ${tall ? "tall" : ""}">
      <strong>${content}</strong>
      ${unit ? `<em>${escapeHtml(unit)}</em>` : ""}
    </div>
  </label>`;
}

function assetDetailSection(title, fields) {
  return `<section class="asset-detail-section">
    <h3>${escapeHtml(title)}</h3>
    <div class="asset-detail-form-grid">${fields.join("")}</div>
  </section>`;
}

function assetDetailImageBlock(item) {
  const image = item.image || item.photo || "";
  return `<section class="asset-detail-section">
    <h3>资产图片</h3>
    <div class="asset-detail-image-panel">
      ${
        image
          ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.name || "资产图片")}">`
          : `<div class="asset-detail-empty-image"><span aria-hidden="true">▧</span><strong>暂无图片</strong></div>`
      }
    </div>
  </section>`;
}

function assetDetailOperationRows(item) {
  const lifecycle = Array.isArray(item.lifecycle) && item.lifecycle.length ? item.lifecycle : [[item.purchaseDate || todayValue(), "资产入库", "通过资产系统录入"]];
  return lifecycle.map(([time, type, content]) => ({
    time: time || "-",
    operator: item.custodian || state.currentUser?.name || "admin",
    channel: "网页",
    type: type || "-",
    content: content || "-",
  }));
}

function renderAssetDetailOperations(item) {
  const rows = assetDetailOperationRows(item);
  return `<section class="asset-detail-section asset-detail-operations">
    <h3>操作记录</h3>
    <div class="asset-detail-table-wrap">
      <table class="asset-detail-operation-table">
        <thead>
          <tr><th>操作时间</th><th>操作人</th><th>渠道</th><th>操作类型</th><th>操作内容</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>
                <td>${escapeHtml(row.time)}</td>
                <td>${escapeHtml(row.operator)}</td>
                <td>${escapeHtml(row.channel)}</td>
                <td>${escapeHtml(row.type)}</td>
                <td>${escapeHtml(row.content)}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="asset-detail-operation-footer">
      <span>共 ${rows.length} 条</span>
      <button class="page-btn" type="button" disabled aria-label="上一页">‹</button>
      <button class="page-btn active" type="button" aria-current="page">1</button>
      <button class="page-btn" type="button" disabled aria-label="下一页">›</button>
      <select aria-label="每页条数"><option>20 条/页</option></select>
    </div>
  </section>`;
}

function renderAssetDetailFooterActions(item) {
  const receiveButton = isReturnableAsset(item)
    ? `<button class="table-action primary" type="button" data-quick-return-asset="${escapeHtml(item.id)}">退库</button>`
    : `<button class="table-action primary" type="button" data-quick-receive-asset="${escapeHtml(item.id)}" ${isReceivableAsset(item) ? "" : "disabled"}>领用</button>`;
  const borrowButton = isBorrowReturnableAsset(item)
    ? `<button class="table-action primary" type="button" data-quick-borrow-flow="borrowReturn" data-asset-id="${escapeHtml(item.id)}">归还</button>`
    : `<button class="table-action primary" type="button" data-quick-borrow-flow="borrow" data-asset-id="${escapeHtml(item.id)}" ${isBorrowableAsset(item) ? "" : "disabled"}>借用</button>`;
  const handoverButton = isHandoverAsset(item)
    ? `<button class="table-action" type="button" data-quick-handover-asset="${escapeHtml(item.id)}">交接</button>`
    : "";
  return `<div class="asset-detail-footer-actions">${receiveButton}${borrowButton}${handoverButton}</div>`;
}

function openAssetDetail(id) {
  const item = state.assets.find((asset) => asset.id === id);
  if (!item) return;
  drawer.classList.remove("advanced-search-drawer");
  drawer.classList.add("asset-detail-drawer");
  drawerEyebrow.textContent = "";
  drawerTitle.textContent = "";
  drawerBody.innerHTML = `
    <div class="asset-detail-page">
      <div class="asset-detail-content">
        <div class="asset-detail-title-row">
          <h3>资产详情</h3>
          ${statusTag(item.status)}
        </div>
        ${assetDetailSection("领用信息", [
          assetDetailReadonly("人员姓名", item.owner === "未分配" ? "" : item.owner),
          assetDetailReadonly("使用公司", item.company || "默认公司"),
          assetDetailReadonly("使用部门", item.department),
          assetDetailReadonly("领用/借用日期", item.receiveDate || item.borrowDate),
        ])}
        ${assetDetailSection("基本信息", [
          assetDetailReadonly("资产编码", item.id),
          assetDetailReadonly("资产名称", item.name),
          assetDetailReadonly("资产分类", item.category || item.type),
          assetDetailReadonly("管理员", item.custodian),
          assetDetailReadonly("品牌", item.brand),
          assetDetailReadonly("型号", item.model),
          assetDetailReadonly("所属/承租公司", item.ownerCompany || item.company || "默认公司"),
          assetDetailReadonly("资产状况", item.condition || item.status),
          assetDetailReadonly("所在位置", item.location),
          assetDetailReadonly("使用期限", item.usageMonths, { unit: "月" }),
          assetDetailReadonly("金额", Number(item.price) || 0, { unit: "元" }),
          assetDetailReadonly("购置/起租日期", item.purchaseDate),
          assetDetailReadonly("订单号", item.orderNo),
          assetDetailReadonly("计量单位", item.unit),
          assetDetailReadonly("购置方式", item.purchaseMethod),
          assetDetailReadonly("备注", item.note, { wide: true, tall: true }),
        ])}
        ${assetDetailImageBlock(item)}
        ${assetDetailSection("扩展信息", [assetDetailReadonly("设备序列号", item.sn)])}
        ${assetDetailSection("维保信息", [
          assetDetailReadonly("供应商", item.supplier),
          assetDetailReadonly("联系人", item.supplierContact || item.contact),
          assetDetailReadonly("联系方式", item.supplierPhone || item.contactPhone || item.phone || item.email),
          assetDetailReadonly("维保到期时间", item.warrantyDate === "未设置" ? "" : item.warrantyDate),
          assetDetailReadonly("维保说明", item.maintenanceNote || item.repairNote, { wide: true, tall: true }),
        ])}
        ${renderAssetDetailOperations(item)}
      </div>
      ${renderAssetDetailFooterActions(item)}
    </div>
  `;
  openDrawer();
  bindPageEvents();
}

function openRequestDetail(id) {
  const item = state.requests.find((request) => request.id === id);
  if (!item) return;
  drawer.classList.remove("asset-detail-drawer");
  drawerEyebrow.textContent = "审批轨迹";
  drawerTitle.textContent = item.id;
  drawerBody.innerHTML = `
    <div class="detail-grid">
      ${detail("申请类型", item.type)}
      ${detail("申请人", item.applicant)}
      ${detail("申请物品", item.asset)}
      ${detail("审批系统", item.system)}
      ${detail("当前节点", item.currentNode)}
      ${detail("状态", statusTag(item.status))}
      ${detail("申请原因", item.reason)}
      ${detail("申请日期", item.date)}
    </div>
    <h3>外部审批状态</h3>
    <div class="approval-flow">
      <div class="approval-step"><span class="step-dot done"></span><div><strong>资产系统创建单据</strong><div class="timeline-desc">生成业务单据并冻结待变更资产。</div></div></div>
      <div class="approval-step"><span class="step-dot done"></span><div><strong>${item.system} 创建审批实例</strong><div class="timeline-desc">字段映射成功，外部单号已返回。</div></div></div>
      <div class="approval-step"><span class="step-dot current"></span><div><strong>${item.currentNode}</strong><div class="timeline-desc">等待外部审批回调或人工同步。</div></div></div>
      <div class="approval-step"><span class="step-dot"></span><div><strong>资产动作执行</strong><div class="timeline-desc">审批通过后自动领用、调拨、报废或入库。</div></div></div>
    </div>
  `;
  openDrawer();
}

function openStocktakeDetail(id) {
  const item = state.stocktakes.find((task) => task.id === id);
  if (!item) return;
  drawer.classList.remove("asset-detail-drawer");
  drawerEyebrow.textContent = "盘点明细";
  drawerTitle.textContent = item.name;
  drawerBody.innerHTML = `
    <div class="detail-grid">
      ${detail("任务编号", item.id)}
      ${detail("盘点范围", item.scope)}
      ${detail("负责人", item.owner)}
      ${detail("状态", statusTag(item.progress))}
      ${detail("应盘数量", item.total)}
      ${detail("已盘数量", item.checked)}
      ${detail("差异数量", item.diff)}
      ${detail("计划日期", item.date)}
    </div>
    <h3>差异处理</h3>
    <div class="timeline">
      <div class="timeline-item"><div class="timeline-date">盘亏</div><div><div class="timeline-title">3 台设备未扫描</div><div class="timeline-desc">建议发起资产核查或报废流程。</div></div></div>
      <div class="timeline-item"><div class="timeline-date">照片</div><div><div class="timeline-title">2 张照片待审核</div><div class="timeline-desc">移动端上传照片带时间和位置水印。</div></div></div>
    </div>
  `;
  openDrawer();
}

function detail(label, value) {
  return `<div class="detail-item"><div class="detail-label">${label}</div><div class="detail-value">${value}</div></div>`;
}

function openDrawer() {
  drawer.classList.add("open");
  drawerBackdrop.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  drawer.classList.remove("open");
  drawer.classList.remove("advanced-search-drawer");
  drawer.classList.remove("asset-detail-drawer");
  drawerBackdrop.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
}

function openRequestModal(type = "资产领用", asset = null) {
  modalTitle.textContent = type;
  modal.classList.remove("asset-create-modal");
  modalBody.innerHTML = formMarkup(type, asset, false);
  openModal();
}

function openDirectActionModal(asset, action) {
  modalTitle.textContent = `管理端直办${action}`;
  modal.classList.remove("asset-create-modal");
  modalBody.innerHTML = formMarkup(`管理端直办${action}`, asset, true);
  openModal();
}

function openKindModal(kind) {
  const map = {
    asset: "新增资产",
    request: "新建申请",
    stocktake: "新建盘点",
    consumable: "耗材入库",
    repair: "新建报修",
    contract: "新增合同",
  };
  modalTitle.textContent = map[kind] || "新建";
  modal.classList.toggle("asset-create-modal", kind === "asset");
  modalBody.innerHTML = kind === "asset" ? assetCreateFormMarkup() : formMarkup(map[kind] || "新建");
  openModal();
}

function switchTerminal() {
  if (!isAuthenticated()) return;
  const targetAccount = state.currentUser.roleCode === "employee" ? "admin" : "lilei";
  loginAsAccount(targetAccount, "local", "一键切换");
}

function openHelpModal() {
  modalTitle.textContent = "系统使用说明";
  modal.classList.remove("asset-create-modal");
  modalBody.innerHTML = `
    <div class="help-guide">
      <div class="help-guide-card">
        <strong>多终端登录</strong>
        <p>系统支持网页PC端、iOS APP、Android APP。同一个账号可登录不同客户端，查看和操作相同的数据。</p>
      </div>
      <div class="help-guide-card">
        <strong>超级管理员</strong>
        <p>网页端或移动APP均可登录，拥有全部功能及数据权限。</p>
      </div>
      <div class="help-guide-card">
        <strong>普通管理员</strong>
        <p>网页端或移动APP均可登录，功能及数据查看权限由超级管理员授权。</p>
      </div>
      <div class="help-guide-card">
        <strong>普通员工</strong>
        <p>网页端或移动APP均可登录，仅能使用员工端功能，查看本人资产并提交申请。</p>
      </div>
      <div class="help-guide-card">
        <strong>一键切换</strong>
        <p>左下角第一个按钮会在员工端和管理端之间切换，默认管理端使用超级管理员演示账号。</p>
      </div>
    </div>
  `;
  openModal();
}

function assetReceiveFormMarkup(assets) {
  const operator = state.currentUser?.name || "admin";
  const lockedCompany = "默认公司";
  const lockedDepartment = "默认部门";
  return `<form id="demoForm" class="asset-flow-form receive-flow-form" data-mode="asset-receive">
    <section class="asset-flow-section">
      <div class="asset-flow-grid">
        <div class="field"><label><span class="required-star">*</span>领用人</label><div class="field-control has-icon"><input name="receiver" required placeholder="模糊搜索" autocomplete="off"><span class="field-icon" aria-hidden="true">⌕</span></div></div>
        <div class="field"><label><span class="required-star">*</span>所属公司</label><input name="company" required value="${escapeHtml(lockedCompany)}" readonly data-locked-field></div>
        <div class="field"><label>所在部门</label><input name="department" value="${escapeHtml(lockedDepartment)}" readonly data-locked-field></div>
        <div class="field"><label><span class="required-star">*</span>领用日期</label><input name="receiveDate" required type="date" value="${todayValue()}"></div>
        <div class="field"><label><span class="required-star">*</span>领用后位置</label>${inlineSelect("receiveLocation", "领用后位置", assetLocationOptions, { required: true })}</div>
        <div class="field"><label><span class="required-star">*</span>经办人</label><input name="operator" required value="${escapeHtml(operator)}" readonly data-locked-field></div>
        <div class="field full"><label>领用备注</label><textarea name="receiveNote" placeholder="请输入"></textarea></div>
      </div>
    </section>
    ${assetFlowDetailSection(assets, "资产详情")}
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="button" class="btn" data-save-draft>暂存</button>
      <button type="submit" class="btn primary">保存并提交</button>
    </div>
  </form>`;
}

function assetReturnFormMarkup(assets) {
  const operator = state.currentUser?.name || "admin";
  return `<form id="demoForm" class="asset-flow-form" data-mode="asset-return">
    <section class="asset-flow-section">
      <div class="asset-flow-grid">
        <div class="field"><label><span class="required-star">*</span>退库日期</label><input name="returnDate" required type="date" value="${todayValue()}"></div>
        <div class="field"><label><span class="required-star">*</span>退库后使用公司</label>${inlineSelect("returnCompany", "退库后使用公司", defaultCompanyOptions, { required: true, selected: "默认公司" })}</div>
        <div class="field"><label>退库后使用部门</label>${inlineSelect("returnDepartment", "退库后使用部门", defaultDepartmentOptions, { selected: "默认部门" })}</div>
        <div class="field"><label><span class="required-star">*</span>退库后位置</label>${inlineSelect("returnLocation", "退库后位置", assetLocationOptions, { required: true })}</div>
        <div class="field"><label><span class="required-star">*</span>经办人</label><input name="operator" required placeholder="经办人" value="${escapeHtml(operator)}"></div>
        <div class="field full"><label>退库备注</label><textarea name="returnNote" placeholder="请输入"></textarea></div>
      </div>
    </section>
    ${assetFlowDetailSection(assets)}
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="button" class="btn" data-save-draft>暂存</button>
      <button type="submit" class="btn primary">保存并提交</button>
    </div>
  </form>`;
}

function assetBorrowFormMarkup(assets) {
  const operator = state.currentUser?.name || "admin";
  const lockedCompany = "默认公司";
  const lockedDepartment = "默认部门";
  return `<form id="demoForm" class="asset-flow-form borrow-flow-form" data-mode="asset-borrow">
    <section class="asset-flow-section">
      <div class="asset-flow-grid">
        <div class="field"><label><span class="required-star">*</span>借用人：</label><div class="field-control has-icon"><input name="borrower" required placeholder="模糊搜索" autocomplete="off"><span class="field-icon" aria-hidden="true">⌕</span></div></div>
        <div class="field"><label><span class="required-star">*</span>所属公司：</label><input name="company" required value="${escapeHtml(lockedCompany)}" readonly data-locked-field></div>
        <div class="field"><label>所在部门：</label><input name="department" value="${escapeHtml(lockedDepartment)}" readonly data-locked-field></div>
        <div class="field"><label><span class="required-star">*</span>借用日期：</label><input name="borrowDate" required type="date" value="${todayValue()}"></div>
        <div class="field"><label>预计归还日期：</label><input name="expectedReturnDate" type="date" value="${todayValue()}"></div>
        <div class="field"><label><span class="required-star">*</span>借用后位置：</label>${inlineSelect("borrowLocation", "借用后位置", assetLocationOptions, { required: true })}</div>
        <div class="field"><label><span class="required-star">*</span>经办人：</label><input name="operator" required value="${escapeHtml(operator)}" readonly data-locked-field></div>
        <div class="field full"><label>借用备注：</label><textarea name="borrowNote" placeholder="请输入"></textarea></div>
      </div>
    </section>
    ${assetFlowDetailSection(assets, "资产详情", { expectedReturnDateColumn: true, defaultExpectedReturnDate: todayValue() })}
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="button" class="btn" data-save-draft>暂存</button>
      <button type="submit" class="btn primary">保存并提交</button>
    </div>
  </form>`;
}

function assetBorrowReturnFormMarkup(assets) {
  const operator = state.currentUser?.name || "admin";
  return `<form id="demoForm" class="asset-flow-form" data-mode="asset-borrow-return">
    <section class="asset-flow-section">
      <div class="asset-flow-grid">
        <div class="field"><label><span class="required-star">*</span>归还日期：</label><input name="returnDate" required type="date" value="${todayValue()}"></div>
        <div class="field"><label><span class="required-star">*</span>归还后位置：</label>${inlineSelect("returnLocation", "归还后位置", assetLocationOptions, { required: true, selected: assets[0]?.location || "" })}</div>
        <div class="field"><label><span class="required-star">*</span>经办人：</label><input name="operator" required value="${escapeHtml(operator)}" readonly data-locked-field></div>
        <div class="field full"><label>归还备注：</label><textarea name="returnNote" placeholder="请输入"></textarea></div>
      </div>
    </section>
    ${assetFlowDetailSection(assets)}
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="button" class="btn" data-save-draft>暂存</button>
      <button type="submit" class="btn primary">保存并提交</button>
    </div>
  </form>`;
}

function assetHandoverFormMarkup(assets) {
  const operator = state.currentUser?.name || "admin";
  const lockedCompany = "默认公司";
  const lockedDepartment = "默认部门";
  return `<form id="demoForm" class="asset-flow-form handover-flow-form" data-mode="asset-handover">
    <section class="asset-flow-section">
      <div class="handover-mode-row" role="radiogroup" aria-label="交接类型">
        <span class="handover-mode-label">交接类型：</span>
        <label class="handover-mode-option active">
          <input type="radio" name="handoverType" value="personal" checked>
          <span>员工交接</span>
        </label>
        <label class="handover-mode-option">
          <input type="radio" name="handoverType" value="public">
          <span>公共交接</span>
        </label>
      </div>
      <div class="asset-flow-grid">
        <div class="field" data-handover-personal><label><span class="required-star">*</span>接收人：</label><div class="field-control has-icon"><input name="receiver" required placeholder="模糊搜索" autocomplete="off"><span class="field-icon" aria-hidden="true">⌕</span></div></div>
        <div class="field" data-handover-personal><label><span class="required-star">*</span>接收公司：</label><input name="receiverCompany" required value="${escapeHtml(lockedCompany)}" readonly data-locked-field></div>
        <div class="field"><label>接收部门：</label>${inlineSelect("receiverDepartment", "接收部门", defaultDepartmentOptions, { selected: lockedDepartment })}</div>
        <div class="field"><label><span class="required-star">*</span>接收位置：</label>${inlineSelect("receiverLocation", "接收位置", assetLocationOptions, { required: true })}</div>
        <div class="field"><label><span class="required-star">*</span>交接日期：</label><input name="handoverDate" required type="date" value="${todayValue()}"></div>
        <div class="field"><label><span class="required-star">*</span>经办人：</label><input name="operator" required value="${escapeHtml(operator)}" readonly data-locked-field></div>
        <div class="field full"><label>交接备注：</label><textarea name="handoverNote" placeholder="请输入"></textarea></div>
      </div>
    </section>
    ${assetFlowDetailSection(assets, "资产明细")}
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="button" class="btn" data-save-draft>暂存</button>
      <button type="submit" class="btn primary">保存并提交</button>
    </div>
  </form>`;
}

function assetFlowDetailSection(assets, title = "资产详情", options = {}) {
  const columnCount = options.expectedReturnDateColumn ? 20 : 19;
  const rows = assets.length
    ? flowAssetRows(assets, options)
    : `<tr class="empty-row"><td colspan="${columnCount}">暂无已选择资产，请点击选择资产添加。</td></tr>`;
  return `<section class="asset-flow-section">
    <div class="asset-flow-tabs"><span class="active">${escapeHtml(title)}</span></div>
    <div class="asset-flow-toolbar">
      <button type="button" class="btn primary" data-keep-modal>选择资产</button>
      <button type="button" class="btn" data-remove-flow-assets ${assets.length ? "" : "disabled"}>删除资产</button>
      <button type="button" class="btn">批量导入</button>
    </div>
    <div class="asset-flow-table-wrap">
      <table class="asset-flow-table">
        <thead><tr><th class="asset-flow-select-cell"><input type="checkbox" data-flow-select-all aria-label="全选资产明细"></th>${options.expectedReturnDateColumn ? `<th><span class="required-star">*</span>预计归还日期</th>` : ""}<th>资产图片</th><th>资产编码</th><th>资产分类</th><th>资产名称</th><th>品牌</th><th>型号</th><th>设备序列号</th><th>金额</th><th>所属/承租公司</th><th>使用公司</th><th>使用部门</th><th>所在位置</th><th>使用人</th><th>管理员</th><th>购置方式</th><th>订单号</th><th>供应商</th><th>备注</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
	  </section>`;
}

function assetPickerSearchText(asset) {
  return [
    asset.id,
    asset.name,
    asset.category,
    asset.brand,
    asset.model,
    asset.sn,
    asset.ownerCompany,
    asset.company,
    asset.purchaseMethod,
    asset.location,
  ]
    .join("")
    .toLowerCase();
}

function currentFlowMode() {
  return document.querySelector("#demoForm")?.dataset.mode || "asset-receive";
}

function selectableAssetsForFlow(mode = currentFlowMode()) {
  if (mode === "asset-return") return getScopedAssets().filter(isReturnableAsset);
  if (mode === "asset-borrow") return getScopedAssets().filter(isBorrowableAsset);
  if (mode === "asset-borrow-return") return getScopedAssets().filter(isBorrowReturnableAsset);
  if (mode === "asset-handover") return getScopedAssets().filter(isHandoverAsset);
  return getScopedAssets();
}

function assetPickerColumnCount() {
  return 9;
}

function renderAssetPickerRows(rows, selectedIds) {
  if (!rows.length) {
    return `<tr class="empty-row"><td colspan="${assetPickerColumnCount()}">暂无可选择资产。</td></tr>`;
  }
  return rows
    .map(
      (asset) => `<tr>
        <td class="asset-picker-select-cell"><input type="checkbox" data-picker-asset="${escapeHtml(asset.id)}" aria-label="选择${escapeHtml(asset.id)}" ${
        selectedIds.has(asset.id) ? "checked" : ""
      }></td>
        <td>-</td>
        <td><span class="asset-code-text">${escapeHtml(asset.id)}</span></td>
        <td>${escapeHtml(asset.category || "-")}</td>
        <td>${escapeHtml(asset.name || "-")}</td>
        <td>${escapeHtml(asset.brand || "-")}</td>
        <td>${escapeHtml(asset.model || "-")}</td>
        <td>${escapeHtml(asset.sn || "-")}</td>
        <td>${escapeHtml(asset.ownerCompany || asset.company || "默认公司")}</td>
      </tr>`
    )
    .join("");
}

function renderAssetPickerOverlay() {
  if (!assetPickerState) return "";
  const query = assetPickerState.query.trim().toLowerCase();
  const sourceRows = selectableAssetsForFlow(assetPickerState.mode);
  const filters = assetPickerState.filters || {};
  const allRows = sourceRows.filter(
    (asset) =>
      (!query || assetPickerSearchText(asset).includes(query)) &&
      (!filters.status || filters.status === "全部" || asset.status === filters.status) &&
      (!filters.category || filters.category === "全部" || asset.category === filters.category) &&
      (!filters.ownerCompany || filters.ownerCompany === "全部" || (asset.ownerCompany || asset.company || "默认公司") === filters.ownerCompany)
  );
  const statusOptions = optionList(["全部", ...Array.from(new Set(sourceRows.map((asset) => asset.status).filter(Boolean)))], filters.status || "全部");
  const categoryOptions = optionList(["全部", ...Array.from(new Set(sourceRows.map((asset) => asset.category).filter(Boolean)))], filters.category || "全部");
  const ownerCompanyOptions = optionList(
    ["全部", ...Array.from(new Set(sourceRows.map((asset) => asset.ownerCompany || asset.company || "默认公司").filter(Boolean)))],
    filters.ownerCompany || "全部"
  );
  const pageCount = Math.max(1, Math.ceil(allRows.length / assetPickerState.pageSize));
  assetPickerState.page = Math.min(Math.max(assetPickerState.page, 1), pageCount);
  const start = (assetPickerState.page - 1) * assetPickerState.pageSize;
  const rows = allRows.slice(start, start + assetPickerState.pageSize);
  const selectedIds = new Set(assetPickerState.selectedIds);
  const pageIds = rows.map((asset) => asset.id);
  const allPageChecked = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const partialPageChecked = pageIds.some((id) => selectedIds.has(id)) && !allPageChecked;
  const pageButtons = paginationPageItems(assetPickerState.page, pageCount)
    .map((page) =>
      page === "ellipsis"
        ? `<span class="page-ellipsis">...</span>`
        : `<button type="button" class="page-btn ${page === assetPickerState.page ? "active" : ""}" data-picker-page="${page}">${page}</button>`
    )
    .join("");

  return `<div class="asset-picker-backdrop" data-picker-close></div>
    <section class="asset-picker-modal" role="dialog" aria-modal="true" aria-label="选择资产">
      <div class="asset-picker-header">
        <h3>选择资产</h3>
        <button type="button" class="asset-picker-close" data-picker-close aria-label="关闭">×</button>
      </div>
      <div class="asset-picker-toolbar">
        <div class="asset-list-search asset-picker-search">
          <input type="search" value="${escapeHtml(assetPickerState.query)}" placeholder="模糊查询" data-picker-query autocomplete="off">
          <button type="button" class="table-action primary" data-picker-search aria-label="搜索">⌕</button>
        </div>
      </div>
      <div class="asset-picker-table-shell">
        <div class="asset-picker-table-actions">
          <button type="button" class="link" data-picker-advanced>${assetPickerState.advancedOpen ? "收起搜索" : "高级搜索"}</button>
        </div>
        ${
          assetPickerState.advancedOpen
            ? `<div class="asset-picker-advanced-row">
                <label>资产状态<select data-picker-filter="status">${statusOptions}</select></label>
                <label>资产分类<select data-picker-filter="category">${categoryOptions}</select></label>
                <label>所属/承租公司<select data-picker-filter="ownerCompany">${ownerCompanyOptions}</select></label>
                <button type="button" class="btn" data-picker-clear-filters>重置</button>
              </div>`
            : ""
        }
        <div class="asset-picker-table-scroll">
          <table class="asset-picker-table">
            <thead>
              <tr>
                <th class="asset-picker-select-cell"><input type="checkbox" data-picker-check-page aria-label="选择当前页资产" ${allPageChecked ? "checked" : ""} ${
    partialPageChecked ? "data-indeterminate=\"true\"" : ""
  }></th>
                <th>资产图片</th>
                <th>资产编码</th>
                <th>资产分类</th>
                <th>资产名称</th>
                <th>品牌</th>
                <th>型号</th>
                <th>设备序列号</th>
                <th>所属/承租公司</th>
              </tr>
            </thead>
            <tbody>${renderAssetPickerRows(rows, selectedIds)}</tbody>
          </table>
        </div>
      </div>
      <div class="asset-picker-footer">
        <div class="asset-picker-count">共 ${allRows.length} 条，已选 ${selectedIds.size} 条</div>
        <div class="asset-picker-pagination">
          <button type="button" class="page-btn" data-picker-page="${assetPickerState.page - 1}" ${assetPickerState.page <= 1 ? "disabled" : ""}>‹</button>
          ${pageButtons}
          <button type="button" class="page-btn" data-picker-page="${assetPickerState.page + 1}" ${assetPickerState.page >= pageCount ? "disabled" : ""}>›</button>
          <select data-picker-page-size>
            <option value="20" ${assetPickerState.pageSize === 20 ? "selected" : ""}>20 条/页</option>
            <option value="50" ${assetPickerState.pageSize === 50 ? "selected" : ""}>50 条/页</option>
          </select>
        </div>
        <div class="asset-picker-actions">
          <button type="button" class="btn" data-picker-close>取消</button>
          <button type="button" class="btn primary" data-picker-confirm>确定</button>
        </div>
      </div>
    </section>`;
}

function setAssetPickerBody() {
  const host = document.querySelector("#assetPickerHost");
  if (!host) return;
  host.innerHTML = renderAssetPickerOverlay();
  bindAssetPickerEvents(host);
}

function openAssetPicker() {
  const selectedIds = new Set(state.selectedAssetIds);
  document.querySelectorAll(".asset-flow-table [data-flow-row-select]").forEach((input) => {
    selectedIds.add(input.dataset.flowRowSelect);
  });
  assetPickerState = {
    mode: currentFlowMode(),
    query: "",
    page: 1,
    pageSize: 20,
    advancedOpen: false,
    filters: {
      status: "全部",
      category: "全部",
      ownerCompany: "全部",
    },
    selectedIds: Array.from(selectedIds).filter(Boolean),
  };
  let host = document.querySelector("#assetPickerHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "assetPickerHost";
    document.body.appendChild(host);
  }
  setAssetPickerBody();
}

function closeAssetPicker() {
  assetPickerState = null;
  document.querySelector("#assetPickerHost")?.remove();
}

function confirmAssetPickerSelection() {
  if (!assetPickerState) return;
  if (!assetPickerState.selectedIds.length) {
    showToast("请至少选择一项资产");
    return;
  }
  state.selectedAssetIds = [...assetPickerState.selectedIds];
  const selectedAssets = getSelectedAssets();
  const form = document.querySelector("#demoForm");
  if (!form) {
    closeAssetPicker();
    return;
  }
  const mode = form.dataset.mode;
  const title = mode === "asset-receive" ? "资产详情" : "资产明细";
  const options = mode === "asset-borrow" ? { expectedReturnDateColumn: true, defaultExpectedReturnDate: todayValue() } : {};
  const oldSection = form.querySelector(".asset-flow-section:last-of-type");
  oldSection.outerHTML = assetFlowDetailSection(selectedAssets, title, options);
  bindAssetFlowSelection(form);
  bindAssetFlowActions(form);
  closeAssetPicker();
}

function bindAssetPickerEvents(host) {
  const pageCheck = host.querySelector("[data-picker-check-page]");
  if (pageCheck) pageCheck.indeterminate = pageCheck.dataset.indeterminate === "true";
  host.querySelectorAll("[data-picker-close]").forEach((button) => button.addEventListener("click", closeAssetPicker));
  host.querySelector("[data-picker-search]")?.addEventListener("click", () => {
    assetPickerState.query = host.querySelector("[data-picker-query]")?.value || "";
    assetPickerState.page = 1;
    setAssetPickerBody();
  });
  host.querySelector("[data-picker-query]")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    assetPickerState.query = event.currentTarget.value;
    assetPickerState.page = 1;
    setAssetPickerBody();
  });
  host.querySelectorAll("[data-picker-asset]").forEach((input) =>
    input.addEventListener("change", () => {
      const selected = new Set(assetPickerState.selectedIds);
      if (input.checked) selected.add(input.dataset.pickerAsset);
      else selected.delete(input.dataset.pickerAsset);
      assetPickerState.selectedIds = Array.from(selected);
      setAssetPickerBody();
    })
  );
  pageCheck?.addEventListener("change", () => {
    const selected = new Set(assetPickerState.selectedIds);
    host.querySelectorAll("[data-picker-asset]").forEach((input) => {
      if (pageCheck.checked) selected.add(input.dataset.pickerAsset);
      else selected.delete(input.dataset.pickerAsset);
    });
    assetPickerState.selectedIds = Array.from(selected);
    setAssetPickerBody();
  });
  host.querySelectorAll("[data-picker-page]").forEach((button) =>
    button.addEventListener("click", () => {
      assetPickerState.page = Number(button.dataset.pickerPage) || 1;
      setAssetPickerBody();
    })
  );
  host.querySelector("[data-picker-page-size]")?.addEventListener("change", (event) => {
    assetPickerState.pageSize = Number(event.target.value) || 20;
    assetPickerState.page = 1;
    setAssetPickerBody();
  });
  host.querySelector("[data-picker-confirm]")?.addEventListener("click", confirmAssetPickerSelection);
  host.querySelector("[data-picker-advanced]")?.addEventListener("click", () => {
    assetPickerState.advancedOpen = !assetPickerState.advancedOpen;
    setAssetPickerBody();
  });
  host.querySelectorAll("[data-picker-filter]").forEach((select) =>
    select.addEventListener("change", () => {
      assetPickerState.filters[select.dataset.pickerFilter] = select.value;
      assetPickerState.page = 1;
      setAssetPickerBody();
    })
  );
  host.querySelector("[data-picker-clear-filters]")?.addEventListener("click", () => {
    assetPickerState.filters = { status: "全部", category: "全部", ownerCompany: "全部" };
    assetPickerState.page = 1;
    setAssetPickerBody();
  });
}

function assetEditFormMarkup(asset) {
  const admins = Array.from(
    new Set([state.currentUser?.name, ...state.users.filter((item) => item.roleCode !== "employee").map((item) => item.name), ...uniqueAssetFormValues("custodian")].filter(Boolean))
  );
  const categories = assetCategoryFormOptions([asset.category]);
  const locations = assetLocationOptions;
  const selectedCondition = asset.condition || (asset.status === "维修中" ? "维修中" : "正常");
  return `<form id="demoForm" class="asset-create-form asset-edit-form" data-mode="asset-edit" data-asset-id="${escapeHtml(asset.id)}">
    <section class="asset-form-section">
      <div class="asset-form-section-head">
        <h3>使用信息</h3>
      </div>
      <div class="asset-form-grid">
        ${assetField("人员姓名", `<div class="field-control has-icon"><input name="personName" placeholder="请输入" value="${escapeHtml(asset.owner === "未分配" ? "" : asset.owner || "")}" autocomplete="off"><span class="field-icon" aria-hidden="true">⌕</span></div>`)}
        ${assetField("使用公司", inlineSelect("company", "使用公司", defaultCompanyOptions, { required: true, selected: asset.company || "默认公司" }), { required: true })}
        ${assetField("使用部门", inlineSelect("department", "使用部门", defaultDepartmentOptions, { selected: asset.department || "默认部门" }))}
        ${assetField("领用/借用日期", `<input name="receiveDate" type="date" value="${escapeHtml(asset.receiveDate || asset.borrowDate || "")}">`)}
      </div>
    </section>

    <section class="asset-form-section">
      <div class="asset-form-section-head">
        <h3>基本信息</h3>
        <button type="button" class="asset-template-link">选择模板</button>
      </div>
      <div class="asset-form-grid">
        ${assetField("资产编码", `<input name="assetCode" value="${escapeHtml(asset.id)}" readonly data-asset-code-input>`)}
        ${assetField("资产名称", `<input name="assetName" required placeholder="请输入" value="${escapeHtml(asset.name || "")}" autocomplete="off">`, { required: true })}
        ${assetField("资产分类", inlineSelect("category", "资产分类", categories, { required: true, selected: asset.category || "", variant: "asset-category" }), { required: true })}
        ${assetField("管理员", inlineSelect("custodian", "管理员", admins, { required: true, selected: asset.custodian || state.currentUser?.name || "" }), { required: true })}
        ${assetField("品牌", `<input name="brand" required placeholder="请输入" value="${escapeHtml(asset.brand || "")}" autocomplete="off">`, { required: true })}
        ${assetField("型号", `<input name="model" placeholder="请输入" value="${escapeHtml(asset.model || "")}" autocomplete="off">`)}
        ${assetField("所属/承租公司", inlineSelect("ownerCompany", "所属/承租公司", defaultCompanyOptions, { required: true, selected: asset.ownerCompany || "默认公司" }), { required: true })}
        ${assetField("资产状况", inlineSelect("condition", "请选择", assetConditionOptions, { required: true, selected: selectedCondition }), { required: true })}
        ${assetField("所在位置", inlineSelect("location", "所在位置", locations, { required: true, selected: normalizeLocationValue(asset.location || ""), variant: "location" }), { required: true })}
        ${assetField("使用期限", `<div class="field-control has-unit"><input name="usageMonths" type="number" min="0" step="1" placeholder="请输入" value="${escapeHtml(asset.usageMonths || "")}" data-category-useful-life-input><span class="field-unit">月</span></div>`)}
        ${assetField("金额", `<div class="field-control has-unit"><input name="price" type="number" min="0" step="1" placeholder="请输入" value="${escapeHtml(asset.price || 0)}"><span class="field-unit">元</span></div>`)}
        ${assetField("购置/起租日期", `<input name="purchaseDate" required type="date" value="${escapeHtml(asset.purchaseDate || todayValue())}">`, { required: true })}
        ${assetField("订单号", `<input name="orderNo" placeholder="请输入" value="${escapeHtml(asset.orderNo || "")}" autocomplete="off">`)}
        ${assetField("计量单位", `<input name="unit" placeholder="请输入" value="${escapeHtml(asset.unit || "台")}" autocomplete="off" data-category-unit-input>`)}
        ${assetField("购置方式", inlineSelect("purchaseMethod", "请选择", purchaseMethodOptions, { required: true, selected: asset.purchaseMethod || "" }), { required: true })}
        ${assetField("备注", `<textarea name="note" placeholder="请输入">${escapeHtml(asset.note || "")}</textarea>`, { wide: true })}
        ${assetField("租金", `<div class="field-control has-unit"><input name="rent" type="number" min="0" step="1" placeholder="请输入" value="${escapeHtml(asset.rent || 0)}"><span class="field-unit">元</span></div>`)}
      </div>
    </section>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">确定</button>
    </div>
  </form>`;
}

function openAssetReceiveModal(assets) {
  modalTitle.textContent = "新增领用单";
  modal.classList.add("asset-flow-modal");
  modal.classList.remove("asset-create-modal");
  modalBody.innerHTML = assetReceiveFormMarkup(assets);
  openModal();
}

function openAssetReturnModal(assets) {
  modalTitle.textContent = "新增退库单";
  modal.classList.add("asset-flow-modal");
  modal.classList.remove("asset-create-modal");
  modalBody.innerHTML = assetReturnFormMarkup(assets);
  openModal();
}

function openAssetBorrowModal(assets) {
  modalTitle.textContent = "新增借用单";
  modal.classList.add("asset-flow-modal");
  modal.classList.remove("asset-create-modal");
  modalBody.innerHTML = assetBorrowFormMarkup(assets);
  openModal();
}

function openAssetBorrowReturnModal(assets) {
  modalTitle.textContent = "新增归还单";
  modal.classList.add("asset-flow-modal");
  modal.classList.remove("asset-create-modal");
  modalBody.innerHTML = assetBorrowReturnFormMarkup(assets);
  openModal();
}

function openAssetHandoverModal(assets) {
  modalTitle.textContent = "新增交接单";
  modal.classList.add("asset-flow-modal");
  modal.classList.remove("asset-create-modal");
  modalBody.innerHTML = assetHandoverFormMarkup(assets);
  openModal();
}

function openAssetEditModal(asset) {
  modalTitle.textContent = "编辑资产";
  modal.classList.add("asset-flow-modal");
  modal.classList.remove("asset-create-modal");
  modalBody.innerHTML = assetEditFormMarkup(asset);
  openModal();
}

function openAssetBatchEditModal(assets) {
  modalTitle.textContent = "批量修改资产";
  modal.classList.add("asset-flow-modal");
  modal.classList.remove("asset-create-modal");
  modalBody.innerHTML = `<form id="demoForm" class="asset-create-form asset-edit-form" data-mode="asset-batch-edit">
    <section class="asset-form-section">
      <div class="asset-form-section-head">
        <h3>批量修改</h3>
      </div>
      <div class="asset-form-grid">
        ${assetField("使用公司", inlineSelect("company", "不修改", ["默认公司"]))}
        ${assetField("使用部门", inlineSelect("department", "不修改", ["默认部门"]))}
        ${assetField("资产状况", inlineSelect("condition", "不修改", assetConditionOptions))}
        ${assetField("所在位置", inlineSelect("location", "不修改", assetLocationOptions, { variant: "location" }))}
        ${assetField("购置方式", inlineSelect("purchaseMethod", "不修改", purchaseMethodOptions))}
        ${assetField("备注", `<textarea name="note" placeholder="不修改"></textarea>`, { wide: true })}
      </div>
    </section>
    ${assetFlowDetailSection(assets)}
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">确定</button>
    </div>
  </form>`;
  openModal();
}

function openAssetImportModal(config) {
  modalTitle.textContent = config.title;
  modal.classList.add("asset-import-modal");
  modal.classList.remove("asset-create-modal");
  modal.classList.remove("asset-flow-modal");
  modalBody.innerHTML = assetImportFormMarkup(config);
  openModal();
}

function assetImportFormMarkup(config) {
  const templateControl = config.templateHref
    ? `<a class="asset-template-download" href="${escapeHtml(config.templateHref)}" download="${escapeHtml(config.template)}">⇩ ${escapeHtml(config.template)}</a>`
    : `<button type="button" class="asset-template-download" data-download-template="${escapeHtml(config.template)}">⇩ ${escapeHtml(config.template)}</button>`;
  return `<form id="demoForm" class="asset-import-form" data-mode="asset-import" data-import-kind="${escapeHtml(config.kind || "asset")}" data-result="${escapeHtml(config.title)}已提交">
    <label class="asset-upload-drop" data-asset-upload-drop tabindex="0">
      <input name="assetImportFile" type="file" accept=".xls,.xlsx" data-asset-import-file hidden>
      <span class="upload-cloud" aria-hidden="true">☁</span>
      <strong data-asset-upload-title>上传表格</strong>
      <span data-asset-upload-hint>也可直接拖拽到此处上传(支持格式: xls、xlsx)</span>
      <span class="asset-upload-file" data-asset-upload-file hidden></span>
    </label>
    ${templateControl}
    <div class="asset-import-status" data-asset-import-status hidden></div>
    <div class="asset-import-note">
      <p>${escapeHtml(config.note)}</p>
      <ol>
        <li>最大数据行数不超过5000行；</li>
        <li>请根据错误文件的错误说明，修改原文件错误后导入；</li>
        <li>请勿在模板中添加批注导入。</li>
      </ol>
    </div>
    <div class="modal-actions asset-import-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">确定</button>
    </div>
  </form>`;
}

function setAssetImportStatus(form, message, tone = "info") {
  const status = form.querySelector("[data-asset-import-status]");
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || "";
  status.className = `asset-import-status ${tone}`;
}

function formatFileSize(bytes = 0) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setAssetImportFile(form, file) {
  const fileLabel = form.querySelector("[data-asset-upload-file]");
  const title = form.querySelector("[data-asset-upload-title]");
  const hint = form.querySelector("[data-asset-upload-hint]");
  form._assetImportFile = file || null;
  if (!file) {
    if (fileLabel) fileLabel.hidden = true;
    if (title) title.textContent = "上传表格";
    if (hint) hint.textContent = "也可直接拖拽到此处上传(支持格式: xls、xlsx)";
    setAssetImportStatus(form, "", "info");
    return;
  }
  if (fileLabel) {
    fileLabel.hidden = false;
    fileLabel.textContent = `${file.name} · ${formatFileSize(file.size)}`;
  }
  if (title) title.textContent = "已选择表格";
  if (hint) hint.textContent = "点击或拖拽可重新选择文件";
  setAssetImportStatus(form, "文件已就绪，点击确定开始导入。", "success");
}

function bindAssetImportControls(root) {
  const form = root.querySelector?.(".asset-import-form");
  if (!form || form.dataset.assetImportBound === "true") return;
  form.dataset.assetImportBound = "true";
  const input = form.querySelector("[data-asset-import-file]");
  const drop = form.querySelector("[data-asset-upload-drop]");
  input?.addEventListener("change", () => {
    setAssetImportFile(form, input.files?.[0] || null);
  });
  drop?.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    input?.click();
  });
  ["dragenter", "dragover"].forEach((type) => {
    drop?.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    drop?.addEventListener(type, () => drop.classList.remove("drag-over"));
  });
  drop?.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    } catch {
      // Some browsers keep file inputs read-only for dropped files.
    }
    setAssetImportFile(form, file);
  });
}

function workbookSharedStrings(sharedText = "") {
  if (!sharedText) return [];
  return Array.from(new DOMParser().parseFromString(sharedText, "application/xml").querySelectorAll("si")).map((si) =>
    Array.from(si.querySelectorAll("t"))
      .map((item) => item.textContent || "")
      .join("")
  );
}

function workbookRowsFromWorksheetXml(sheetXml, shared = []) {
  const sheet = new DOMParser().parseFromString(sheetXml, "application/xml");
  const valueOf = (cell) => {
    if (cell.getAttribute("t") === "inlineStr") {
      return Array.from(cell.querySelectorAll("is t"))
        .map((item) => item.textContent || "")
        .join("");
    }
    const raw = cell.querySelector("v")?.textContent || "";
    if (cell.getAttribute("t") === "s") return shared[Number(raw)] || "";
    return raw;
  };
  return Array.from(sheet.querySelectorAll("row")).map((row, index) => {
    const values = [];
    row.querySelectorAll("c").forEach((cell) => {
      const ref = cell.getAttribute("r") || "";
      const letters = ref.replace(/\d+/g, "");
      const colIndex = letters.split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
      values[colIndex >= 0 ? colIndex : values.length] = valueOf(cell);
    });
    return { rowNumber: Number(row.getAttribute("r")) || index + 1, values };
  });
}

async function readXlsxRows(file) {
  if (!window.JSZip) throw new Error("Excel 组件未加载，请刷新页面后重试");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const shared = workbookSharedStrings(await zip.file("xl/sharedStrings.xml")?.async("text"));
  const sheetName = zip.file("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : Object.keys(zip.files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error("未找到可读取的工作表");
  return workbookRowsFromWorksheetXml(await zip.file(sheetName).async("text"), shared);
}

function indexedXmlAttribute(node, name) {
  return node.getAttribute(`ss:${name}`) || node.getAttribute(name) || node.getAttributeNS("urn:schemas-microsoft-com:office:spreadsheet", name);
}

function readSpreadsheetXmlRows(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const worksheet = xml.getElementsByTagName("Worksheet")[0];
  if (!worksheet) return [];
  return Array.from(worksheet.getElementsByTagName("Row")).map((row, rowIndex) => {
    const values = [];
    let cursor = 0;
    Array.from(row.getElementsByTagName("Cell")).forEach((cell) => {
      const index = Number(indexedXmlAttribute(cell, "Index"));
      if (index) cursor = index - 1;
      values[cursor] = cell.getElementsByTagName("Data")[0]?.textContent || "";
      cursor += 1;
    });
    return { rowNumber: Number(indexedXmlAttribute(row, "Index")) || rowIndex + 1, values };
  });
}

function readHtmlTableRows(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return Array.from(doc.querySelectorAll("tr")).map((row, index) => ({
    rowNumber: index + 1,
    values: Array.from(row.querySelectorAll("th,td")).map((cell) => cell.textContent || ""),
  }));
}

async function readAssetWorkbookRows(file) {
  const name = file.name || "";
  if (/\.xlsx$/i.test(name)) return readXlsxRows(file);
  if (/\.xls$/i.test(name)) {
    const text = await file.text();
    if (text.includes("<Workbook")) return readSpreadsheetXmlRows(text);
    if (/<table[\s>]/i.test(text)) return readHtmlTableRows(text);
    throw new Error("暂不支持二进制 .xls，请另存为 .xlsx 后再导入");
  }
  throw new Error("请上传 .xls 或 .xlsx 表格");
}

function normalizeImportHeader(value = "") {
  return String(value)
    .trim()
    .replace(/\*/g, "")
    .replace(/[：:]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

const assetImportHeaderAliases = {
  id: ["资产编码", "资产编号", "编码"],
  name: ["资产名称", "名称"],
  category: ["资产分类", "分类"],
  brand: ["品牌"],
  model: ["型号"],
  sn: ["设备序列号", "序列号", "sn"],
  price: ["金额", "价格", "采购金额"],
  purchaseMethod: ["购置方式"],
  rent: ["租金"],
  usageMonths: ["使用期限(月)", "使用期限（月）", "使用期限"],
  custodian: ["管理员账号", "管理员"],
  condition: ["资产状况", "状况"],
  orderNo: ["订单号"],
  unit: ["计量单位", "单位"],
  ownerCompany: ["所属/承租公司", "所属公司", "承租公司"],
  purchaseDate: ["购置/起租日期", "购置日期", "起租日期"],
  receiveDate: ["领用日期"],
  location: ["所在位置", "位置"],
  company: ["使用公司"],
  department: ["部门", "使用部门"],
  employeeCode: ["人员编号", "员工编号"],
  email: ["电子邮箱", "邮箱"],
  owner: ["使用人", "人员姓名"],
  supplier: ["供应商"],
  warrantyDate: ["维保到期时间", "维保到期日期"],
  note: ["备注"],
};

const assetImportAliasLookup = Object.entries(assetImportHeaderAliases).reduce((lookup, [field, aliases]) => {
  aliases.forEach((alias) => lookup.set(normalizeImportHeader(alias), field));
  return lookup;
}, new Map());

function detectAssetImportHeader(rows) {
  let best = null;
  rows.slice(0, 12).forEach((row, index) => {
    const fields = row.values.map((value) => assetImportAliasLookup.get(normalizeImportHeader(value))).filter(Boolean);
    const score = new Set(fields).size;
    if (score >= 2 && (!best || score > best.score)) best = { index, row, score };
  });
  if (!best) throw new Error("未识别到资产导入表头，请使用资产导入模板");
  const columns = {};
  best.row.values.forEach((value, index) => {
    const field = assetImportAliasLookup.get(normalizeImportHeader(value));
    if (field && columns[field] === undefined) columns[field] = index;
  });
  return { headerIndex: best.index, headerRowNumber: best.row.rowNumber, columns };
}

function rowCellValue(row, index) {
  if (index === undefined) return "";
  return String(row.values[index] ?? "").trim();
}

function recordFromAssetImportRow(row, columns) {
  return Object.fromEntries(Object.keys(assetImportHeaderAliases).map((field) => [field, rowCellValue(row, columns[field])]));
}

function isBlankAssetImportRecord(record) {
  return Object.values(record).every((value) => !String(value || "").trim());
}

function isInstructionAssetImportRecord(record) {
  const values = Object.values(record).join(" ");
  return values.includes("必填项") || values.includes("请勿填写") || values.includes("仅可") || values.includes("格式YYYY");
}

function isTemplateSampleAssetRecord(record) {
  return !record.id && record.name === "Thinkpad T430" && record.category === "笔记本电脑" && record.brand === "Thinkpad" && record.model === "T430";
}

function parseNumberValue(value) {
  const number = Number(String(value || "").replace(/[,\s￥¥元]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeImportDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const match = text.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  if (!match) return text;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function normalizeImportCondition(value) {
  const condition = String(value || "").trim();
  if (!condition) return "正常";
  if (condition === "故障") return "维修中";
  return assetConditionOptions.includes(condition) ? condition : condition;
}

function assetImportStatusForRecord(record, condition) {
  if (condition === "维修中") return "维修中";
  if (condition === "待验收") return "待验收";
  if (record.owner || record.receiveDate) return "在用";
  return "空闲";
}

function generateImportedAssetCode(category, usedIds) {
  const prefix = assetCodeRulePrefix(category);
  const serialLength = Math.round(clampNumber(state?.assetCodeRuleSettings?.serialLength, 5, 3, 7));
  let serial = state.assets.length + 1;
  let code = `${prefix}${String(serial).padStart(serialLength, "0")}`;
  while (usedIds.has(code)) {
    serial += 1;
    code = `${prefix}${String(serial).padStart(serialLength, "0")}`;
  }
  return code;
}

function validateImportedAssetRecord(record, rowNumber) {
  const errors = [];
  if (!record.category) errors.push("缺少资产分类");
  else if (!assetCategoryFormOptions().includes(record.category)) errors.push(`资产分类“${record.category}”不存在`);
  if (!record.brand) errors.push("缺少品牌");
  if (!record.purchaseMethod) errors.push("缺少购置方式");
  if (!record.ownerCompany) errors.push("缺少所属/承租公司");
  if (!record.purchaseDate) errors.push("缺少购置/起租日期");
  if (!record.location) errors.push("缺少所在位置");
  else {
    const locationMessage = locationValidationMessage(record.location);
    if (locationMessage) errors.push(locationMessage);
  }
  if (!record.company) errors.push("缺少使用公司");
  return errors.map((message) => `第 ${rowNumber} 行${message}`);
}

function createImportedAsset(record, rowNumber, usedIds, filename) {
  const validationErrors = validateImportedAssetRecord(record, rowNumber);
  if (validationErrors.length) throw new Error(validationErrors.join("；"));
  const category = record.category;
  const id = record.id || generateImportedAssetCode(category, usedIds);
  if (usedIds.has(id)) throw new Error(`第 ${rowNumber} 行资产编码“${id}”重复`);
  usedIds.add(id);
  const condition = normalizeImportCondition(record.condition);
  const purchaseDate = normalizeImportDate(record.purchaseDate);
  const receiveDate = normalizeImportDate(record.receiveDate);
  const location = normalizeLocationValue(record.location);
  const asset = {
    id,
    name: record.name || `${category}资产`,
    category,
    type: category,
    model: record.model,
    sn: record.sn,
    owner: record.owner || "未分配",
    custodian: record.custodian || state.currentUser?.name || "admin",
    department: record.department || "默认部门",
    status: assetImportStatusForRecord(record, condition),
    location,
    supplier: record.supplier,
    assetTag: "",
    tags: [],
    risk: record.condition === "故障" ? "故障" : "正常",
    completeness: 0,
    approvalRequired: false,
    price: parseNumberValue(record.price),
    rent: parseNumberValue(record.rent),
    purchaseDate,
    receiveDate,
    warrantyDate: normalizeImportDate(record.warrantyDate) || "未设置",
    approval: "导入",
    lifecycle: [[purchaseDate || todayValue(), "资产导入", `从 ${filename} 导入`]],
    email: record.email,
    purchaseMethod: record.purchaseMethod,
    orderNo: record.orderNo,
    unit: record.unit || assetCategoryDefaultsForName(category).unit || "台",
    note: record.note,
    brand: record.brand,
    company: record.company || record.ownerCompany || "默认公司",
    ownerCompany: record.ownerCompany || "默认公司",
    condition,
    usageMonths: record.usageMonths || assetCategoryDefaultsForName(category).usefulLife,
  };
  asset.completeness = calculateAssetCompleteness(asset);
  return normalizeSavedAsset(asset);
}

function assetImportRecordsFromRows(rows) {
  const { headerIndex, columns } = detectAssetImportHeader(rows);
  return rows
    .slice(headerIndex + 1)
    .map((row) => ({ rowNumber: row.rowNumber, record: recordFromAssetImportRow(row, columns) }))
    .filter(({ record }) => !isBlankAssetImportRecord(record) && !isInstructionAssetImportRecord(record) && !isTemplateSampleAssetRecord(record));
}

async function importAssetWorkbook(file) {
  const rows = await readAssetWorkbookRows(file);
  const records = assetImportRecordsFromRows(rows);
  if (!records.length) throw new Error("模板中没有可导入的资产数据");
  if (records.length > 5000) throw new Error("最大数据行数不超过5000行");
  const usedIds = new Set(state.assets.map((asset) => asset.id));
  const errors = [];
  const assets = [];
  records.forEach(({ record, rowNumber }) => {
    try {
      assets.push(createImportedAsset(record, rowNumber, usedIds, file.name || "导入表格"));
    } catch (error) {
      errors.push(error.message);
    }
  });
  if (errors.length) {
    const preview = errors.slice(0, 5).join("；");
    throw new Error(errors.length > 5 ? `${preview}；还有 ${errors.length - 5} 个错误` : preview);
  }
  state.assets.unshift(...assets);
  state.selectedAssetIds = assets.map((asset) => asset.id);
  state.assetListPage = 1;
  saveAssets();
  render();
  return assets.length;
}

async function submitAssetImportForm(form) {
  const file = form._assetImportFile || form.querySelector("[data-asset-import-file]")?.files?.[0];
  if (!file) {
    setAssetImportStatus(form, "请先选择要导入的表格。", "error");
    showToast("请先选择要导入的表格");
    return false;
  }
  if (!/\.(xls|xlsx)$/i.test(file.name || "")) {
    setAssetImportStatus(form, "文件格式不正确，请上传 .xls 或 .xlsx。", "error");
    return false;
  }
  const kind = form.dataset.importKind || "asset";
  if (kind !== "asset") {
    setAssetImportStatus(form, "当前原型已支持资产新增导入，更新导入和领用导入仍为演示入口。", "error");
    return false;
  }
  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton?.textContent || "确定";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "导入中...";
  }
  setAssetImportStatus(form, "正在解析表格并写入资产台账...", "info");
  try {
    const count = await importAssetWorkbook(file);
    closeModal();
    showToast(`已导入 ${count} 条资产`);
    return true;
  } catch (error) {
    console.error(error);
    setAssetImportStatus(form, error?.message || "导入失败，请检查模板内容。", "error");
    showToast(error?.message || "导入失败，请检查模板内容");
    return false;
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}

function requiredLabel(label) {
  return `<span class="required-star">*</span>${label}`;
}

function formValue(form, name) {
  return String(new FormData(form).get(name) || "").trim();
}

function validateManagedAssetCategory(category) {
  if (assetCategoryFormOptions().includes(category)) return true;
  showToast("请选择资产分类中已启用的末级分类");
  return false;
}

function validateManagedAssetLocation(location, message = "请选择位置管理中的有效位置") {
  if (isManagedAssetLocation(location)) return true;
  showToast(locationValidationMessage(location) || message);
  return false;
}

function createAssetFromForm(form) {
  const category = formValue(form, "category");
  const id = formValue(form, "assetCode") || generateAssetCode(category);
  const name = formValue(form, "assetName");
  const purchaseDate = formValue(form, "purchaseDate");
  const owner = formValue(form, "personName");
  const condition = formValue(form, "condition");
  const receiveDate = owner ? formValue(form, "receiveDate") || todayValue() : "";
  const lifecycle = [[purchaseDate || todayValue(), "资产入库", "通过新增资产表单录入"]];
  if (owner) lifecycle.push([receiveDate, "资产领用", `${owner} 领用 ${name}`]);
  const asset = {
    id,
    name,
    category,
    type: category,
    model: formValue(form, "model"),
    sn: formValue(form, "serialNo"),
    owner: owner || "未分配",
    custodian: formValue(form, "custodian"),
    department: formValue(form, "department"),
    status: condition === "维修中" ? "维修中" : owner ? "在用" : "空闲",
    location: normalizeLocationValue(formValue(form, "location")),
    supplier: formValue(form, "supplier"),
    assetTag: "",
    tags: [],
    risk: "正常",
    completeness: 0,
    approvalRequired: false,
    price: Number(formValue(form, "price")) || 0,
    rent: Number(formValue(form, "rent")) || 0,
    purchaseDate,
    receiveDate,
    warrantyDate: "未设置",
    approval: "管理端直办",
    lifecycle,
    phone: formValue(form, "phone"),
    email: formValue(form, "email"),
    purchaseMethod: formValue(form, "purchaseMethod"),
    orderNo: formValue(form, "orderNo"),
    unit: formValue(form, "unit"),
    note: formValue(form, "note"),
    brand: formValue(form, "brand"),
    company: formValue(form, "company"),
    ownerCompany: formValue(form, "ownerCompany"),
    condition,
    usageMonths: formValue(form, "usageMonths"),
  };
  asset.completeness = calculateAssetCompleteness(asset);
  return normalizeSavedAsset(asset);
}

function saveCreatedAsset(form) {
  if (!validateManagedAssetCategory(formValue(form, "category"))) return false;
  if (!validateManagedAssetLocation(formValue(form, "location"))) return false;
  const asset = createAssetFromForm(form);
  if (state.assets.some((item) => item.id === asset.id)) {
    showToast("资产编码已存在，请修改后再提交");
    return false;
  }
  state.assets.unshift(asset);
  saveAssets();
  return asset;
}

function saveAssetReceiveForm(form) {
  const selected = getFlowSelectedAssets(form);
  if (!selected.length) {
    showToast("请先选择要领用的资产");
    return false;
  }
  const receiver = formValue(form, "receiver");
  const receiveDate = formValue(form, "receiveDate");
  const department = formValue(form, "department") || "默认部门";
  const company = formValue(form, "company") || "默认公司";
  const location = normalizeLocationValue(formValue(form, "receiveLocation"));
  const note = formValue(form, "receiveNote");
  if (!receiver || !receiveDate || !location) {
    showToast("请填写领用人、领用日期和领用后位置");
    return false;
  }
  if (!validateManagedAssetLocation(location, "请选择位置管理中的领用后位置")) return false;

  selected.forEach((asset) => {
    Object.assign(asset, {
      owner: receiver,
      department,
      company,
      location,
      status: "在用",
      receiveDate,
      note: note || asset.note,
    });
    asset.lifecycle = [
      ...(asset.lifecycle || []),
      [receiveDate, "资产领用", `${receiver} 领用 ${asset.name}`],
    ];
  });
  saveAssets();
  state.selectedAssetIds = [];
  return true;
}

function saveAssetReturnForm(form) {
  const selected = getFlowSelectedAssets(form);
  if (!selected.length) {
    showToast("请先选择要退库的资产");
    return false;
  }
  const returnDate = formValue(form, "returnDate");
  const company = formValue(form, "returnCompany") || "默认公司";
  const department = formValue(form, "returnDepartment") || "默认部门";
  const location = normalizeLocationValue(formValue(form, "returnLocation"));
  const operator = formValue(form, "operator");
  const note = formValue(form, "returnNote");
  if (!returnDate || !location || !operator) {
    showToast("请填写退库日期、退库后位置和经办人");
    return false;
  }
  if (!validateManagedAssetLocation(location, "请选择位置管理中的退库后位置")) return false;

  selected.forEach((asset) => {
    Object.assign(asset, {
      owner: "未分配",
      department,
      company,
      location,
      status: "空闲",
      returnDate,
      receiveDate: "",
      note: note || asset.note,
    });
    asset.lifecycle = [
      ...(asset.lifecycle || []),
      [returnDate, "资产退库", `${operator} 办理 ${asset.name} 退库`],
    ];
  });
  saveAssets();
  state.selectedAssetIds = [];
  return true;
}

function saveAssetBorrowForm(form) {
  const selected = getSelectedAssets();
  if (!selected.length) {
    showToast("请先选择要借用的资产");
    return false;
  }
  const borrower = formValue(form, "borrower");
  const borrowDate = formValue(form, "borrowDate");
  const expectedReturnDate = formValue(form, "expectedReturnDate");
  const company = formValue(form, "company") || "默认公司";
  const department = formValue(form, "department") || "默认部门";
  const location = normalizeLocationValue(formValue(form, "borrowLocation"));
  const note = formValue(form, "borrowNote");
  if (!borrower || !borrowDate || !location) {
    showToast("请填写借用人、借用日期、预计归还日期和借用后位置");
    return false;
  }
  if (!validateManagedAssetLocation(location, "请选择位置管理中的借用后位置")) return false;

  const expectedDateByAsset = new Map(
    Array.from(form.querySelectorAll("[data-borrow-return-date]")).map((input) => [input.dataset.borrowReturnDate, input.value || expectedReturnDate])
  );
  if (selected.some((asset) => !expectedDateByAsset.get(asset.id))) {
    showToast("请填写资产明细中的预计归还日期");
    return false;
  }

  selected.forEach((asset) => {
    const assetExpectedReturnDate = expectedDateByAsset.get(asset.id);
    Object.assign(asset, {
      owner: borrower,
      department,
      company,
      location,
      status: "借用中",
      borrowDate,
      expectedReturnDate: assetExpectedReturnDate,
      note: note || asset.note,
    });
    asset.lifecycle = [
      ...(asset.lifecycle || []),
      [borrowDate, "资产借用", `${borrower} 借用 ${asset.name}`],
    ];
  });
  saveAssets();
  state.selectedAssetIds = [];
  return true;
}

function saveAssetBorrowReturnForm(form) {
  const selected = getFlowSelectedAssets(form);
  if (!selected.length) {
    showToast("请先选择要归还的资产");
    return false;
  }
  const returnDate = formValue(form, "returnDate");
  const location = normalizeLocationValue(formValue(form, "returnLocation"));
  const operator = formValue(form, "operator");
  const note = formValue(form, "returnNote");
  if (!returnDate || !location || !operator) {
    showToast("请填写归还日期、归还后位置和经办人");
    return false;
  }
  if (!validateManagedAssetLocation(location, "请选择位置管理中的归还后位置")) return false;

  selected.forEach((asset) => {
    Object.assign(asset, {
      owner: "未分配",
      location,
      status: "空闲",
      returnDate,
      borrowDate: "",
      expectedReturnDate: "",
      note: note || asset.note,
    });
    asset.lifecycle = [
      ...(asset.lifecycle || []),
      [returnDate, "借用归还", `${operator} 办理 ${asset.name} 归还`],
    ];
  });
  saveAssets();
  state.selectedAssetIds = [];
  return true;
}

function saveAssetHandoverForm(form) {
  const selected = getFlowSelectedAssets(form);
  if (!selected.length) {
    showToast("请先选择要交接的资产");
    return false;
  }
  const handoverDate = formValue(form, "handoverDate");
  const handoverType = formValue(form, "handoverType") || "personal";
  const receiver = handoverType === "public" ? formValue(form, "receiver") || "公共区域" : formValue(form, "receiver");
  const company = formValue(form, "receiverCompany") || "默认公司";
  const department = formValue(form, "receiverDepartment") || "默认部门";
  const location = normalizeLocationValue(formValue(form, "receiverLocation"));
  const note = formValue(form, "handoverNote");
  if (!handoverDate || !location || (handoverType !== "public" && !receiver)) {
    showToast(handoverType === "public" ? "请填写接收位置和交接日期" : "请填写接收人、接收位置和交接日期");
    return false;
  }
  if (!validateManagedAssetLocation(location, "请选择位置管理中的接收位置")) return false;

  selected.forEach((asset) => {
    Object.assign(asset, {
      owner: receiver,
      company,
      department,
      location,
      status: "在用",
      handoverDate,
      handoverType: handoverType === "public" ? "公共交接" : "员工交接",
      note: note || asset.note,
    });
    asset.lifecycle = [
      ...(asset.lifecycle || []),
      [handoverDate, "资产交接", `${asset.name} ${handoverType === "public" ? "公共交接至" : "交接给"} ${receiver}`],
    ];
  });
  saveAssets();
  state.selectedAssetIds = [];
  return true;
}

function saveAssetEditForm(form) {
  const asset = state.assets.find((item) => item.id === form.dataset.assetId);
  if (!asset) return false;
  const condition = formValue(form, "condition");
  const category = formValue(form, "category");
  const location = normalizeLocationValue(formValue(form, "location"));
  const owner = formValue(form, "personName");
  const receiveDate = owner ? formValue(form, "receiveDate") || asset.receiveDate || todayValue() : "";
  if (category !== asset.category && !validateManagedAssetCategory(category)) return false;
  if (!validateManagedAssetLocation(location)) return false;
  Object.assign(asset, {
    owner: owner || "未分配",
    company: formValue(form, "company"),
    department: formValue(form, "department"),
    receiveDate,
    name: formValue(form, "assetName"),
    category,
    type: category,
    custodian: formValue(form, "custodian"),
    brand: formValue(form, "brand"),
    model: formValue(form, "model"),
    ownerCompany: formValue(form, "ownerCompany"),
    condition,
    location,
    price: Number(formValue(form, "price")) || 0,
    purchaseDate: formValue(form, "purchaseDate"),
    purchaseMethod: formValue(form, "purchaseMethod"),
    orderNo: formValue(form, "orderNo"),
    unit: formValue(form, "unit"),
    rent: Number(formValue(form, "rent")) || 0,
    note: formValue(form, "note"),
  });
  if (condition === "维修中") asset.status = "维修中";
  if (condition && condition !== "维修中") asset.status = owner ? "在用" : "空闲";
  asset.completeness = calculateAssetCompleteness(asset);
  saveAssets();
  return true;
}

function saveAssetBatchEditForm(form) {
  const selected = getSelectedAssets();
  if (!selected.length) {
    showToast("请先选择要批量修改的资产");
    return false;
  }
  const patch = {};
  ["company", "department", "condition", "location", "purchaseMethod"].forEach((key) => {
    const value = formValue(form, key);
    if (value) patch[key] = value;
  });
  const note = formValue(form, "note");
  if (note) patch.note = note;
  if (!Object.keys(patch).length) {
    showToast("请选择或填写要批量修改的内容");
    return false;
  }
  if (patch.location) {
    patch.location = normalizeLocationValue(patch.location);
    if (!validateManagedAssetLocation(patch.location)) return false;
  }
  selected.forEach((asset) => {
    Object.assign(asset, patch);
    if (patch.condition === "维修中") asset.status = "维修中";
    if (patch.condition && patch.condition !== "维修中" && asset.status === "维修中") asset.status = "空闲";
    asset.completeness = calculateAssetCompleteness(asset);
    asset.lifecycle = [...(asset.lifecycle || []), [todayValue(), "批量修改", "通过批量修改更新资产信息"]];
  });
  saveAssets();
  state.selectedAssetIds = [];
  return true;
}

function assetField(label, control, options = {}) {
  const { required = false, wide = false, full = false } = options;
  return `<div class="field ${wide ? "wide" : ""} ${full ? "full" : ""}">
    <label>${required ? requiredLabel(label) : label}</label>
    ${control}
  </div>`;
}

function assetCreateFormMarkup() {
  const user = state.currentUser;
  const admins = Array.from(
    new Set(
      [
        user?.roleCode !== "employee" ? user?.name : "",
        ...state.users.filter((item) => item.roleCode !== "employee").map((item) => item.name),
        ...uniqueAssetFormValues("custodian"),
      ].filter(Boolean)
    )
  );
  const categories = assetCategoryFormOptions();
  const locations = assetLocationOptions;

  return `<form id="demoForm" class="asset-create-form" data-mode="asset-create">
    <section class="asset-form-section">
      <div class="asset-form-section-head">
        <h3>使用信息</h3>
      </div>
      <div class="asset-form-grid">
        ${assetField(
          "人员姓名",
          `<div class="field-control has-icon"><input name="personName" placeholder="模糊搜索" autocomplete="off" /><span class="field-icon" aria-hidden="true">⌕</span></div>`
        )}
        ${assetField("使用公司", inlineSelect("company", "使用公司", defaultCompanyOptions, { required: true }), { required: true })}
        ${assetField("使用部门", inlineSelect("department", "使用部门", defaultDepartmentOptions))}
        ${assetField("领用/借用日期", `<input name="receiveDate" type="date" value="${todayValue()}" />`)}
      </div>
    </section>

    <section class="asset-form-section">
      <div class="asset-form-section-head">
        <h3>基本信息</h3>
        <button type="button" class="asset-template-link">选择模板</button>
      </div>
      <div class="asset-form-grid">
        ${assetField("资产编码", `<input name="assetCode" placeholder="未填写按自动编码规则生成" autocomplete="off" data-asset-code-input />`)}
        ${assetField("资产名称", `<input name="assetName" required placeholder="请输入" autocomplete="off" />`)}
        ${assetField("资产分类", inlineSelect("category", "资产分类", categories, { required: true, variant: "asset-category" }), { required: true })}
        ${assetField("管理员", inlineSelect("custodian", "管理员", admins, { required: true, selected: user?.roleCode !== "employee" ? user?.name : "" }), {
          required: true,
        })}
        ${assetField("品牌", `<input name="brand" required placeholder="请输入" autocomplete="off" />`, { required: true })}
        ${assetField("型号", `<input name="model" placeholder="请输入" autocomplete="off" />`)}
        ${assetField("所属/承租公司", inlineSelect("ownerCompany", "所属/承租公司", defaultCompanyOptions, { required: true }), { required: true })}
        ${assetField("资产状况", inlineSelect("condition", "请选择", assetConditionOptions, { required: true }), {
          required: true,
        })}
        ${assetField("所在位置", inlineSelect("location", "所在位置", locations, { required: true, variant: "location" }), { required: true })}
        ${assetField(
          "使用期限",
          `<div class="field-control has-unit"><input name="usageMonths" type="number" min="0" step="1" placeholder="请输入" data-category-useful-life-input /><span class="field-unit">月</span></div>`
        )}
        ${assetField(
          "金额",
          `<div class="field-control has-unit"><input name="price" type="number" min="0" step="1" placeholder="请输入" /><span class="field-unit">元</span></div>`
        )}
        ${assetField("购置/起租日期", `<input name="purchaseDate" required type="date" value="${todayValue()}" />`, {
          required: true,
        })}
        ${assetField("订单号", `<input name="orderNo" placeholder="请输入" autocomplete="off" />`)}
        ${assetField("计量单位", `<input name="unit" placeholder="请输入" value="台" autocomplete="off" data-category-unit-input />`)}
        ${assetField("购置方式", inlineSelect("purchaseMethod", "请选择", purchaseMethodOptions, { required: true }), { required: true })}
        ${assetField("备注", `<textarea name="note" placeholder="请输入"></textarea>`, { wide: true })}
        ${assetField(
          "租金",
          `<div class="field-control has-unit"><input name="rent" type="number" min="0" step="1" placeholder="请输入" /><span class="field-unit">元</span></div>`
        )}
      </div>
    </section>

    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">确定</button>
    </div>
  </form>`;
}

function formMarkup(type, asset = null, direct = false) {
  const user = state.currentUser;
  const approvalSystem = direct ? "管理端直办" : asset?.approval || "飞书审批";
  const hintText = direct
    ? "该动作将直接写入资产履历，保留操作日志，不创建外部审批实例。"
    : user?.roleCode === "employee"
      ? "普通员工默认通过申请流程发起业务单据，审批通过后再执行资产动作。"
      : "提交后创建飞书/泛微审批实例，审批通过后再执行资产动作。";

  return `<form id="demoForm" data-mode="${direct ? "direct" : "approval"}">
    <div class="approval-hint ${direct ? "direct" : ""}">
      <strong>${direct ? "管理端直办" : "外部审批模式"}</strong>
      <span>${hintText}</span>
    </div>
    <div class="form-grid">
      <div class="field"><label>业务类型</label><input value="${escapeHtml(type)}" /></div>
      <div class="field"><label>${direct ? "执行方式" : "审批系统"}</label><select><option>${approvalSystem}</option><option>泛微OA</option><option>钉钉审批</option></select></div>
      <div class="field"><label>${direct ? "操作人" : "申请人"}</label><input value="${escapeHtml(user?.name || "体验用户")}" /></div>
      <div class="field"><label>登录身份</label><input value="${escapeHtml(`${user?.account || "-"} / ${user?.roleName || "-"}`)}" /></div>
      <div class="field"><label>关联资产/物品</label><input value="${asset ? `${asset.id} · ${asset.name}` : ""}" placeholder="请选择资产、耗材或标准品" /></div>
      <div class="field"><label>期望日期</label><input type="date" value="${todayValue()}" /></div>
      <div class="field"><label>紧急程度</label><select><option>普通</option><option>紧急</option><option>低优先级</option></select></div>
      <div class="field"><label>外部身份</label><input value="${escapeHtml(state.session.method === "oidc" ? state.session.provider : "本地账号演示")}" /></div>
      <div class="field full"><label>${direct ? "操作说明" : "申请说明"}</label><textarea placeholder="${direct ? "填写直办原因，例如普通管理员盘点纠偏、紧急调拨、台账修正。" : "填写申请原因，提交后会创建外部审批实例。"}"></textarea></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">${direct ? "确认直办并留痕" : "提交模拟审批"}</button>
    </div>
  </form>`;
}

function openModal() {
  modal.classList.add("open");
  modalBackdrop.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  bindPlaceholderSelects(modal);
  bindInlineSelects(modal);
  bindAssetCodeInputs(modal);
  bindAssetFlowSelection(modal);
  bindAssetFlowActions(modal);
  bindHandoverModeControls(modal);
  bindAssetLabelPrintControls(modal);
  bindAssetImportControls(modal);
  bindLocationFormControls(modal);
  bindProfileCenterControls(modal);
  document.querySelector("[data-cancel-modal]")?.addEventListener("click", closeModal);
  document.querySelector("#demoForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const mode = form.dataset.mode;
    if (mode === "profile-center") {
      if (!saveProfileCenterForm(form)) return;
      closeModal();
      render();
      showToast("个人信息已保存");
      return;
    }
    if (mode === "role-definition") {
      if (!saveRoleDefinitionFromForm(modal)) return;
      closeModal();
      render();
      showToast("角色已保存");
      return;
    }
    if (mode === "role-user") {
      if (!saveRoleUserFromForm(form)) return;
      closeModal();
      render();
      showToast("管理员已新增");
      return;
    }
    if (mode === "role-user-edit") {
      if (!saveRoleUserEditForm(form)) return;
      closeModal();
      render();
      showToast("管理员信息已保存");
      return;
    }
    if (mode === "role-user-reset-password") {
      if (!saveRoleUserResetPasswordForm(form)) return;
      closeModal();
      render();
      showToast("密码已重置");
      return;
    }
    if (mode === "asset-create") {
      if (!validateInlineSelects(form)) return;
      const asset = saveCreatedAsset(form);
      if (!asset) return;
      closeModal();
      render();
      showToast(`已新增资产 ${asset.id}`);
      return;
    }
    if (mode === "asset-receive") {
      if (!validateInlineSelects(form) || !saveAssetReceiveForm(form)) return;
      closeModal();
      render();
      showToast("领用单已保存，资产状态已更新");
      return;
    }
    if (mode === "asset-return") {
      if (!validateInlineSelects(form) || !saveAssetReturnForm(form)) return;
      closeModal();
      render();
      showToast("退库单已保存，资产状态已更新");
      return;
    }
    if (mode === "asset-borrow") {
      if (!validateInlineSelects(form) || !saveAssetBorrowForm(form)) return;
      closeModal();
      render();
      showToast("借用单已保存，资产状态已更新");
      return;
    }
    if (mode === "asset-borrow-return") {
      if (!validateInlineSelects(form) || !saveAssetBorrowReturnForm(form)) return;
      closeModal();
      render();
      showToast("归还单已保存，资产状态已更新");
      return;
    }
    if (mode === "asset-handover") {
      if (!validateInlineSelects(form) || !saveAssetHandoverForm(form)) return;
      closeModal();
      render();
      showToast("交接单已保存，资产状态已更新");
      return;
    }
    if (mode === "asset-edit") {
      if (!validateInlineSelects(form)) return;
      if (!saveAssetEditForm(form)) return;
      closeModal();
      render();
      showToast("资产信息已保存");
      return;
    }
    if (mode === "asset-batch-edit") {
      if (!saveAssetBatchEditForm(form)) return;
      closeModal();
      render();
      showToast("批量修改已保存");
      return;
    }
    if (mode === "asset-import") {
      submitAssetImportForm(form);
      return;
    }
    if (mode === "location-create" || mode === "location-edit") {
      if (!commitLocationForm(form)) return;
      closeModal();
      render();
      showToast(mode === "location-edit" ? "位置已保存" : "位置已新增");
      return;
    }
    if (mode === "category-create" || mode === "category-edit") {
      if (!commitAssetCategoryForm(form)) return;
      closeModal();
      render();
      showToast(mode === "category-edit" ? "分类已保存" : "分类已新增");
      return;
    }
    const direct = mode === "direct" || modalTitle.textContent.includes("直办");
    const result = form.dataset.result;
    closeModal();
    showToast(result || (direct ? "已模拟管理端直办，资产履历已留痕" : "已模拟创建单据，并发起外部审批"));
  });
  document.querySelector("[data-download-template]")?.addEventListener("click", (event) => {
    showToast(`已模拟下载 ${event.currentTarget.dataset.downloadTemplate}`);
  });
  document.querySelector("[data-print-current]")?.addEventListener("click", () => {
    window.print();
    showToast("已打开打印预览");
  });
}

function bindAssetFlowSelection(root) {
  root.querySelectorAll(".asset-flow-table").forEach((table) => {
    const selectAll = table.querySelector("[data-flow-select-all]");
    const rowChecks = Array.from(table.querySelectorAll("[data-flow-row-select]"));
    if (!selectAll || !rowChecks.length) return;

    const syncSelectAll = () => {
      const checkedCount = rowChecks.filter((item) => item.checked).length;
      selectAll.checked = checkedCount === rowChecks.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < rowChecks.length;
    };

    selectAll.addEventListener("change", () => {
      rowChecks.forEach((item) => {
        item.checked = selectAll.checked;
      });
      selectAll.indeterminate = false;
    });

    rowChecks.forEach((item) => item.addEventListener("change", syncSelectAll));
    syncSelectAll();
  });
}

function rerenderFlowAssetSection(form, assets) {
  const mode = form.dataset.mode;
  const title = mode === "asset-receive" ? "资产详情" : "资产明细";
  const options = mode === "asset-borrow" ? { expectedReturnDateColumn: true, defaultExpectedReturnDate: todayValue() } : {};
  const oldSection = form.querySelector(".asset-flow-section:last-of-type");
  oldSection.outerHTML = assetFlowDetailSection(assets, title, options);
  bindAssetFlowSelection(form);
  bindAssetFlowActions(form);
}

function bindAssetFlowActions(root) {
  root.querySelector("[data-keep-modal]")?.addEventListener("click", openAssetPicker);
  root.querySelector("[data-remove-flow-assets]")?.addEventListener("click", () => {
    const form = root.querySelector("#demoForm") || root;
    const checkedIds = Array.from(form.querySelectorAll("[data-flow-row-select]:checked")).map((input) => input.dataset.flowRowSelect);
    if (!checkedIds.length) {
      showToast("请先勾选要删除的资产");
      return;
    }
    state.selectedAssetIds = state.selectedAssetIds.filter((id) => !checkedIds.includes(id));
    rerenderFlowAssetSection(form, getSelectedAssets());
  });
}

function applyHandoverMode(form) {
  const type = form.querySelector('input[name="handoverType"]:checked')?.value || "personal";
  const receiverInput = form.querySelector('input[name="receiver"]');
  const receiverLabel = receiverInput?.closest(".field")?.querySelector("label");
  const isPublic = type === "public";
  form.querySelectorAll(".handover-mode-option").forEach((label) => {
    label.classList.toggle("active", label.querySelector("input")?.value === type);
  });
  form.querySelectorAll("[data-handover-personal]").forEach((field) => {
    field.hidden = isPublic;
    field.querySelectorAll("input, select, textarea, button").forEach((control) => {
      control.disabled = isPublic;
    });
  });
  if (!receiverInput) return;
  if (isPublic) {
    receiverInput.value = "公共区域";
    receiverInput.readOnly = true;
    receiverInput.dataset.lockedField = "true";
    receiverInput.required = false;
    receiverInput.placeholder = "公共区域";
    if (receiverLabel) receiverLabel.innerHTML = "接收对象：";
  } else {
    if (receiverInput.value === "公共区域") receiverInput.value = "";
    receiverInput.readOnly = false;
    delete receiverInput.dataset.lockedField;
    receiverInput.required = true;
    receiverInput.placeholder = "模糊搜索";
    if (receiverLabel) receiverLabel.innerHTML = '<span class="required-star">*</span>接收人：';
  }
  bindInlineSelects(form);
}

function bindHandoverModeControls(root) {
  const form = root.querySelector?.(".handover-flow-form");
  if (!form || form.dataset.handoverModeBound === "true") return;
  form.dataset.handoverModeBound = "true";
  applyHandoverMode(form);
  form.querySelectorAll('input[name="handoverType"]').forEach((input) =>
    input.addEventListener("change", () => applyHandoverMode(form))
  );
}

function closeModal() {
  closeAssetPicker();
  document.body.classList.remove("printing-asset-labels");
  modal.classList.remove("open");
  modal.classList.remove("asset-create-modal");
  modal.classList.remove("asset-flow-modal");
  modal.classList.remove("asset-import-modal");
  modal.classList.remove("print-preview-modal");
  modal.classList.remove("asset-label-print-modal");
  modal.classList.remove("default-label-editor-modal");
  modal.classList.remove("location-modal");
  modal.classList.remove("role-modal");
  modal.classList.remove("role-user-modal");
  modalBackdrop.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

drawerClose.addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);
modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);

window.addEventListener("resize", syncNavIndicator);
window.addEventListener("afterprint", () => {
  document.body.classList.remove("printing-asset-labels");
});
window.addEventListener("hashchange", () => {
  if (!isAuthenticated()) return;
  const route = normalizeRoute(routeFromHash());
  if (!route || route === state.route || !routeAllowed(route)) return;
  state.route = route;
  persistRoute(route);
  saveLocalSession();
  render();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-account-menu]")) {
    closeAccountMenus();
  }
  if (!event.target.closest("[data-inline-select]")) {
    closeAllInlineSelects();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (assetPickerState) {
      closeAssetPicker();
      return;
    }
    closeAccountMenus();
    closeAllInlineSelects();
    closeDrawer();
    closeModal();
  }
});

["pointerdown", "keydown", "scroll", "touchstart"].forEach((eventName) => {
  window.addEventListener(eventName, touchSessionActivity, { passive: true });
});

async function bootApp() {
  const loadedSharedStore = await loadSharedStore();
  if (loadedSharedStore) applySharedStoreState();
  migrateAssetLocations();
  if (loadedSharedStore) seedSharedStoreFromLocalStorage();
  const restored = await hydrateBackendSession();
  if (!restored) restoreLocalSession();
  render();
}

bootApp();
