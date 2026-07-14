// @ts-nocheck
const selfServiceSettingsStorageKey = "assetPortalSelfServiceSettingsV9";
const assetCodeRuleStorageKey = "assetPortalAssetCodeRuleSettingsV1";
const sharedStoreKeys = [
  "assetLabelPrintSettingsV2",
  "assetLabelCustomTemplatesV1",
  "assetCategoryTree",
  "assetCategoryTreeVersion",
  "assetLocationTree",
  assetCodeRuleStorageKey,
  selfServiceSettingsStorageKey,
];
let sharedStoreLoaded = false;
const selfServiceNoticeContentLimit = 500;

function ecpSessionHeaders(headers = {}) {
  const token = String(readEcpContext()?.session?.sessionToken || "").trim();
  return token ? { ...headers, authorization: `Bearer ${token}` } : headers;
}

let ecpDirectoryUsers = [];
let systemIntegrations = [];
let systemForms = [];
let assetOperationRecords = [];

async function systemConfigApiRequest(path, options = {}) {
  const method = options.method || "GET";
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    method,
    cache: method === "GET" ? "no-store" : undefined,
    headers: ecpSessionHeaders(hasBody ? { "content-type": "application/json; charset=utf-8" } : {}),
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error || payload?.message || payload?.detail || payload?.title;
    const error = new Error(message || `系统配置请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function hydrateSystemIntegrations() {
  try {
    const payload = await systemConfigApiRequest("/api/system/integrations");
    systemIntegrations = Array.isArray(payload?.items) ? payload.items : [];
    return true;
  } catch (error) {
    console.warn("[asset-portal] system integrations unavailable", error);
    systemIntegrations = [];
    return false;
  }
}

async function hydrateSystemForms() {
  try {
    const payload = await systemConfigApiRequest("/api/system/forms");
    systemForms = Array.isArray(payload?.items) ? payload.items : [];
    return true;
  } catch (error) {
    console.warn("[asset-portal] system forms unavailable", error);
    systemForms = [];
    return false;
  }
}

async function hydrateSystemConfigs() {
  await Promise.all([hydrateSystemIntegrations(), hydrateSystemForms()]);
}

function currentDirectoryUser() {
  const user = readEcpContext()?.getUser?.() || state?.currentUser;
  const subject = String(user?.externalSubject || "").replace(/^ecp:/, "").trim() || String(user?.account || "").trim();
  if (!subject) return null;
  return {
    subject,
    name: user?.name || user?.account || subject,
    company: user?.company || "",
    department: user?.department || "",
  };
}

async function hydrateEcpDirectoryUsers() {
  const fallback = currentDirectoryUser();
  try {
    const loadPage = async (page) => {
      const response = await fetch(`/api/ecp/directory/users?page=${page}&size=100`, {
        cache: "no-store",
        headers: ecpSessionHeaders(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    };
    const firstPage = await loadPage(1);
    const totalPages = Math.min(Math.max(Number(firstPage.totalPages) || 1, 1), 20);
    const remainingPages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) => loadPage(index + 2))
    );
    const items = [firstPage, ...remainingPages].flatMap((page) => Array.isArray(page.items) ? page.items : []);
    ecpDirectoryUsers = items
      .map((user) => ({
        subject: String(user.subject || "").trim(),
        name: String(user.name || "").trim(),
        employeeNo: String(user.employeeNo || "").trim(),
        jobTitle: String(user.jobTitle || "").trim(),
        status: String(user.status || "").trim(),
        company: String(user.company?.name || "").trim(),
        department: String(user.departments?.[0]?.name || "").trim(),
        departments: Array.isArray(user.departments)
          ? user.departments.map((department) => ({
              id: String(department.unionId || department.externalId || "").trim(),
              name: String(department.name || "").trim(),
              path: String(department.path || department.name || "").trim(),
            })).filter((department) => department.name)
          : [],
      }))
      .filter((user) => user.subject && user.name);
  } catch (error) {
    console.warn("[asset-portal] ECP directory unavailable", error);
    ecpDirectoryUsers = [];
  }
  if (fallback && !ecpDirectoryUsers.some((user) => user.subject === fallback.subject)) {
    ecpDirectoryUsers.unshift(fallback);
  }
}

function directoryUserBySubject(subject) {
  const normalized = String(subject || "").trim();
  return ecpDirectoryUsers.find((user) => user.subject === normalized) || null;
}

function directoryUserByName(name) {
  const normalized = String(name || "").trim();
  const matches = ecpDirectoryUsers.filter((user) => user.name === normalized);
  return matches.length === 1 ? matches[0] : null;
}

function directoryPersonSelect(name, selectedSubject = "", required = true) {
  const options = ecpDirectoryUsers.map((user) => {
    const context = [user.department, user.company].filter(Boolean).join(" / ");
    const label = context ? `${user.name} - ${context}` : user.name;
    return `<option value="${escapeHtml(user.subject)}" ${user.subject === selectedSubject ? "selected" : ""}>${escapeHtml(label)}</option>`;
  });
  return `<select name="${escapeHtml(name)}" ${required ? "required" : ""}>
    <option value="">请选择 ECP 账号</option>
    ${options.join("")}
  </select>`;
}

function isSharedStoreKey(key) {
  return sharedStoreKeys.includes(key);
}

const portalConfigWritePaths = {
  assetCategoryTree: "/api/config/catalog/categories",
  assetCategoryTreeVersion: "/api/config/catalog/category-version",
  assetLocationTree: "/api/config/catalog/locations",
  assetPortalAssetCodeRuleSettingsV1: "/api/config/settings/asset-code",
  assetPortalSelfServiceSettingsV9: "/api/config/settings/self-service",
};

async function loadSharedStore() {
  try {
    const response = await fetch("/api/store", { cache: "no-store", headers: ecpSessionHeaders() });
    if (!response.ok) return false;
    const data = await response.json();
    const values = data.values && typeof data.values === "object" ? data.values : {};
    sharedStoreKeys.forEach((key) => localStorage.removeItem(key));
    Object.entries(values).forEach(([key, value]) => {
      if (!isSharedStoreKey(key)) return;
      if (value === undefined) return;
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    });
    sharedStoreLoaded = true;
    return true;
  } catch (error) {
    console.warn("[asset-portal] shared store unavailable", error);
    return false;
  }
}

function saveSharedStoreItem(key, value, operation = "") {
  if (!isSharedStoreKey(key)) return Promise.resolve();
  const configPath = portalConfigWritePaths[key];
  return fetch(configPath || "/api/store", {
    method: configPath ? "PUT" : "POST",
    headers: ecpSessionHeaders({ "content-type": "application/json; charset=utf-8" }),
    body: JSON.stringify(configPath ? { value } : { operation, key, value }),
  }).then(async (response) => {
    if (response.ok) return;
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `配置保存失败（HTTP ${response.status}）`);
  }).catch((error) => {
    console.warn("[asset-portal] shared store save failed", key, error);
    showToast(error?.message || "配置保存失败");
    throw error;
  });
}

function saveSharedLocalStorage(key, value, operation = "") {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return saveSharedStoreItem(key, value, operation)
    .then(() => {
      localStorage.setItem(key, serialized);
      return true;
    })
    .catch(async () => {
      const loaded = await loadSharedStore();
      if (loaded) applySharedStoreState();
      if (typeof render === "function") render();
      return false;
    });
}

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
  state.assetCodeRuleSettings = loadAssetCodeRuleSettings();
  state.assetLabelSettings = loadAssetLabelSettings();
  state.selfServiceSettings = loadSelfServiceSettings();
  state.selectedAssetIds = state.selectedAssetIds.filter((id) => state.assets.some((asset) => asset.id === id));
}

const assetCategoryOptions = ["终端设备", "基础设施", "办公外设", "网络设备", "软件与许可", "耗材", "其他"];
const assetCategoryTreeStorageVersion = "20260617-reference-category-v1";
const defaultAssetCategoryTree = [];
const defaultAssetLocationTree = [];
let assetLocationTree = loadAssetLocationTree();
let assetLocationOptions = buildAssetLocationOptions(assetLocationTree);
let assetCategoryTree = loadAssetCategoryTree();
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
  if (!sharedStoreLoaded) return [];
  try {
    if (localStorage.getItem("assetCategoryTreeVersion") !== assetCategoryTreeStorageVersion) {
      return normalizeAssetCategoryTree(defaultAssetCategoryTree);
    }
    return normalizeAssetCategoryTree(JSON.parse(localStorage.getItem("assetCategoryTree") || "null"));
  } catch {
    return normalizeAssetCategoryTree(defaultAssetCategoryTree);
  }
}

async function saveAssetCategoryTree() {
  await saveSharedStoreItem("assetCategoryTree", assetCategoryTree);
  localStorage.setItem("assetCategoryTree", JSON.stringify(assetCategoryTree));
  localStorage.setItem("assetCategoryTreeVersion", assetCategoryTreeStorageVersion);
  await hydrateAssetsFromServer();
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
  if (!sharedStoreLoaded) return defaultAssetCodeRuleSettings();
  try {
    return normalizeAssetCodeRuleSettings(JSON.parse(localStorage.getItem(assetCodeRuleStorageKey) || "null") || defaultAssetCodeRuleSettings());
  } catch {
    return defaultAssetCodeRuleSettings();
  }
}

function saveAssetCodeRuleSettings() {
  return saveSharedLocalStorage(assetCodeRuleStorageKey, state.assetCodeRuleSettings);
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
  if (!sharedStoreLoaded) {
    const unavailable = defaultSelfServiceSettings();
    ["receiveAsset", "borrowAsset", "giveBackAsset", "handoverAsset", "returnAsset", "deviceRequest"]
      .forEach((key) => { unavailable[key].enabled = false; });
    return unavailable;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(selfServiceSettingsStorageKey) || "null");
    return normalizeSelfServiceSettings(saved || defaultSelfServiceSettings());
  } catch {
    return defaultSelfServiceSettings();
  }
}

function saveSelfServiceSettings() {
  return saveSharedLocalStorage(selfServiceSettingsStorageKey, state.selfServiceSettings);
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

function assetReferencesCategoryNames(names) {
  const targets = new Set(names.filter(Boolean));
  return state.assets.filter((asset) => targets.has(asset.category));
}

function assetReferencesLocationPaths(paths) {
  const targets = new Set(paths.filter(Boolean));
  return state.assets.filter((asset) => targets.has(normalizeLocationValue(asset.location)));
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
  if (!sharedStoreLoaded) return [];
  try {
    return normalizeLocationHierarchy(JSON.parse(localStorage.getItem("assetLocationTree") || "null"));
  } catch {
    return normalizeLocationHierarchy(defaultAssetLocationTree);
  }
}

async function saveAssetLocationTree() {
  await saveSharedStoreItem("assetLocationTree", assetLocationTree);
  localStorage.setItem("assetLocationTree", JSON.stringify(assetLocationTree));
  await hydrateAssetsFromServer();
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

function worksheetXml(rows, widths = [16, 18, 24, 28]) {
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
    sheet: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols>${widths
      .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
      .join("")}</cols><sheetData>${rowXml}</sheetData></worksheet>`,
  };
}

async function buildXlsxBlob(data, widths) {
  if (!window.JSZip) throw new Error("Excel 组件未加载");
  const zip = new window.JSZip();
  const { strings, sheet } = worksheetXml(data, widths);
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  zip.folder("xl").folder("worksheets").file("sheet1.xml", sheet);
  zip.folder("xl").file("sharedStrings.xml", sharedStringXml(strings));
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function buildLocationWorkbookBlob(rows) {
  const data = [
    ["验证结果", "位置编码", "位置名称*", "上级位置名称"],
    ["请勿填写", "非必填项，不可重复", "必填项，不可重复", "①请确保上级名称在系统或表格内已存在\n②若新建一级位置，此项为空"],
    ...rows.map((row) => [row.result || "", row.code || "", row.name || "", row.parent || ""]),
  ];
  return buildXlsxBlob(data, [16, 18, 24, 28]);
}

async function readLocationWorkbookRows(file) {
  if (!window.JSZip) throw new Error("Excel 组件未加载");
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
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

async function applyImportedLocationRows(rows) {
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
  await saveAssetLocationTree();
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
  const count = await applyImportedLocationRows(rows);
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
  const requiredPermission = {
    template: "asset:location_settings:template",
    import: "asset:location_settings:import",
    export: "asset:location_settings:export",
  }[action];
  if (!requiredPermission || !ensureAnyPermission([requiredPermission])) return;
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

function handleLocationImportFile(file) {
  if (!ensureAnyPermission(["asset:location_settings:import"])) return;
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
  { key: "code", label: "资产编码", width: 112, minWidth: 82, render: (item) => `<button class="link" data-detail="${escapeHtml(item.id)}">${escapeHtml(item.id)}</button>` },
  { key: "name", label: "资产名称", width: 118, minWidth: 78, render: (item) => escapeHtml(item.name) },
  { key: "category", label: "资产分类", width: 92, minWidth: 62, render: (item) => escapeHtml(item.category) },
  { key: "phone", label: "手机号", width: 92, minWidth: 68, render: (item) => escapeHtml(item.phone || "-") },
  { key: "email", label: "电子邮箱", width: 118, minWidth: 82, render: (item) => escapeHtml(item.email || "-") },
  { key: "date", label: "领用日期", width: 90, minWidth: 70, render: (item) => escapeHtml(item.receiveDate || "-") },
  { key: "location", label: "所在位置", width: 92, minWidth: 64, render: (item) => escapeHtml(item.location || "-") },
  { key: "price", label: "金额", width: 64, minWidth: 48, render: (item) => escapeHtml(item.price) },
  { key: "purchase", label: "购置方式", width: 82, minWidth: 58, render: (item) => escapeHtml(item.purchaseMethod || "-") },
  { key: "rent", label: "租金", width: 56, minWidth: 42, render: (item) => escapeHtml(item.rent || 0) },
  { key: "supplier", label: "供应商", width: 104, minWidth: 68, render: (item) => escapeHtml(item.supplier || "-") },
  { key: "owner", label: "使用人", width: 78, minWidth: 54, render: (item) => escapeHtml(item.owner) },
  { key: "usage", label: "使用信息", width: 110, minWidth: 72, render: (item) => `${escapeHtml(item.status)} / ${escapeHtml(item.department)}` },
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
  if (!sharedStoreLoaded) return [];
  try {
    const saved = JSON.parse(localStorage.getItem(assetLabelCustomTemplateStorageKey) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.map(normalizeAssetLabelCustomTemplate).filter(Boolean);
  } catch {
    return [];
  }
}

function assetLabelCustomTemplatesSnapshot() {
  return assetLabelTemplates
    .filter((template) => template.custom)
    .map((template) => ({
      key: template.key,
      name: template.name,
      baseTemplateKey: template.baseTemplateKey,
      sampleLayout: template.sampleLayout,
      previewMode: template.previewMode,
      settings: template.settings,
    }));
}

function saveAssetLabelCustomTemplates(operation) {
  return saveSharedLocalStorage(assetLabelCustomTemplateStorageKey, assetLabelCustomTemplatesSnapshot(), operation);
}

async function persistAssetLabelTemplateSettings(settings) {
  if (!settings) return true;
  const template = assetLabelTemplates.find((item) => item.key === settings?.templateKey);
  if (!template?.custom) return true;
  const nextSettings = assetLabelTemplatePersistedSettings(settings);
  if (JSON.stringify(template.settings) === JSON.stringify(nextSettings)) return true;
  template.settings = nextSettings;
  return saveAssetLabelCustomTemplates("update");
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

async function createAssetLabelCustomTemplate(settings = state.assetLabelSettings) {
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
  if (!(await saveAssetLabelCustomTemplates("create"))) return null;
  state.assetLabelSettings = normalizeAssetLabelSettings({ ...customTemplate.settings, templateKey: key });
  return customTemplate;
}

async function deleteAssetLabelCustomTemplate(templateKey) {
  const index = assetLabelTemplates.findIndex((template) => template.key === templateKey && template.custom);
  if (index === -1) return null;
  const [removed] = assetLabelTemplates.splice(index, 1);
  if (!(await saveAssetLabelCustomTemplates("delete"))) return null;
  const fallbackKey = assetLabelTemplates.some((template) => template.key === removed.baseTemplateKey) ? removed.baseTemplateKey : "standard";
  state.assetLabelSettings = normalizeAssetLabelSettings(assetLabelTemplateDefaults(fallbackKey));
  return removed;
}

function loadAssetLabelSettings() {
  if (!sharedStoreLoaded) return defaultAssetLabelSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(assetLabelStorageKey) || "null");
    return normalizeAssetLabelSettings(saved || defaultAssetLabelSettings());
  } catch {
    return defaultAssetLabelSettings();
  }
}

async function saveAssetLabelSettings(operation = "save", options = {}) {
  if (options.updateCustomTemplate && !(await persistAssetLabelTemplateSettings(state.assetLabelSettings))) return false;
  return saveSharedLocalStorage(assetLabelStorageKey, state.assetLabelSettings, operation);
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
  return value;
}

function normalizeSavedAsset(asset = {}) {
  const id = String(asset.id || "").trim();
  if (!id) throw new Error("Java 资产接口返回了无效的空资产编号");
  return {
    id,
    name: asset.name || "未命名资产",
    category: asset.category || "其他",
    type: asset.type || asset.category || "其他",
    model: asset.model || "",
    sn: asset.sn || "",
    owner: asset.owner || "未分配",
    ownerSubject: asset.ownerSubject || "",
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

async function executeAssetCommand(action, assetIds, fields = {}) {
  const response = await fetch(`/api/assets/commands/${encodeURIComponent(action)}`, {
    method: "POST",
    headers: ecpSessionHeaders({ "content-type": "application/json; charset=utf-8" }),
    body: JSON.stringify({ assetIds, fields }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `资产操作失败（HTTP ${response.status}）`);
  const changed = new Map((result.items || []).map((item) => [item.id, normalizeSavedAsset(item)]));
  state.assets = action === "cancel-inbound"
    ? state.assets.filter((item) => !changed.has(item.id))
    : state.assets.map((item) => changed.get(item.id) || item);
  await hydrateAssetOperationsFromServer();
  return result.items || [];
}

async function createAssetCommand(item, sourceAssetId = "") {
  const response = await fetch("/api/assets", {
    method: "POST",
    headers: ecpSessionHeaders({ "content-type": "application/json; charset=utf-8" }),
    body: JSON.stringify({ item, sourceAssetId }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `资产新增失败（HTTP ${response.status}）`);
  const created = normalizeSavedAsset(result.item);
  state.assets.unshift(created);
  await hydrateAssetOperationsFromServer();
  return created;
}

async function hydrateAssetOperationsFromServer() {
  const records = [];
  const pageSize = 500;
  const maximumPages = 20;
  try {
    for (let page = 1; page <= maximumPages; page += 1) {
      const response = await fetch(`/api/asset-operations?page=${page}&size=${pageSize}`, {
        cache: "no-store",
        headers: ecpSessionHeaders(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const items = Array.isArray(payload.items) ? payload.items : [];
      records.push(...items);
      if (records.length >= Number(payload.total || 0) || items.length < pageSize) break;
    }
    assetOperationRecords = records;
    return true;
  } catch (error) {
    console.warn("[asset-portal] Java asset operation API unavailable", error);
    assetOperationRecords = [];
    return false;
  }
}

async function hydrateAssetsFromServer() {
  try {
    const response = await fetch("/api/assets", { cache: "no-store", headers: ecpSessionHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items.map(normalizeSavedAsset) : [];
    state.assets = items;
    await hydrateAssetOperationsFromServer();
    return true;
  } catch (error) {
    console.warn("[asset-portal] Java asset API unavailable", error);
    state.assets = [];
    assetOperationRecords = [];
    return false;
  }
}

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

const terminalModeStorageKey = "assetPortalTerminalMode";

function loadTerminalMode() {
  try {
    return localStorage.getItem(terminalModeStorageKey) === "employee" ? "employee" : "management";
  } catch {
    return "management";
  }
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
  systemMenu: "员工信息",
  selfServiceMenu: "员工自助管理",
  selfServiceSignOpen: false,
  selfServiceCategoryExpanded: {},
  navOpen: {},
  assetSubnavScrollTop: 0,
  assetDistributionMode: "organization",
  assetCategoryMetricMode: "count",
  assetCategoryCompanyFilter: "所属/承租公司",
  employeeRequestTab: "all",
  employeeRequestActiveType: "资产领用",
  locationTreeOpen: {},
  assetCategoryTreeOpen: {},
  locationImportBusy: false,
  assetCategoryImportBusy: false,
  locationSettingsQuery: "",
  terminalMode: loadTerminalMode(),
  currentUser: null,
  session: {
    authenticated: false,
    method: "ecp",
    provider: "ECP统一认证",
    lastLoginAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  },
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
  assets: [],
  requests: [],
  stocktakes: [],
  consumables: [],
  repairs: [],
  contracts: [],
};

const businessDataVersions = {};
const persistedBusinessDataTypes = ["requests", "stocktakes", "consumables", "repairs", "contracts"];

function businessDataItems(type) {
  return Array.isArray(state[type]) ? state[type] : [];
}

async function fetchBusinessData() {
  const response = await fetch("/api/business-data", { cache: "no-store", headers: ecpSessionHeaders() });
  if (!response.ok) throw new Error(`业务数据加载失败（HTTP ${response.status}）`);
  return response.json();
}

async function hydrateBusinessData() {
  try {
    const payload = await fetchBusinessData();
    const values = payload.values && typeof payload.values === "object" ? payload.values : {};
    const versions = payload.versions && typeof payload.versions === "object" ? payload.versions : {};
    for (const type of persistedBusinessDataTypes) {
      state[type] = Array.isArray(values[type]) ? values[type] : [];
      businessDataVersions[type] = Number(versions[type]) || 0;
    }
    return true;
  } catch (error) {
    console.warn("[asset-portal] business data API unavailable", error);
    for (const type of persistedBusinessDataTypes) {
      state[type] = [];
      businessDataVersions[type] = 0;
    }
    return false;
  }
}


async function createBusinessRequest(draft) {
  if (!ensureAnyPermission(["asset:request:create"])) return null;
  try {
    const response = await fetch("/api/business-data/requests", {
      method: "POST",
      headers: ecpSessionHeaders({ "content-type": "application/json; charset=utf-8" }),
      body: JSON.stringify({
        type: draft.type,
        applicant: draft.applicant,
        asset: draft.asset,
        reason: draft.reason,
        details: draft,
      }),
    });
    const errorPayload = response.ok ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorPayload?.error || `申请创建失败（HTTP ${response.status}）`);
    const created = await response.json();
    const item = { ...draft, ...created.item };
    state.requests.unshift(item);
    businessDataVersions.requests = Number(created.version) || businessDataVersions.requests;
    render();
    return item;
  } catch (error) {
    showToast(error?.message || "申请创建失败");
    return null;
  }
}

async function submitAdHocBusinessRequest(form) {
  if (!ensureAnyPermission(["asset:request:create"])) return null;
  const data = new FormData(form);
  const draft = {
    type: String(data.get("businessType") || "新建申请"),
    applicant: state.currentUser?.name || "",
    asset: String(data.get("asset") || "未指定物品"),
    reason: String(data.get("reason") || ""),
  };
  const response = await fetch("/api/business-data/requests", {
    method: "POST",
    headers: ecpSessionHeaders({ "content-type": "application/json; charset=utf-8" }),
    body: JSON.stringify(draft),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `申请创建失败（HTTP ${response.status}）`);
  state.requests.unshift(result.item);
  businessDataVersions.requests = Number(result.version) || businessDataVersions.requests;
  return result.item;
}

async function runBusinessCommand(path, method, payload, type) {
  const response = await fetch(`/api/business-data/${path}`, {
    method,
    headers: ecpSessionHeaders({ "content-type": "application/json; charset=utf-8" }),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `业务操作失败（HTTP ${response.status}）`);
  if (result.item) state[type] = [result.item, ...businessDataItems(type)];
  if (Array.isArray(result.items)) state[type] = result.items;
  businessDataVersions[type] = Number(result.version) || businessDataVersions[type] || 0;
  return result;
}

const assetSettingSections = [
  {
    id: "assetLocationSettings",
    permissionCode: "asset:location_settings:view",
    label: "位置管理",
    metric: `${assetLocationOptions.length} 个位置`,
    description: "维护公司、仓库、楼层等资产存放位置。",
  },
  {
    id: "assetCategorySettings",
    permissionCode: "asset:category_settings:view",
    label: "资产分类",
    metric: `${flattenAssetCategoryTree().length} 个分类`,
    description: "维护资产大类、默认字段和分类启用状态。",
  },
  {
    id: "assetCodeRules",
    permissionCode: "asset:code_rules:view",
    label: "资产编码规则",
    metric: "自动编号",
    description: "配置资产编码前缀、流水号位数和生成规则。",
  },
  {
    id: "assetLabelTemplateSettings",
    permissionCode: "asset:label_template_settings:view",
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
  },
  {
    id: "assets",
    label: "资产",
    icon: assetNavIcon,
    landingRoute: "assets",
    children: [
      { id: "assets", label: "资产列表" },
      { id: "assetInbound", label: "资产入库" },
      { id: "assetReceiveReturn", label: "领用退库" },
      { id: "assetBorrowReturn", label: "借用归还" },
      { id: "stocktake", label: "资产盘点" },
      { id: "consumables", label: "耗材库存" },
      { id: "repair", label: "故障维修" },
      { id: "contracts", label: "合同供应商" },
      {
        id: "assetSettings",
        label: "资产设置",
        landingRoute: "assetLocationSettings",
        children: assetSettingSections.map((section) => ({
          id: section.id,
          label: section.label,
        })),
      },
    ],
  },
  {
    id: "requests",
    label: "审批",
    icon: approvalNavIcon,
  },
  {
    id: "settings",
    label: "系统",
    icon: systemNavIcon,
  },
  {
    id: "authz.workspace",
    label: "账号管理",
    icon: systemNavIcon,
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
const toast = document.querySelector("#toast");
let searchRenderTimer = null;
let toastTimer = null;
let assetPickerState = null;
let assetLabelPreviewAssets = [];

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
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeCssString(value = "") {
  return String(value)
    .replaceAll("\\", "\\5c ")
    .replaceAll("'", "\\27 ")
    .replaceAll('"', "\\22 ")
    .replaceAll("\r", "\\d ")
    .replaceAll("\n", "\\a ")
    .replaceAll("\f", "\\c ");
}

function cssEscape(value = "") {
  return window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replaceAll('"', '\\"');
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function dateOffsetValue(days = 0) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
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
  return `<span class="${escapeHtml(className)} avatar" ${src ? `style="background-image:url('${escapeHtml(escapeCssString(src))}')"` : ""}>${src ? "" : escapeHtml(label)}</span>`;
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
  return `<span class="tag ${map[status] || "gray"}">${escapeHtml(status)}</span>`;
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
    .map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`)
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

function readEcpContext() {
  return window.__ASSET_PORTAL_ECP_CONTEXT__ || null;
}

function isEcpAuthEnabled() {
  return Boolean(readEcpContext()?.enabled);
}

function normalizeEcpPortalUserPayload() {
  const context = readEcpContext();
  const rawUser = context?.getUser?.() || context?.user;
  if (!rawUser) return null;
  const account = String(rawUser.account || rawUser.email || rawUser.externalSubject || "ecp.user").trim();
  if (!account) return null;
  return {
    name: rawUser.name || account,
    account,
    phone: rawUser.phone || "",
    email: rawUser.email || "",
    department: rawUser.department || "ECP组织",
    company: rawUser.company || rawUser.companyName || "默认公司",
    roleCode: rawUser.roleCode || "",
    roleName: rawUser.roleName || "ECP用户",
    subject: rawUser.subject || "",
    directorySubject: rawUser.directorySubject || rawUser.subject || "",
    avatar: rawUser.avatar || "",
    permissionCodes: Array.isArray(rawUser.permissionCodes) ? rawUser.permissionCodes : [],
  };
}

function permissionSet() {
  return new Set(Array.isArray(state.currentUser?.permissionCodes) ? state.currentUser.permissionCodes : []);
}

function hasPermission(code) {
  return Boolean(code) && permissionSet().has(code);
}

function hasAnyPermission(codes = []) {
  const granted = permissionSet();
  return codes.some((code) => granted.has(code));
}

function ensureAnyPermission(codes, message = "当前账号没有执行该操作的权限") {
  if (hasAnyPermission(codes)) return true;
  showToast(message);
  return false;
}

const createPermissionByKind = {
  asset: "asset:item:create",
  request: "asset:request:create",
  stocktake: "asset:stocktake:create",
  consumable: "asset:consumable:create",
  repair: "asset:repair:create",
  contract: "asset:contract:create",
};

const portalWritePermissions = [
  "asset:item:create",
  "asset:item:update",
  "asset:item:batchUpdate",
  "asset:inbound:create",
  "asset:receive_return:receive",
  "asset:receive_return:return",
  "asset:receive_return:handover",
  "asset:borrow_return:borrow",
  "asset:borrow_return:return",
  "asset:request:create",
  "asset:request:review",
  "asset:stocktake:create",
  "asset:stocktake:update",
  "asset:consumable:create",
  "asset:consumable:adjust",
  "asset:repair:create",
  "asset:repair:update",
  "asset:contract:create",
];

const managementViewPermissions = [
  "asset:employee:view",
  "asset:department:view",
  "asset:inbound:view",
  "asset:receive_return:view",
  "asset:borrow_return:view",
  "asset:stocktake:view",
  "asset:request:review",
  "asset:location_settings:view",
  "asset:category_settings:view",
  "asset:code_rules:view",
  "asset:label_template_settings:view",
  "asset:self_service:update",
  "asset:integration:view",
  "asset:form:view",
];

function canAccessManagementExperience() {
  return hasAnyPermission(managementViewPermissions);
}

function currentTerminalMode() {
  if (!canAccessManagementExperience()) return "employee";
  return state.terminalMode === "employee" ? "employee" : "management";
}

function hasManagementExperience() {
  return currentTerminalMode() === "management";
}

function setTerminalMode(mode) {
  const nextMode = mode === "employee" ? "employee" : "management";
  if (nextMode === "management" && !canAccessManagementExperience()) {
    showToast("当前账号没有管理端权限");
    return;
  }
  state.terminalMode = nextMode;
  try {
    localStorage.setItem(terminalModeStorageKey, nextMode);
  } catch {
    // Ignore local persistence failures; the active page state has already switched.
  }
  if (!routeAllowed(state.route)) {
    state.route = firstAccessibleRoute();
  }
  render();
}

function portalMenuItems() {
  const items = readEcpContext()?.getMenuItems?.();
  return Array.isArray(items) ? items : [];
}

function portalMenuById(id) {
  return portalMenuItems().find((item) => item.id === id) || null;
}

function portalMenuForState(route = state.route) {
  if (route === "settings") {
    return portalMenuItems().find((item) => item.parentId === "settings" && item.title === state.systemMenu)
      || portalMenuItems().find((item) => item.parentId === "settings")
      || portalMenuById("settings");
  }
  return portalMenuById(route);
}

function stateRouteFromPortalMenu(item) {
  if (!item) return "";
  if (item.id === "settings" || item.parentId === "settings") return "settings";
  return item.id;
}

function applyPortalMenuRoute(item, shouldRender = false) {
  const nextRoute = stateRouteFromPortalMenu(item);
  if (!nextRoute) return false;
  state.route = nextRoute;
  if (item.parentId === "settings" && item.title) {
    state.systemMenu = item.title;
    if (state.systemMenu === "员工自助" && !state.selfServiceMenu) state.selfServiceMenu = "员工自助管理";
  }
  if (shouldRender && isAuthenticated()) render();
  return true;
}

function applyEcpSession() {
  if (!isEcpAuthEnabled()) return false;
  const ecpUser = normalizeEcpPortalUserPayload();
  if (!ecpUser) return false;
  resetSessionView();
  state.currentUser = ecpUser;
  state.session = {
    authenticated: true,
    method: "ecp",
    provider: "ECP统一认证",
    lastLoginAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
  if (!applyPortalMenuRoute(readEcpContext()?.getCurrentMenu?.())) {
    state.route = preferredAccessibleRoute();
  }
  return true;
}

window.assetPortalApplyEcpSession = applyEcpSession;
window.addEventListener("asset-portal-ecp-session", () => {
  if (applyEcpSession()) {
    render();
    return;
  }
  state.currentUser = null;
  state.session = { ...state.session, authenticated: false };
  render();
});

function persistRoute(route = state.route) {
  const target = portalMenuForState(route);
  const context = readEcpContext();
  if (!target || !context?.navigate || context.getCurrentMenu?.()?.id === target.id) return;
  void context.navigate(target.id).catch((error) => showToast(error?.message || "页面跳转失败"));
}

function closeAccountMenus() {
  document.querySelectorAll("[data-account-menu].open").forEach((menu) => {
    menu.classList.remove("open");
    menu.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", "false");
  });
}

function clearPersistedRoute() {
  // ECP/Vue Router owns route state. No local route session is retained.
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

const employeeTerminalNavIds = new Set(["home", "assets", "requests"]);

function isNavItemAllowedInCurrentTerminal(item) {
  return hasManagementExperience() || employeeTerminalNavIds.has(item.id);
}

function getAccessibleNav(items = nav) {
  if (!isAuthenticated()) return [];
  const accessibleIds = new Set(portalMenuItems().map((item) => item.id));
  return items
    .filter(isNavItemAllowedInCurrentTerminal)
    .map((item) => ({
      ...item,
      label: portalMenuById(item.id)?.title || item.label,
      children: getAccessibleNav(item.children || []),
    }))
    .filter((item) => accessibleIds.has(item.id)
      || item.children?.length
      || (item.id === "settings" && portalMenuItems().some((menu) => menu.parentId === "settings")));
}

function flattenNav(items = getAccessibleNav()) {
  return items.flatMap((item) => [item, ...flattenNav(item.children || [])]);
}

function getPrimaryNavItems() {
  return getAccessibleNav().map((item) => (
    item.id === "requests" && (!hasManagementExperience() || !hasPermission("asset:request:review"))
      ? { ...item, label: "申请", icon: applicationNavIcon }
      : item
  ));
}

function normalizeRoute(route) {
  if (route === "assetArchives") return "assetLocationSettings";
  if (route === "assetTemplateManagement") return "assetLocationSettings";
  if (route === "assetExtendedInfo") return "assetLocationSettings";
  const accessible = flattenNav(getAccessibleNav());
  const group = accessible.find((item) => item.id === route && (item.landingRoute || item.children?.length));
  if (!group) return route;
  if (group.landingRoute && portalMenuById(group.landingRoute)) return group.landingRoute;
  return flattenNav(group.children || []).find((item) => portalMenuById(item.id))?.id || route;
}

function routeAllowed(route) {
  const normalized = normalizeRoute(route);
  if (portalMenuById(normalized)) return flattenNav().some((item) => item.id === normalized);
  return normalized === "settings"
    && hasManagementExperience()
    && portalMenuItems().some((item) => item.parentId === "settings");
}

function firstAccessibleRoute() {
  if (portalMenuById("home")) return "home";
  return flattenNav().find((item) => portalMenuById(item.id))?.id
    || (portalMenuItems().some((item) => item.parentId === "settings") ? "settings" : "home");
}

function preferredAccessibleRoute(fallback = firstAccessibleRoute(), options = {}) {
  const preferred = normalizeRoute(stateRouteFromPortalMenu(readEcpContext()?.getCurrentMenu?.()));
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
  if (!isAuthenticated()) return "登录入口";
  return flattenNav().find((item) => item.id === state.route)?.label || "首页";
}

function setRoute(route) {
  if (!isAuthenticated()) return;
  captureAssetSubnavScroll();
  const normalized = normalizeRoute(route);
  if (!routeAllowed(normalized)) {
    showToast("当前账号没有该页面权限");
    return;
  }
  state.route = normalized;
  const parent = findNavParentByRoute(normalized);
  if (parent && parent.id !== "assetSettings") {
    state.navOpen[parent.id] = true;
  }
  persistRoute(state.route);
  render();
}

function toggleNavGroup(groupId) {
  captureAssetSubnavScroll();
  state.navOpen[groupId] = !state.navOpen[groupId];
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
  if (codeInput && codeInput.dataset.autoGeneratedAssetCode === "true") codeInput.value = "";
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
  void asset;
  const requiredPermissions = {
    领用: ["asset:receive_return:receive"],
    退库: ["asset:receive_return:return"],
    借用: ["asset:borrow_return:borrow"],
    归还: ["asset:borrow_return:return"],
    交接: ["asset:receive_return:handover"],
    维修: ["asset:repair:update"],
    报修: ["asset:repair:create"],
  }[action] || ["asset:item:update"];
  return hasAnyPermission(requiredPermissions);
}

function assetActionLabel(asset, action) {
  return canDirectHandle(asset, action) ? `直办${action}` : `申请${action}`;
}

function getScopedAssets(rows = state.assets) {
  return getScopedAllAssets(rows).filter((item) => item.inboundStatus !== "已取消");
}

function getScopedAllAssets(rows = state.assets) {
  return state.currentUser ? rows : [];
}

function getScopedRequests(rows = state.requests) {
  return state.currentUser ? rows : [];
}

function getScopedStocktakes(rows = state.stocktakes) {
  return hasPermission("asset:stocktake:view") ? rows : [];
}

function getScopedFailures() {
  return getScopedAssets().filter((item) => item.status === "维修中");
}

async function logout() {
  resetSessionView();
  state.currentUser = null;
  state.session = {
    ...state.session,
    authenticated: false,
    method: "ecp",
    provider: "ECP统一认证",
  };
  clearPersistedRoute();
  await readEcpContext()?.logout?.();
}

function renderAccountMenu() {
  const user = state.currentUser;
  if (!user) return "";
  const canSwitchTerminal = canAccessManagementExperience();
  const terminalMode = currentTerminalMode();
  const terminalSelector = canSwitchTerminal
    ? `<div class="terminal-selector" role="group" aria-label="端模式切换">
        <button class="terminal-option ${terminalMode === "management" ? "active" : ""}" type="button" data-terminal-mode="management" aria-pressed="${terminalMode === "management" ? "true" : "false"}">
          <span>管</span>
          <strong>管理端</strong>
          <small>资产台账、入库、审批、系统配置和账号授权</small>
        </button>
        <button class="terminal-option ${terminalMode === "employee" ? "active" : ""}" type="button" data-terminal-mode="employee" aria-pressed="${terminalMode === "employee" ? "true" : "false"}">
          <span>员</span>
          <strong>员工端</strong>
          <small>我的资产、我的申请、领用/借用/归还/交接</small>
        </button>
      </div>
      <div class="account-panel-line"></div>`
    : "";
  return `<div class="account-menu sidebar-account-menu" data-account-menu>
    <button class="account-entry sidebar-account-entry" type="button" data-account-toggle aria-expanded="false" title="${escapeHtml(user.name)}" aria-label="账号管理">
      ${avatarMarkup(user, "account-avatar")}
      <span class="account-entry-text">
        <strong>${escapeHtml(user.name)}</strong>
        <span>${escapeHtml(user.roleName)} · ${terminalMode === "management" ? "管理端" : "员工端"}</span>
      </span>
    </button>
    <div class="account-popover" data-account-popover>
      <div class="account-profile">
        <div class="account-profile-main">
          <strong>${escapeHtml(user.name)}</strong>
          <span>${escapeHtml(user.roleName)}</span>
        </div>
      </div>
      <div class="account-panel-line"></div>
      ${terminalSelector}
      <button class="account-logout" type="button" data-logout>退出登录</button>
    </div>
  </div>`;
}

function renderChrome() {
  const authenticated = isAuthenticated();
  document.body.classList.toggle("auth-view", !authenticated);
  document.body.classList.toggle("employee-terminal-view", authenticated && !hasManagementExperience());
  document.body.classList.toggle("self-service-view", authenticated && state.route === "settings" && state.systemMenu === "员工自助");
  document.title = authenticated ? `资产云管家 - ${routeTitle()}` : "资产云管家 - 登录入口";

  if (!authenticated) {
    topbarActions.innerHTML = `
      <div class="login-topbar-copy">资产云管家 · ECP 统一认证</div>
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
        <button class="nav-item ${itemActive ? "active" : ""}" data-route="${escapeHtml(targetRoute)}" title="${escapeHtml(item.label)}" aria-label="${escapeHtml(item.label)}">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${escapeHtml(item.label)}</span>
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

  sidebarTools.innerHTML = `
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
                <button class="asset-subnav-item ${active ? "active" : ""}" data-route="${escapeHtml(item.id)}" type="button">
                  <span class="asset-subnav-dot" aria-hidden="true"></span>
                  <span class="asset-subnav-label">${escapeHtml(item.label)}</span>
                </button>
              `;
            }
            return `
              <div class="asset-subnav-group ${open ? "open" : ""}" data-asset-subnav-group="${escapeHtml(item.id)}">
                <button class="asset-subnav-item asset-subnav-parent ${active ? "active" : ""}" data-asset-subnav-toggle="${escapeHtml(item.id)}" type="button" aria-expanded="${open ? "true" : "false"}">
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
                        <button class="asset-subnav-child ${childSelected ? "active" : ""}" data-route="${escapeHtml(child.id)}" type="button">
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
  if (item.route) return `<button class="${escapeHtml(cls)}" data-route="${escapeHtml(item.route)}">${escapeHtml(item.label)}</button>`;
  if (item.request) return `<button class="${escapeHtml(cls)}" data-open-request="${escapeHtml(item.request)}">${escapeHtml(item.label)}</button>`;
  if (item.kind) return `<button class="${escapeHtml(cls)}" data-open-kind="${escapeHtml(item.kind)}">${escapeHtml(item.label)}</button>`;
  return "";
}

function renderWorkbenchCard(item) {
  const attr = item.route
    ? `data-route="${escapeHtml(item.route)}"`
    : item.request
      ? `data-open-request="${escapeHtml(item.request)}"`
      : `data-open-kind="${escapeHtml(item.kind)}"`;
  return `<button class="action-card" ${attr}>
    <span class="action-icon">${escapeHtml(item.icon)}</span>
    <strong>${escapeHtml(item.label)}</strong>
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
              <strong>${escapeHtml(asset.name)}</strong>
              <div class="panel-subtitle">${escapeHtml(asset.model)} / ${escapeHtml(asset.assetTag)}</div>
            </div>
            <div class="device-overview-meta">
              <span>当前状态</span>
              ${statusTag(asset.status)}
            </div>
            <div class="device-overview-meta">
              <span>存放位置</span>
              <strong>${escapeHtml(asset.location)}</strong>
            </div>
            <div class="device-overview-meta">
              <span>资产风险</span>
              ${riskBadge(asset.risk)}
            </div>
            <div class="device-overview-meta">
              <span>保修截止</span>
              <strong>${escapeHtml(asset.warrantyDate)}</strong>
            </div>
            <button class="btn" data-detail="${escapeHtml(asset.id)}">查看详情</button>
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
        <h2 class="panel-title">${escapeHtml(title)}</h2>
        <div class="panel-subtitle">${escapeHtml(subtitle)}</div>
      </div>
      ${routeAllowed("requests") ? `<button class="btn" data-route="requests">查看全部</button>` : ""}
    </div>
    <div class="timeline">
      ${
        rows.length
          ? rows
              .map(
                (item) => `<div class="timeline-item">
                  <div class="timeline-date">${escapeHtml(item.date)}</div>
                  <div>
                    <div class="timeline-title">${escapeHtml(item.id)} · ${escapeHtml(item.type)} ${statusTag(item.status)}</div>
                    <div class="timeline-desc">${escapeHtml(item.asset)} / ${escapeHtml(item.reason)} / ${escapeHtml(item.system)}</div>
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
  if (!hasManagementExperience()) return renderEmployeeHome();
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
        <div class="stat-note">资产动作等待审批或执行</div>
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
      <h1>${escapeHtml(greeting())}，${escapeHtml(state.currentUser.name)}</h1>
    </section>
    ${renderDeviceOverviewStrip(myPrimaryAsset)}
  `;
}

function assetRowActionMarkup(item) {
  if (!state.currentUser) return "";

  if (!hasManagementExperience() || !hasAnyPermission(["asset:receive_return:handover", "asset:item:update"])) {
    const action = item.owner === state.currentUser.name
      ? item.status === "借用中" ? "归还" : "退还"
      : "领用";
    return `
      <button class="btn" data-detail="${escapeHtml(item.id)}">详情</button>
      ${hasPermission("asset:request:create") ? `<button class="btn" data-asset-action="${escapeHtml(item.id)}" data-action="${escapeHtml(action)}">${escapeHtml(assetActionLabel(item, action))}</button>` : ""}
    `;
  }

  return `
    <button class="btn" data-detail="${escapeHtml(item.id)}">详情</button>
    <button class="btn" data-asset-action="${escapeHtml(item.id)}" data-action="交接">${escapeHtml(assetActionLabel(item, "交接"))}</button>
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

  const isEmployee = !hasManagementExperience();
  const categories = uniqueAssetValues("category", scopedRows);
  const activeCount = scopedRows.filter((item) => item.status === "在用").length;
  const riskCount = scopedRows.filter((item) => item.risk !== "正常").length;
  const displayTitle = isEmployee ? `我的${title}` : title;
  const subtitle = isEmployee
    ? "仅展示本人或本部门可见资产，资产动作通过系统申请发起。"
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
              return `<button class="category-item ${filters.category === category ? "active" : ""}" data-asset-filter="category" data-value="${escapeHtml(category)}">
                <span>${escapeHtml(category)}</span><strong>${count}</strong>
              </button>`;
            })
            .join("")}
        </div>
        <div class="role-switch">
          <div>
            <strong>当前 ECP 身份</strong>
            <div class="panel-subtitle">${escapeHtml(state.currentUser.name)} / ${escapeHtml(state.currentUser.roleName)}</div>
          </div>
          <span class="tag blue">${escapeHtml(state.currentUser.account)}</span>
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
            .map((tag) => `<button class="tag-filter ${filters.tag === tag ? "active" : ""}" data-asset-filter="tag" data-value="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)
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
                          <td><button class="link" data-detail="${escapeHtml(item.id)}">${escapeHtml(item.id)}</button><div class="panel-subtitle">${escapeHtml(item.assetTag || "-")}</div></td>
                          <td>${escapeHtml(item.name)}<div class="panel-subtitle">${escapeHtml(item.model)} / ${escapeHtml(item.sn)}</div></td>
                          <td><strong>${escapeHtml(item.category)}</strong><div class="row-tags">${(item.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></td>
                          <td>${escapeHtml(item.owner)}<div class="panel-subtitle">${escapeHtml(item.department)} / ${escapeHtml(item.custodian)}</div></td>
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
  const managementMode = hasManagementExperience();

  return `<section class="asset-list-page">
    <div class="asset-list-toolbar">
      <div class="asset-list-actions">
        ${managementMode && hasPermission("asset:item:create") ? `<button class="table-action primary" data-open-kind="asset">＋ 新增</button>` : ""}
        ${managementMode ? assetOperationDropdown() : ""}
        ${managementMode ? assetEditDropdown() : ""}
        ${managementMode ? assetImportExportDropdown() : ""}
        ${managementMode && hasPermission("asset:item:printLabel") ? `<button class="table-action" data-print-asset-labels>打印标签</button>` : ""}
        ${!managementMode && hasPermission("asset:request:create") ? `<button class="table-action primary" data-open-request="资产领用">发起领用申请</button>` : ""}
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
  const normalizedStatus = String(status || "");
  const tone = normalizedStatus.includes("审批") ? "green" : normalizedStatus === "空闲" ? "blue" : normalizedStatus === "交接待签字" ? "red" : "violet";
  return `<span class="asset-status-pill ${tone}">${escapeHtml(normalizedStatus)}</span>`;
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
          : `<div class="asset-label-template-ticket${escapeHtml(sampleLayoutClass)}">
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
  const deleteButtonMarkup = currentTemplate.custom && hasPermission("asset:label_template_settings:delete")
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
          ${hasPermission("asset:label_template_settings:create") ? '<button class="asset-label-template-add" type="button" data-label-template-add>＋新增</button>' : ""}
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
        ${hasPermission("asset:label_template_settings:reset") ? '<button type="button" class="btn" data-label-template-reset>重 置</button>' : ""}
        ${hasPermission("asset:label_template_settings:save") ? '<button type="button" class="btn primary" data-label-template-save>保 存</button>' : ""}
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
        ${hasPermission("asset:label_template_settings:create") ? '<button class="asset-label-template-add" type="button" data-label-template-add>＋新增</button>' : ""}
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
          ${hasPermission("asset:label_template_settings:reset") ? '<button type="button" class="btn" data-label-template-reset>重 置</button>' : ""}
          ${hasPermission("asset:label_template_settings:save") ? '<button type="button" class="btn primary" data-label-template-save>保 存</button>' : ""}
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

  form.querySelector("[data-save-label-settings]")?.addEventListener("click", async () => {
    state.assetLabelSettings = readAssetLabelSettingsForm(form);
    const saved = await saveAssetLabelSettings("save");
    refreshAssetLabelPreview(form);
    if (saved) showToast("标签打印配置已保存");
  });

  form.querySelector("[data-print-asset-labels-now]")?.addEventListener("click", () => {
    state.assetLabelSettings = readAssetLabelSettingsForm(form);
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

function operationAsset(record) {
  const current = state.assets.find((asset) => asset.id === record.assetId);
  const snapshot = {
    id: record.assetId || "",
    name: record.assetName || "-",
    category: record.assetCategory || "-",
    brand: record.assetBrand || "",
    model: record.assetModel || "",
    sn: record.assetSn || "",
    price: Number(record.assetPrice) || 0,
    owner: record.party || "未分配",
    ownerSubject: record.partySubject || "",
    custodian: record.operator || "",
    company: record.company || "",
    department: record.department || "",
    location: record.location || "",
    note: record.note || "",
  };
  return current ? { ...current, ...snapshot } : snapshot;
}

function operationRecordsByType(type) {
  return assetOperationRecords.filter((record) => record?.type === type && record?.id && record?.assetId);
}

function buildInboundOrders() {
  return operationRecordsByType("INBOUND").map((record) => {
    const asset = operationAsset(record);
    const inferredType = asset.purchaseMethod && asset.purchaseMethod.includes("导入") ? "excel批量导入" : "新增资产";
    return {
      id: record.id,
      status: record.status,
      type: record.sourceType || inferredType,
      date: record.date,
      createdDate: record.date,
      operator: record.operator || "-",
      purchaser: asset.purchaser || "",
      company: record.company || asset.ownerCompany || asset.company || "默认公司",
      note: record.note || "",
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

function spreadsheetWorkbookXml(sheetName, columns, rows) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Body"><Alignment ss:Vertical="Center"/></Style>
  </Styles>
  <Worksheet ss:Name="${escapeXml(sheetName)}">
    <Table>
      ${columns.map(([, , width]) => `<Column ss:Width="${width}"/>`).join("")}
      <Row>${columns.map(([, label]) => excelCell(label, "Header")).join("")}</Row>
      ${rows.map((row) => `<Row>${columns.map(([key]) => excelCell(row[key] ?? "", "Body")).join("")}</Row>`).join("")}
    </Table>
  </Worksheet>
</Workbook>`;
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

function exportAssetWorkbook() {
  const filtered = getScopedAssets(state.assets).filter(matchesAssetQuery);
  const selectedIds = new Set(state.selectedAssetIds || []);
  const selected = filtered.filter((asset) => selectedIds.has(asset.id));
  const assets = selected.length ? selected : filtered;
  if (!assets.length) {
    showToast("当前没有可导出的资产");
    return;
  }
  const columns = [
    ["id", "资产编码", 110],
    ["name", "资产名称", 130],
    ["category", "资产分类", 100],
    ["brand", "品牌", 80],
    ["model", "型号", 100],
    ["sn", "设备序列号", 120],
    ["status", "状态", 72],
    ["owner", "使用人", 90],
    ["ownerSubject", "ECP人员Subject", 150],
    ["company", "使用公司", 110],
    ["department", "使用部门", 110],
    ["location", "所在位置", 160],
    ["custodian", "管理员", 90],
    ["ownerCompany", "所属/承租公司", 120],
    ["price", "金额", 80],
    ["rent", "租金", 80],
    ["purchaseDate", "购置/起租日期", 100],
    ["receiveDate", "领用日期", 100],
    ["purchaseMethod", "购置方式", 90],
    ["orderNo", "订单号", 110],
    ["unit", "计量单位", 72],
    ["supplier", "供应商", 110],
    ["note", "备注", 180],
  ];
  const workbook = spreadsheetWorkbookXml("资产列表", columns, assets);
  downloadBlob(`资产列表_${todayValue()}_${assets.length}条.xls`, workbook, "application/vnd.ms-excel;charset=utf-8");
  showToast(`已导出 ${assets.length} 条资产`);
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
        <td>${escapeHtml(asset.price || 0)}</td>
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
    <span>${escapeHtml(label)}</span>
    <input name="${escapeHtml(name)}" value="${advancedFilterValue(filters, name)}" placeholder="${escapeHtml(placeholder)}">
  </label>`;
}

function advancedSelect(label, name, values, filters = {}, fallback = "全部") {
  return `<label class="advanced-filter-field">
    <span>${escapeHtml(label)}</span>
    <select name="${escapeHtml(name)}">${advancedFilterOptionList(filters, name, values, fallback)}</select>
  </label>`;
}

function advancedPlaceholderSelect(label, name, placeholder, values, filters = {}) {
  const selected = filters?.[name] || "";
  const optionsMarkup = values === assetLocationOptions ? locationOptionList(selected, { placeholder }) : values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
  return `<label class="advanced-filter-field">
    <span>${escapeHtml(label)}</span>
    <select name="${escapeHtml(name)}" class="${selected ? "" : "placeholder-select"}" data-placeholder-select>
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
    <span>${escapeHtml(label)}</span>
    <div class="advanced-date-range-control">
      <input name="${escapeHtml(startName)}" type="date" value="${advancedFilterValue(filters, startName)}" aria-label="${escapeHtml(label)}开始日期">
      <span>→</span>
      <input name="${escapeHtml(endName)}" type="date" value="${advancedFilterValue(filters, endName)}" aria-label="${escapeHtml(label)}结束日期">
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

  return `<section class="asset-list-page asset-inbound-ledger">
    <div class="asset-list-toolbar asset-inbound-toolbar">
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
    <div class="asset-table-shell inbound-table-shell">
      <div class="asset-table-actions inbound-table-actions">
        <button class="link" data-advanced-search="inbound">高级搜索</button>
        <button class="list-settings-button" data-list-settings="inbound" title="列表设置" aria-label="列表设置">⚙</button>
      </div>
      <div class="asset-table-scroll inbound-table-scroll">
        <table class="asset-list-table inbound-order-table" data-resizable-table="inbound" style="min-width:${inboundTableMinWidth()}px">
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
  const canCancel = order.status !== "已取消"
    && ["空闲", "闲置", "上架", "待验收"].includes(order.asset.status)
    && (!order.asset.owner || order.asset.owner === "未分配");
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
      ${detail("资产分类", categories)}
      ${detail("所属公司", companies)}
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
  if (name === state.currentUser?.name || name === state.currentUser?.account) return state.currentUser.account;
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
  if (activeTab === "employee") {
    return businessDataItems("requests")
      .filter((request) => request.type === "资产领用" && Array.isArray(request.assetIds))
      .flatMap((request) => request.assetIds.map((assetId) => {
        const asset = state.assets.find((item) => item.id === assetId);
        if (!asset) return null;
        return {
          id: request.id,
          requestId: request.id,
          status: request.status === "审批中" ? "审批中" : request.status === "已完成" ? "已完成" : request.status || "待处理",
          date: request.date || "-",
          handler: request.decisionOperator || "-",
          receiver: request.applicant || "-",
          employeeCode: employeeCodeForName(request.applicant),
          company: asset.company || asset.ownerCompany || "默认公司",
          department: asset.department || "默认部门",
          location: request.receiveLocation || asset.location || "-",
          note: request.reason || "",
          actionLabel: "查看",
          actionType: "request-detail",
          asset,
        };
      }))
      .filter(Boolean);
  }

  const operationType = activeTab === "return" ? "RETURN" : activeTab === "handover" ? "HANDOVER" : "RECEIVE";
  return operationRecordsByType(operationType).map((record) => {
    const asset = operationAsset(record);
    const canSign = record.canSign === true;
    return {
      id: record.id,
      status: record.status,
      date: record.date,
      handler: record.operator || "-",
      receiver: record.party || "-",
      employeeCode: employeeCodeForName(record.party),
      company: record.company || asset.company || asset.ownerCompany || "默认公司",
      department: record.department || asset.department || "默认部门",
      location: record.location || asset.location || "-",
      note: record.note || "",
      actionLabel: canSign ? "签字" : "查看",
      actionType: canSign ? "handover-sign" : "detail",
      asset,
    };
  });
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
  if (order.actionType === "request-detail") {
    return `<button class="link receive-return-action-link" data-request="${escapeHtml(order.requestId)}">查看</button>`;
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
  if (column.key === "id") {
    const target = order.requestId
      ? `data-request="${escapeHtml(order.requestId)}"`
      : `data-detail="${escapeHtml(order.asset.id)}"`;
    return `<button class="link receive-return-order-link" ${target}>${escapeHtml(order.id)}</button>`;
  }
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

  return `<section class="asset-list-page receive-return-ledger">
    <div class="receive-return-tabs">
      ${tabs
        .map(
          ([key, label]) => `<button class="receive-return-tab ${state.assetReceiveReturnTab === key ? "active" : ""}" type="button" data-receive-return-tab="${key}">${label}</button>`
        )
        .join("")}
    </div>
    <div class="asset-list-toolbar receive-return-toolbar">
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
    <div class="asset-table-shell receive-return-table-shell">
      <div class="asset-table-actions receive-return-table-actions">
        <button class="link" data-advanced-search="receiveReturn">高级搜索</button>
        <button class="list-settings-button" data-list-settings="receiveReturn" title="列表设置" aria-label="列表设置">⚙</button>
      </div>
      <div class="asset-table-scroll receive-return-table-scroll">
        <table class="asset-list-table receive-return-table" data-resizable-table="receiveReturn" style="min-width:${receiveReturnTableMinWidth(columns)}px">
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
  return `${pageHeader("变更领用人", "领用后的资产支持在线交接，管理员可变更资产当前领用人。", "发起交接", null, {
    actionAttr: "data-bulk-asset-action=\"handover\"",
    actionPermissionCodes: ["asset:receive_return:handover"],
  })}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>资产编号</th><th>资产名称</th><th>当前领用人</th><th>部门</th><th>使用信息</th><th>操作</th></tr></thead>
          <tbody>${rows.map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.department)}</td><td>${escapeHtml(item.location)}</td><td><button class="btn" data-quick-handover-asset="${escapeHtml(item.id)}">在线交接</button></td></tr>`).join("")}</tbody>
        </table>
    </section>`;
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
  const sourceRecords = activeTab === "return"
    ? [
        ...operationRecordsByType("BORROW").filter((record) => record.status === "待归还"),
        ...operationRecordsByType("BORROW_RETURN"),
      ]
    : operationRecordsByType("BORROW");
  return sourceRecords
    .map((record) => {
      const asset = operationAsset(record);
      const pendingReturn = activeTab === "return" && record.type === "BORROW";
      return {
        id: pendingReturn ? record.returnOrderId : record.id,
        status: pendingReturn ? "待归还" : record.status,
        handler: record.operator || "-",
        borrower: record.party || "-",
        borrowDate: record.date || "-",
        expectedReturnDate: record.expectedReturnDate || "-",
        company: record.company || asset.company || asset.ownerCompany || "默认公司",
        department: record.department || asset.department || "默认部门",
        employeeCode: employeeCodeForName(record.party),
        phone: asset.phone || "-",
        email: asset.email || "-",
        location: record.location || asset.location || "-",
        signer: record.party || "-",
        signImage: "-",
        note: record.note || "",
        actionType: pendingReturn ? "return" : "detail",
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
  return `<section class="asset-list-page receive-return-ledger borrow-return-ledger">
    <div class="receive-return-tabs">
      ${tabs
        .map(([key, label]) => `<button class="receive-return-tab ${activeTab === key ? "active" : ""}" type="button" data-borrow-return-tab="${key}">${label}</button>`)
        .join("")}
    </div>
    <div class="asset-list-toolbar receive-return-toolbar">
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
    <div class="asset-table-shell receive-return-table-shell">
      <div class="asset-table-actions receive-return-table-actions">
        <button class="link" type="button" data-borrow-advanced-search>高级搜索</button>
        <button class="list-settings-button" type="button" data-borrow-list-settings title="列表设置" aria-label="列表设置">⚙</button>
      </div>
      <div class="asset-table-scroll receive-return-table-scroll">
        <table class="asset-list-table receive-return-table borrow-return-table" data-resizable-table="borrowReturn" style="min-width:${borrowReturnTableMinWidth()}px">
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
  const canUpdate = hasPermission("asset:code_rules:update");
  const selected = settings.selectedFields;
  const selectedSet = new Set(selected);
  const available = assetCodeRuleFieldDefinitions.filter((field) => !selectedSet.has(field.key));
  state.assetCodeRuleSettings = settings;
  return `<section class="asset-code-rule-page ${canUpdate ? "" : "is-readonly"}">
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
        <select data-code-rule-serial ${canUpdate ? "" : "disabled"}>
          ${[3, 4, 5, 6, 7].map((length) => `<option value="${length}" ${settings.serialLength === length ? "selected" : ""}>${length}</option>`).join("")}
        </select>
      </label>
      <span>流水号可选范围为3-7位</span>
    </div>
    <section class="asset-code-rule-preview">
      <p>规则预览：<strong>${escapeHtml(assetCodeRulePreviewText(settings))}</strong></p>
      <p>当前编码规则下资产编码长度：<b>${assetCodeRuleCurrentLength(settings)}位</b></p>
    </section>
    ${canUpdate ? `<div class="asset-code-rule-actions">
      <button class="btn primary" type="button" data-code-rule-save>保存</button>
    </div>` : ""}
  </section>`;
}

function moveAssetCodeRuleField(fieldKey, targetList, beforeKey = "") {
  if (!ensureAnyPermission(["asset:code_rules:update"])) return;
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
  if (!hasPermission("asset:code_rules:update")) {
    pageHost.querySelectorAll("input, select, textarea, button").forEach((control) => {
      control.disabled = true;
    });
    return;
  }
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

  pageHost.querySelector("[data-code-rule-save]")?.addEventListener("click", async () => {
    state.assetCodeRuleSettings = normalizeAssetCodeRuleSettings(state.assetCodeRuleSettings);
    if (state.assetCodeRuleSettings.selectedFields.includes("customText") && !String(state.assetCodeRuleSettings.customTexts?.customText || "").trim()) {
      showToast("请输入自定义文本");
      return;
    }
    if (await saveAssetCodeRuleSettings()) showToast("资产编码规则已保存");
  });
}

function bindAssetLabelTemplateSettings(root = document) {
  const pageHost = root.querySelector(".asset-label-template-page");
  if (!pageHost) return;
  const form = pageHost.querySelector("[data-label-template-settings-form]");
  const canUpdate = hasPermission("asset:label_template_settings:update");
  if (!canUpdate) {
    form?.querySelectorAll("input, textarea, select").forEach((control) => {
      control.disabled = true;
    });
  }

  const refreshSettingsPanel = () => {
    if (!canUpdate) return;
    if (!form) return;
    state.assetLabelSettings = readAssetLabelSettingsForm(form);
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
      if (!ensureAnyPermission(["asset:label_template_settings:update"])) return;
      const templateKey = card.dataset.labelTemplateCard;
      state.assetLabelSettings = normalizeAssetLabelSettings(assetLabelTemplateDefaults(templateKey));
      render();
    });
  });

  form?.querySelector("[data-label-template-select]")?.addEventListener("change", (event) => {
    if (!ensureAnyPermission(["asset:label_template_settings:update"])) return;
    state.assetLabelSettings = normalizeAssetLabelSettings(assetLabelTemplateDefaults(event.currentTarget.value));
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

  form?.querySelector("[data-label-template-reset]")?.addEventListener("click", async () => {
    if (!ensureAnyPermission(["asset:label_template_settings:reset"])) return;
    state.assetLabelSettings = normalizeAssetLabelSettings(assetLabelTemplateDefaults(state.assetLabelSettings.templateKey));
    if (await saveAssetLabelSettings("reset")) {
      render();
      showToast("标签模板配置已重置");
    }
  });

  form?.querySelector("[data-label-template-save]")?.addEventListener("click", async () => {
    if (!ensureAnyPermission(["asset:label_template_settings:save"])) return;
    state.assetLabelSettings = readAssetLabelSettingsForm(form);
    if (await saveAssetLabelSettings("save", { updateCustomTemplate: true })) {
      refreshSettingsPanel();
      showToast("标签模板配置已保存");
    }
  });

  pageHost.querySelector("[data-label-template-add]")?.addEventListener("click", async () => {
    if (!ensureAnyPermission(["asset:label_template_settings:create"])) return;
    if (form) state.assetLabelSettings = readAssetLabelSettingsForm(form);
    const template = await createAssetLabelCustomTemplate(state.assetLabelSettings);
    if (!template) return;
    render();
    showToast(`已新增模板：${template.name}`);
  });

  pageHost.querySelector("[data-label-template-delete]")?.addEventListener("click", async (event) => {
    if (!ensureAnyPermission(["asset:label_template_settings:delete"])) return;
    const templateKey = event.currentTarget.dataset.labelTemplateDelete;
    const template = assetLabelTemplateByKey(templateKey);
    if (!template.custom) return;
    if (!window.confirm(`确定删除“${template.name}”吗？`)) return;
    const removed = await deleteAssetLabelCustomTemplate(templateKey);
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
      if (!ensureAnyPermission(["asset:label_template_settings:update"])) return;
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
  if (!hasPermission("asset:location_settings:toggleCode")) return renderAssetCodeSwitch(row.enabled);
  return `<button class="asset-code-switch-button" type="button" data-location-toggle-code="${escapeHtml(row.id)}" aria-pressed="${row.enabled ? "true" : "false"}">${renderAssetCodeSwitch(row.enabled)}</button>`;
}

function assetCategoryWorkbookRows() {
  return flattenAssetCategoryTree().map((node) => ({
    code: node.code || "",
    name: node.name || "",
    parent: node.parent?.name || (node.parentName === "暂无上级" ? "" : node.parentName || ""),
    usefulLife: node.usefulLife || "0",
    unit: node.unit || "台",
    enabled: node.enabled !== false ? "开" : "关",
  }));
}

async function buildAssetCategoryWorkbookBlob(rows = []) {
  const data = [
    ["分类编码*", "分类名称*", "上级分类名称", "使用期限(月)", "计量单位", "资产编码开关"],
    ["必填，不可重复", "必填，不可重复", "一级分类留空；上级需已存在或在表格中", "非必填，默认0", "非必填，默认台", "开/关，默认开"],
    ...rows.map((row) => [row.code, row.name, row.parent, row.usefulLife, row.unit, row.enabled]),
  ];
  return buildXlsxBlob(data, [18, 24, 28, 18, 16, 18]);
}

function categoryWorkbookHeaderField(value = "") {
  const normalized = normalizeImportHeader(value);
  return new Map([
    ["分类编码", "code"],
    ["编码", "code"],
    ["分类名称", "name"],
    ["名称", "name"],
    ["上级分类名称", "parent"],
    ["上级分类", "parent"],
    ["使用期限(月)", "usefulLife"],
    ["使用期限（月）", "usefulLife"],
    ["使用期限", "usefulLife"],
    ["计量单位", "unit"],
    ["单位", "unit"],
    ["资产编码开关", "enabled"],
    ["编码开关", "enabled"],
  ].map(([label, field]) => [normalizeImportHeader(label), field])).get(normalized) || "";
}

function parseCategoryEnabled(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["关", "关闭", "停用", "否", "false", "0", "off"].includes(normalized)) return false;
  if (["开", "开启", "启用", "是", "true", "1", "on"].includes(normalized)) return true;
  throw new Error(`资产编码开关“${value}”无效，请填写开或关`);
}

async function readAssetCategoryWorkbookRows(file) {
  const rows = await readXlsxRows(file);
  let headerIndex = -1;
  let columns = {};
  rows.slice(0, 12).forEach((row, index) => {
    const candidate = {};
    row.values.forEach((value, columnIndex) => {
      const field = categoryWorkbookHeaderField(value);
      if (field && candidate[field] === undefined) candidate[field] = columnIndex;
    });
    if (candidate.code !== undefined && candidate.name !== undefined && Object.keys(candidate).length > Object.keys(columns).length) {
      headerIndex = index;
      columns = candidate;
    }
  });
  if (headerIndex < 0) throw new Error("未识别到分类导入表头，请使用分类导入模板");
  return rows
    .slice(headerIndex + 1)
    .map((row) => ({
      rowNumber: row.rowNumber,
      code: rowCellValue(row, columns.code),
      name: rowCellValue(row, columns.name),
      parent: rowCellValue(row, columns.parent),
      usefulLife: rowCellValue(row, columns.usefulLife),
      unit: rowCellValue(row, columns.unit),
      enabledText: rowCellValue(row, columns.enabled),
    }))
    .filter((row) => Object.entries(row).some(([key, value]) => key !== "rowNumber" && String(value || "").trim()))
    .filter((row) => ![row.code, row.name, row.parent, row.usefulLife, row.unit, row.enabledText].join(" ").includes("必填"))
    .map((row) => ({ ...row, enabled: parseCategoryEnabled(row.enabledText) }));
}

function findAssetCategoryNodeByNameInTree(name, tree = assetCategoryTree, parent = null) {
  const target = String(name || "").trim();
  if (!target) return null;
  for (const node of tree) {
    if (node.name === target) return { node, parent, siblings: tree };
    const found = findAssetCategoryNodeByNameInTree(target, node.children || [], node);
    if (found) return found;
  }
  return null;
}

function removeAssetCategoryNodeByName(name, tree = assetCategoryTree) {
  const target = String(name || "").trim();
  const index = tree.findIndex((node) => node.name === target);
  if (index >= 0) return tree.splice(index, 1)[0];
  for (const node of tree) {
    const removed = removeAssetCategoryNodeByName(target, node.children || []);
    if (removed) return removed;
  }
  return null;
}

function insertAssetCategoryNodeByParentName(tree, node, parentName = "") {
  if (!parentName) {
    tree.push(node);
    return true;
  }
  const parent = findAssetCategoryNodeByNameInTree(parentName, tree)?.node;
  if (!parent) return false;
  parent.children = parent.children || [];
  parent.children.push(node);
  return true;
}

function withoutImportedCategoryNodes(nodes, importedNames) {
  return cloneAssetCategoryTree(nodes || [])
    .filter((node) => !importedNames.has(node.name))
    .map((node) => ({ ...node, children: withoutImportedCategoryNodes(node.children || [], importedNames) }));
}

function validateImportedAssetCategoryRows(rows) {
  const errors = [];
  const names = new Map();
  const codes = new Map();
  rows.forEach((row) => {
    if (!row.code) errors.push(`第 ${row.rowNumber} 行缺少分类编码`);
    if (!row.name) errors.push(`第 ${row.rowNumber} 行缺少分类名称`);
    if (row.name && names.has(row.name)) errors.push(`第 ${row.rowNumber} 行分类名称与第 ${names.get(row.name)} 行重复`);
    if (row.code && codes.has(row.code)) errors.push(`第 ${row.rowNumber} 行分类编码与第 ${codes.get(row.code)} 行重复`);
    if (row.parent && row.parent === row.name) errors.push(`第 ${row.rowNumber} 行上级分类不能等于自身`);
    if (row.name) names.set(row.name, row.rowNumber);
    if (row.code) codes.set(row.code, row.rowNumber);
  });
  const existingRows = flattenAssetCategoryTree();
  const knownNames = new Set([...existingRows.map((row) => row.name), ...names.keys()]);
  const codeOwners = new Map(existingRows.filter((row) => row.code).map((row) => [row.code, row.name]));
  rows.forEach((row) => {
    if (row.parent && !knownNames.has(row.parent)) errors.push(`第 ${row.rowNumber} 行上级分类“${row.parent}”不存在`);
    const owner = codeOwners.get(row.code);
    if (owner && owner !== row.name && !names.has(owner)) errors.push(`第 ${row.rowNumber} 行分类编码已被“${owner}”使用`);
    if (row.code) codeOwners.set(row.code, row.name);
  });
  return errors;
}

async function applyImportedAssetCategoryRows(rows) {
  const errors = validateImportedAssetCategoryRows(rows);
  if (errors.length) throw new Error(errors.slice(0, 5).join("；"));
  const previousTree = cloneAssetCategoryTree(assetCategoryTree);
  const importedNames = new Set(rows.map((row) => row.name));
  const existingByName = new Map(flattenAssetCategoryTree(previousTree).map((row) => [row.name, row]));
  const nextTree = cloneAssetCategoryTree(previousTree);
  rows.forEach((row) => removeAssetCategoryNodeByName(row.name, nextTree));
  const nodesByName = new Map(rows.map((row) => {
    const existing = existingByName.get(row.name);
    const node = existing ? cloneAssetCategoryTree([existing])[0] : {
      id: createAssetCategoryId(),
      code: "",
      name: row.name,
      usefulLife: "0",
      unit: "台",
      enabled: true,
      children: [],
    };
    node.code = row.code;
    node.name = row.name;
    node.usefulLife = row.usefulLife || node.usefulLife || "0";
    node.unit = row.unit || node.unit || "台";
    node.enabled = row.enabled === null ? node.enabled !== false : row.enabled;
    node.children = withoutImportedCategoryNodes(node.children || [], importedNames);
    if (row.parent && flattenAssetCategoryTree(node.children || []).some((child) => child.name === row.parent)) {
      throw new Error(`第 ${row.rowNumber} 行不能把分类移动到自己的下级`);
    }
    return [row.name, node];
  }));
  const inserted = new Set();
  let progressed = true;
  while (inserted.size < rows.length && progressed) {
    progressed = false;
    rows.forEach((row) => {
      if (inserted.has(row.name)) return;
      if (row.parent && importedNames.has(row.parent) && !inserted.has(row.parent)) return;
      if (!insertAssetCategoryNodeByParentName(nextTree, nodesByName.get(row.name), row.parent)) {
        throw new Error(`第 ${row.rowNumber} 行上级分类“${row.parent}”不存在`);
      }
      inserted.add(row.name);
      progressed = true;
    });
  }
  if (inserted.size < rows.length) throw new Error("导入分类层级存在循环关系");
  assetCategoryTree = normalizeAssetCategoryTree(nextTree);
  state.assetCategoryTreeOpen = {};
  try {
    await saveAssetCategoryTree();
  } catch (error) {
    assetCategoryTree = previousTree;
    throw error;
  }
  render();
  return rows.length;
}

async function downloadAssetCategoryTemplate() {
  const blob = await buildAssetCategoryWorkbookBlob();
  downloadBlob(`资产分类导入模板_${todayValue()}.xlsx`, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  showToast("已下载资产分类导入模板");
}

async function exportAssetCategoryWorkbook() {
  const rows = assetCategoryWorkbookRows();
  const blob = await buildAssetCategoryWorkbookBlob(rows);
  downloadBlob(`资产分类导出_${todayValue()}.xlsx`, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  showToast(`已导出 ${rows.length} 条分类`);
}

async function importAssetCategoryWorkbook(file) {
  const rows = await readAssetCategoryWorkbookRows(file);
  if (!rows.length) throw new Error("模板中没有可导入的分类");
  if (rows.length > 5000) throw new Error("最大数据行数不超过5000行");
  const count = await applyImportedAssetCategoryRows(rows);
  showToast(`已导入 ${count} 条分类`);
}

function runAssetCategoryWorkbookAction(action) {
  Promise.resolve().then(action).catch((error) => {
    console.error(error);
    showToast(error?.message || "分类导入/导出失败");
  });
}

function triggerAssetCategoryWorkbookAction(action) {
  if (state.assetCategoryImportBusy) return;
  const requiredPermission = {
    template: "asset:category_settings:template",
    import: "asset:category_settings:import",
    export: "asset:category_settings:export",
  }[action];
  if (!requiredPermission || !ensureAnyPermission([requiredPermission])) return;
  if (action === "template") return runAssetCategoryWorkbookAction(downloadAssetCategoryTemplate);
  if (action === "export") return runAssetCategoryWorkbookAction(exportAssetCategoryWorkbook);
  const input = document.querySelector("[data-category-import-file]");
  if (!input) return;
  input.value = "";
  input.click();
}

function handleAssetCategoryImportFile(file) {
  if (!ensureAnyPermission(["asset:category_settings:import"])) return;
  if (!file || state.assetCategoryImportBusy) return;
  if (!/\.xlsx$/i.test(file.name || "")) return showToast("请上传 .xlsx 分类导入模板");
  state.assetCategoryImportBusy = true;
  showToast("正在导入分类...");
  runAssetCategoryWorkbookAction(async () => {
    try {
      await importAssetCategoryWorkbook(file);
    } finally {
      state.assetCategoryImportBusy = false;
    }
  });
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
  if (!hasPermission("asset:category_settings:toggleCode")) return renderAssetCodeSwitch(row.enabled);
  return `<button class="asset-code-switch-button" type="button" data-category-toggle-code="${escapeHtml(row.id)}" aria-pressed="${row.enabled ? "true" : "false"}">${renderAssetCodeSwitch(row.enabled)}</button>`;
}

function renderAssetCategoryRows(rows) {
  return rows.length
    ? rows
        .map((row) => {
          const actions = [
            hasPermission("asset:category_settings:update")
              ? `<button class="link" type="button" data-category-edit="${escapeHtml(row.id)}">编辑</button>`
              : "",
            hasPermission("asset:category_settings:delete")
              ? `<button class="link" type="button" data-category-delete="${escapeHtml(row.id)}">删除</button>`
              : "",
          ].filter(Boolean);
          return `<tr>
                    <td data-category-row="${escapeHtml(row.id)}">${escapeHtml(row.code)}</td>
                    <td>${escapeHtml(row.name)}</td>
                    <td>${escapeHtml(row.parentName)}</td>
                    <td>${escapeHtml(row.usefulLife)}</td>
                    <td>${escapeHtml(row.unit)}</td>
                    <td>${renderAssetCategorySwitchButton(row)}</td>
                    <td>${actions.join('<span class="action-separator">|</span>') || "-"}</td>
                  </tr>`;
        })
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

async function toggleAssetCategoryCodeEnabled(id) {
  if (!ensureAnyPermission(["asset:category_settings:toggleCode"])) return;
  const found = findAssetCategoryNodeById(id);
  if (!found) return;
  const previous = found.node.enabled;
  found.node.enabled = !found.node.enabled;
  try {
    await saveAssetCategoryTree();
  } catch (error) {
    found.node.enabled = previous;
    throw error;
  }
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
  const requiredPermission = id ? "asset:category_settings:update" : "asset:category_settings:create";
  if (!ensureAnyPermission([requiredPermission])) return;
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

async function commitAssetCategoryForm(form) {
  const requiredPermission = form.dataset.categoryId ? "asset:category_settings:update" : "asset:category_settings:create";
  if (!ensureAnyPermission([requiredPermission])) return false;
  const code = formValue(form, "categoryCode");
  const name = formValue(form, "categoryName");
  const parentId = formValue(form, "parentId");
  const usefulLife = formValue(form, "usefulLife");
  const unit = formValue(form, "unit");
  const enabled = formValue(form, "enabled") !== "false";
  const previousTree = cloneAssetCategoryTree(assetCategoryTree);
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
    Object.assign(found.node, { code, name, usefulLife, unit, enabled });
    if ((found.parent?.id || "") !== parentId) {
      const moved = removeAssetCategoryNodeById(editingId);
      if (!insertAssetCategoryNode(moved, parentId)) assetCategoryTree.push(moved);
    }
  } else {
    insertAssetCategoryNode({ id: createAssetCategoryId(), code, name, usefulLife, unit, enabled, children: [] }, parentId);
  }
  try {
    await saveAssetCategoryTree();
    return true;
  } catch (error) {
    assetCategoryTree = previousTree;
    throw error;
  }
}

async function deleteAssetCategory(id) {
  if (!ensureAnyPermission(["asset:category_settings:delete"])) return;
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
  const previousTree = cloneAssetCategoryTree(assetCategoryTree);
  removeAssetCategoryNodeById(id);
  try {
    await saveAssetCategoryTree();
  } catch (error) {
    assetCategoryTree = previousTree;
    throw error;
  }
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
    void deleteAssetCategory(remove.dataset.categoryDelete).catch((error) => showToast(error?.message || "分类删除失败"));
    return;
  }
  const toggle = event.target.closest("[data-category-toggle-code]");
  if (toggle) {
    void toggleAssetCategoryCodeEnabled(toggle.dataset.categoryToggleCode)
      .catch((error) => showToast(error?.message || "分类状态保存失败"));
  }
}

function renderAssetCategorySettings(activeSection) {
  const rows = filteredAssetCategoryRows();
  const pagination = paginateRows(rows, "assetCategory");
  const canUseWorkbook = hasAnyPermission([
    "asset:category_settings:template",
    "asset:category_settings:import",
    "asset:category_settings:export",
  ]);
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
            ${hasPermission("asset:category_settings:create") ? '<button class="table-action primary" type="button" data-category-create>＋ 新增分类</button>' : ""}
            ${canUseWorkbook ? `<div class="table-action-menu location-import-export-menu">
              <button class="table-action has-caret" type="button">导入/导出<span class="action-caret" aria-hidden="true"></span></button>
              <div class="table-dropdown wide">
                ${hasPermission("asset:category_settings:template") ? '<button type="button" data-category-workbook-action="template">下载模板</button>' : ""}
                ${hasPermission("asset:category_settings:import") ? '<button type="button" data-category-workbook-action="import">导入分类</button>' : ""}
                ${hasPermission("asset:category_settings:export") ? '<button type="button" data-category-workbook-action="export">导出分类</button>' : ""}
              </div>
            </div>` : ""}
          </div>
        </div>
        <input type="file" accept=".xlsx" data-category-import-file hidden>
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
        .map((row) => {
          const actions = [
            hasPermission("asset:location_settings:update")
              ? `<button class="link" type="button" data-location-edit="${escapeHtml(row.id)}">编辑</button>`
              : "",
            hasPermission("asset:location_settings:delete")
              ? `<button class="link" type="button" data-location-delete="${escapeHtml(row.id)}">删除</button>`
              : "",
          ].filter(Boolean);
          return `<tr>
                    <td data-location-row="${escapeHtml(row.id)}">${escapeHtml(row.name)}</td>
                    <td>${escapeHtml(row.code)}</td>
                    <td>${escapeHtml(row.parent)}</td>
                    <td>${renderAssetCodeSwitchButton(row)}</td>
                    <td>${actions.join('<span class="action-separator">|</span>') || "-"}</td>
                  </tr>`;
        })
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
  const canUseWorkbook = hasAnyPermission([
    "asset:location_settings:template",
    "asset:location_settings:import",
    "asset:location_settings:export",
  ]);
  if (!canUseWorkbook) return "";
  return `<div class="table-action-menu location-import-export-menu">
    <button class="table-action has-caret" type="button">导入/导出<span class="action-caret" aria-hidden="true"></span></button>
    <div class="table-dropdown wide">
      ${hasPermission("asset:location_settings:template") ? '<button type="button" data-location-workbook-action="template">下载模板</button>' : ""}
      ${hasPermission("asset:location_settings:import") ? '<button type="button" data-location-workbook-action="import">导入位置</button>' : ""}
      ${hasPermission("asset:location_settings:export") ? '<button type="button" data-location-workbook-action="export">导出位置</button>' : ""}
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
            ${hasPermission("asset:location_settings:create") ? '<button class="table-action primary" type="button" data-location-create>＋ 新增位置</button>' : ""}
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
  const requiredPermission = id ? "asset:location_settings:update" : "asset:location_settings:create";
  if (!ensureAnyPermission([requiredPermission])) return;
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

async function commitLocationForm(form) {
  const requiredPermission = form.dataset.locationId ? "asset:location_settings:update" : "asset:location_settings:create";
  if (!ensureAnyPermission([requiredPermission])) return false;
  const name = formValue(form, "locationName");
  const code = formValue(form, "locationCode") || locationCodeForName(name);
  const parentId = formValue(form, "parentId");
  const enabled = formValue(form, "enabled") !== "false";
  const previousTree = cloneLocationTree(assetLocationTree);
  if (!name) {
    showToast("请填写位置名称");
    return false;
  }

  const editingId = form.dataset.locationId || "";
  if (editingId) {
    const found = findLocationNodeById(editingId);
    if (!found) return false;
    const node = found.node;
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
  try {
    await saveAssetLocationTree();
    return true;
  } catch (error) {
    assetLocationTree = previousTree;
    refreshAssetLocationOptions();
    throw error;
  }
}

async function deleteLocation(id) {
  if (!ensureAnyPermission(["asset:location_settings:delete"])) return;
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
  const previousTree = cloneLocationTree(assetLocationTree);
  removeLocationNodeById(id);
  refreshAssetLocationOptions();
  try {
    await saveAssetLocationTree();
  } catch (error) {
    assetLocationTree = previousTree;
    refreshAssetLocationOptions();
    throw error;
  }
  render();
  showToast("位置已删除");
}

async function toggleLocationCodeEnabled(id) {
  if (!ensureAnyPermission(["asset:location_settings:toggleCode"])) return;
  const found = findLocationNodeById(id);
  if (!found) return;
  const previous = found.node.enabled;
  found.node.enabled = !found.node.enabled;
  try {
    await saveAssetLocationTree();
  } catch (error) {
    found.node.enabled = previous;
    throw error;
  }
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
    void deleteLocation(remove.dataset.locationDelete).catch((error) => showToast(error?.message || "位置删除失败"));
    return;
  }
  const toggle = event.target.closest("[data-location-toggle-code]");
  if (toggle) {
    void toggleLocationCodeEnabled(toggle.dataset.locationToggleCode)
      .catch((error) => showToast(error?.message || "位置状态保存失败"));
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
  return `<div class="asset-kpi"><div class="detail-label">${escapeHtml(label)}</div><strong>${escapeHtml(value)}</strong><div class="panel-subtitle">${escapeHtml(note)}</div></div>`;
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
  return `<span class="tag ${color}">${escapeHtml(risk)}</span>`;
}

function completeness(value) {
  const numericValue = Math.max(0, Math.min(100, Number(value) || 0));
  const color = numericValue >= 90 ? "green" : numericValue >= 80 ? "amber" : "red";
  return `<div class="complete"><span>${numericValue}%</span><i><b class="${color}" style="width:${numericValue}%"></b></i></div>`;
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
  const active = state.employeeRequestActiveType === item.request;
  return `<button class="employee-request-action ${active ? "active" : ""}" type="button" data-open-request="${escapeHtml(item.request)}" aria-pressed="${active ? "true" : "false"}">
    <span class="employee-request-action-icon ${escapeHtml(item.tone)}">${employeeRequestActionIcon(item.icon)}</span>
    <span class="employee-request-action-label">${escapeHtml(item.label)}</span>
  </button>`;
}

function employeeRequestStatusGroup(status = "") {
  if (["审批中", "待审批", "待审核", "待处理"].includes(status)) return "pending";
  if (["已完成", "已同意", "已通过", "同意", "通过"].includes(status)) return "approved";
  if (["已驳回", "驳回", "已拒绝", "拒绝"].includes(status)) return "rejected";
  return "pending";
}

function employeeRequestActions() {
  return [
    { label: "资产领用", request: "资产领用", icon: "receive", tone: "blue", settingKey: "receiveAsset" },
    { label: "资产借用", request: "资产借用", icon: "borrow", tone: "sky", settingKey: "borrowAsset" },
    { label: "资产归还", request: "资产归还", icon: "giveBack", tone: "orange", settingKey: "giveBackAsset" },
    { label: "资产退还", request: "资产退还", icon: "returnAsset", tone: "violet", settingKey: "returnAsset" },
    { label: "资产交接", request: "资产交接", icon: "handover", tone: "green", settingKey: "handoverAsset" },
  ].filter((item) => state.selfServiceSettings?.[item.settingKey]?.enabled === true);
}

const selfServiceSettingKeyByRequestType = {
  资产领用: "receiveAsset",
  资产借用: "borrowAsset",
  资产归还: "giveBackAsset",
  资产退还: "returnAsset",
  资产交接: "handoverAsset",
};

function enabledSelfServiceRequestSettings(type) {
  const key = selfServiceSettingKeyByRequestType[type];
  const settings = key ? state.selfServiceSettings?.[key] : null;
  return settings?.enabled === true ? settings : null;
}

function employeeRequestRows() {
  return getScopedRequests();
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
        (tab) => `<button class="${activeTab === tab.key ? "active" : ""}" type="button" role="tab" aria-selected="${activeTab === tab.key ? "true" : "false"}" data-employee-request-tab="${escapeHtml(tab.key)}">
          ${escapeHtml(tab.label)} (${escapeHtml(tab.count)})
        </button>`
      )
      .join("")}
  </div>`;
}

function employeeRequestCardStatus(item) {
  const group = employeeRequestStatusGroup(item.status);
  if (group === "approved") return { label: item.status === "已完成" ? "已同意" : item.status || "已同意", tone: "approved" };
  if (group === "rejected") return { label: "已驳回", tone: "rejected" };
  return { label: item.status || "待审批", tone: "pending" };
}

function renderEmployeeRequestCard(item) {
  const status = employeeRequestCardStatus(item);
  const assetCount = typeof item.assetCount !== "undefined" ? item.assetCount : item.asset ? 1 : "-";
  return `<article class="employee-request-card">
    <div class="employee-request-card-main">
      <div class="employee-request-card-title">
        <span class="employee-request-status-pill ${status.tone}">${escapeHtml(status.label)}</span>
        <strong>${escapeHtml(item.type)}</strong>
      </div>
      <div class="employee-request-card-fields">
        <div><span>单据编号</span><strong>${escapeHtml(item.id)}</strong></div>
        <div><span>发起时间</span><strong>${escapeHtml(item.date || "-")}</strong></div>
        <div><span>审批时间</span><strong>${employeeRequestStatusGroup(item.status) === "pending" ? "-" : escapeHtml(item.approvalDate || item.date || "-")}</strong></div>
        <div><span>资产数量</span><strong>${escapeHtml(assetCount)}</strong></div>
      </div>
    </div>
    <button class="btn employee-request-detail" type="button" data-request="${escapeHtml(item.id)}">查看详情</button>
  </article>`;
}

function renderRequests() {
  if (hasManagementExperience() && hasPermission("asset:request:review")) {
    return `${pageHeader("审批管理", "处理资产及业务申请，审批结果由服务端记录。", "新建申请", "request")}
      <section class="panel"><div class="table-wrap"><table>
        <thead><tr><th>单据编号</th><th>类型</th><th>申请人</th><th>关联物品</th><th>原因</th><th>状态</th><th>当前节点</th><th>操作</th></tr></thead>
        <tbody>${state.requests.length ? state.requests.map((item) => `<tr>
          <td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.applicant)}</td><td>${escapeHtml(item.asset)}</td>
          <td>${escapeHtml(item.reason || "-")}</td><td>${statusTag(item.status)}</td><td>${escapeHtml(item.currentNode || "-")}</td>
          <td>${["审批中", "待执行"].includes(item.status) ? `<button class="btn primary" data-request-decision="${escapeHtml(item.id)}" data-decision="approve">批准</button> <button class="btn" data-request-decision="${escapeHtml(item.id)}" data-decision="reject">拒绝</button>` : `<button class="btn" data-request="${escapeHtml(item.id)}">查看</button>`}</td>
        </tr>`).join("") : `<tr class="empty-row"><td colspan="8">暂无审批单据。</td></tr>`}</tbody>
      </table></div></section>`;
  }

  const actions = employeeRequestActions();
  const rows = employeeRequestRows();
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

async function decideBusinessRequest(id, decision) {
  if (!ensureAnyPermission(["asset:request:review"])) return;
  try {
    const response = await fetch(`/api/business-data/requests/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      headers: ecpSessionHeaders({ "content-type": "application/json; charset=utf-8" }),
      body: JSON.stringify({ decision, operator: state.currentUser?.name || "管理员", reason: decision === "reject" ? "管理员拒绝" : "审批通过" }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `审批失败（HTTP ${response.status}）`);
    if (Array.isArray(result.items)) state.requests = result.items;
    businessDataVersions.requests = Number(result.version) || businessDataVersions.requests;
    render();
    showToast(decision === "approve" ? "审批已通过" : "审批已拒绝");
  } catch (error) { showToast(error?.message || "审批失败"); }
}

function employeeRequestSelectableAssets(anchorAsset = null, settingKey = "") {
  const scopedRows = getScopedAllAssets();
  const allowedCategories = new Set(state.selfServiceSettings?.[settingKey]?.categories || []);
  const isSelectable = (asset) =>
    (!allowedCategories.size || allowedCategories.has(asset.category))
    && ["空闲", "闲置", "上架", "待验收"].includes(asset.status)
    && (!asset.owner || asset.owner === "未分配");
  const availableRows = scopedRows.filter(isSelectable);
  const fallbackRows = settingKey
    ? availableRows
    : availableRows.length ? availableRows : scopedRows.length ? scopedRows : state.assets;
  const rows = [anchorAsset && isSelectable(anchorAsset) ? anchorAsset : null, ...fallbackRows].filter(Boolean);
  return Array.from(new Map(rows.map((asset) => [asset.id, asset])).values());
}

function employeeOwnedRequestAssets(type, anchorAsset = null) {
  const statuses = {
    资产归还: new Set(["借用中"]),
    资产退还: new Set(["在用"]),
    资产交接: new Set(["在用", "借用中"]),
  }[type] || new Set();
  const userName = state.currentUser?.name || "";
  const isSelectable = (asset) => statuses.has(asset.status) && asset.owner === userName;
  const rows = [anchorAsset && isSelectable(anchorAsset) ? anchorAsset : null, ...getScopedAllAssets().filter(isSelectable)].filter(Boolean);
  return Array.from(new Map(rows.map((asset) => [asset.id, asset])).values());
}

function employeeRequestCategoryMarkup(assets) {
  const categories = Array.from(new Set(assets.map((asset) => asset.category || "未分类").filter(Boolean)));
  const primary = categories[0] || "全部资产";
  return `<div class="employee-request-category-list">
    <button type="button" class="active" data-employee-request-category="all">全部资产</button>
    <button type="button" data-employee-request-category="${escapeHtml(primary)}">${escapeHtml(primary)}</button>
    ${categories
      .filter((category) => category !== primary)
      .slice(0, 8)
      .map((category) => `<button type="button" data-employee-request-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`)
      .join("")}
  </div>`;
}

function renderEmployeeRequestAssetCard(asset, selectedIds) {
  const checked = selectedIds.has(asset.id);
  return `<label class="employee-request-asset-card" data-employee-request-asset-card data-category="${escapeHtml(asset.category || "未分类")}">
    <input type="checkbox" name="assetIds" value="${escapeHtml(asset.id)}" data-employee-request-asset ${checked ? "checked" : ""}>
    <span class="employee-request-asset-meta">
      <strong>资产编码：${escapeHtml(asset.id)}</strong>
      <span>资产名称：${escapeHtml(asset.name || "-")}</span>
      <span>设备序列号：${escapeHtml(asset.sn || "-")}</span>
      <span>所在位置：${escapeHtml(asset.location || "-")}</span>
      <span>品牌型号：${escapeHtml([asset.brand, asset.model].filter(Boolean).join(" ") || "-")}</span>
      <span>管理员：${escapeHtml(asset.custodian || "-")}</span>
    </span>
  </label>`;
}

function renderEmployeeSelectedAssets(assets) {
  if (!assets.length) {
    return `<div class="employee-request-selected-empty">暂未选择资产</div>`;
  }
  return assets
    .map(
      (asset) => `<article class="employee-request-selected-card" data-employee-request-selected="${escapeHtml(asset.id)}">
        <button type="button" class="employee-request-selected-remove" data-employee-request-remove-asset="${escapeHtml(asset.id)}" aria-label="移除${escapeHtml(asset.id)}">⊖</button>
        <strong>资产编码：${escapeHtml(asset.id)}</strong>
        <span>资产名称：${escapeHtml(asset.name || "-")}</span>
        <span>设备序列号：${escapeHtml(asset.sn || "-")}</span>
        <span>所在位置：${escapeHtml(asset.location || "-")}</span>
        <span>品牌型号：${escapeHtml([asset.brand, asset.model].filter(Boolean).join(" ") || "-")}</span>
        <span>管理员：${escapeHtml(asset.custodian || "-")}</span>
      </article>`
    )
    .join("");
}

function employeeRequestOperatorOptions(user = {}) {
  return Array.from(
    new Set([user.name, ...uniqueAssetFormValues("custodian")].filter(Boolean))
  );
}

function employeeAssetRequestPickerMarkup(assets, selectedIds, selectedAssets) {
  return `<section class="employee-request-picker-section">
      <label class="employee-request-asset-number">
        <span>数字：</span>
        <input type="search" data-employee-request-query placeholder="请输入/请选择" autocomplete="off">
      </label>
      <div class="employee-request-picker-grid">
        <aside class="employee-request-picker-categories" aria-label="资产分类">
          <strong>资产分类</strong>
          ${employeeRequestCategoryMarkup(assets)}
        </aside>
        <section class="employee-request-picker-assets" aria-label="请选择资产">
          <div class="employee-request-picker-toolbar">
            <strong>请选择资产</strong>
            <div class="asset-list-search employee-request-picker-search">
              <input type="search" data-employee-request-inline-query placeholder="资产筛选" autocomplete="off">
              <button type="button" class="table-action primary" data-employee-request-search aria-label="搜索">⌕</button>
            </div>
          </div>
          <div class="employee-request-asset-list">
            ${assets.length ? assets.map((item) => renderEmployeeRequestAssetCard(item, selectedIds)).join("") : `<div class="employee-request-selected-empty">暂无可选资产</div>`}
          </div>
        </section>
        <aside class="employee-request-picker-selected" aria-label="已选择资产">
          <div class="employee-request-selected-head">
            <strong>已选择资产 <span data-employee-request-selected-count>${selectedAssets.length}</span></strong>
            <button type="button" data-employee-request-clear>清空</button>
          </div>
          <div class="employee-request-selected-list" data-employee-request-selected-list>
            ${renderEmployeeSelectedAssets(selectedAssets)}
          </div>
        </aside>
      </div>
    </section>`;
}

function employeeAssetReceiveFormMarkup(asset = null) {
  const user = state.currentUser || {};
  const settings = enabledSelfServiceRequestSettings("资产领用");
  const assets = employeeRequestSelectableAssets(asset, "receiveAsset");
  const selectedIds = new Set(asset ? [asset.id] : []);
  const selectedAssets = assets.filter((item) => selectedIds.has(item.id));
  const company = user.company || asset?.company || asset?.ownerCompany || "默认公司";
  const department = user.department || asset?.department || "默认部门";
  const operatorOptions = employeeRequestOperatorOptions(user);
  return `<form id="demoForm" class="employee-asset-request-form" data-mode="employee-asset-receive">
    <section class="employee-request-form-section">
      <div class="employee-request-form-grid">
        <div class="field"><label>领用人：</label><input name="receiver" value="${escapeHtml(user.name || "")}" readonly data-locked-field></div>
        <div class="field"><label><span class="required-star">*</span>所属公司：</label><input name="company" required value="${escapeHtml(company)}" readonly data-locked-field></div>
        <div class="field"><label>所在部门：</label><input name="department" value="${escapeHtml(department)}" readonly data-locked-field></div>
        <div class="field"><label><span class="required-star">*</span>领用后位置：</label>${inlineSelect("receiveLocation", "领用后位置", assetLocationOptions, { required: true, selected: asset?.location || "" })}</div>
        <div class="field"><label><span class="required-star">*</span>经办人：</label>${inlineSelect("operator", "经办人", operatorOptions.length ? operatorOptions : [user.name || "经办人"], { required: true, selected: user.name || "" })}</div>
        <div class="field"><label><span class="required-star">*</span>领用日期：</label><input name="receiveDate" required type="date" value="${todayValue()}"></div>
        <div class="field full"><label>${settings?.remarkRequired ? '<span class="required-star">*</span>' : ""}领用备注：</label><textarea name="receiveNote" ${settings?.remarkRequired ? "required" : ""} placeholder="${escapeHtml(settings?.remarkPrompt || "请输入领用备注")}"></textarea></div>
      </div>
    </section>
    ${employeeAssetRequestPickerMarkup(assets, selectedIds, selectedAssets)}
    <div class="modal-actions employee-request-modal-actions">
      <button type="button" class="btn" data-cancel-modal>关闭</button>
      <button type="submit" class="btn primary">签字并提交</button>
    </div>
  </form>`;
}

function employeeAssetBorrowFormMarkup(asset = null) {
  const user = state.currentUser || {};
  const settings = enabledSelfServiceRequestSettings("资产借用");
  const assets = employeeRequestSelectableAssets(asset, "borrowAsset");
  const selectedIds = new Set(asset ? [asset.id] : []);
  const selectedAssets = assets.filter((item) => selectedIds.has(item.id));
  const company = user.company || asset?.company || asset?.ownerCompany || "默认公司";
  const department = user.department || asset?.department || "默认部门";
  const operatorOptions = employeeRequestOperatorOptions(user);
  return `<form id="demoForm" class="employee-asset-request-form" data-mode="employee-asset-borrow">
    <section class="employee-request-form-section">
      <div class="employee-request-form-grid">
        <div class="field"><label>借用人：</label><input name="borrower" value="${escapeHtml(user.name || "")}" readonly data-locked-field></div>
        <div class="field"><label><span class="required-star">*</span>所属公司：</label><input name="company" required value="${escapeHtml(company)}" readonly data-locked-field></div>
        <div class="field"><label><span class="required-star">*</span>所在部门：</label><input name="department" required value="${escapeHtml(department)}" readonly data-locked-field></div>
        <div class="field"><label><span class="required-star">*</span>借用后位置：</label>${inlineSelect("borrowLocation", "借用后位置", assetLocationOptions, { required: true, selected: asset?.location || "" })}</div>
        <div class="field"><label><span class="required-star">*</span>经办人：</label>${inlineSelect("operator", "请选择经办人", operatorOptions.length ? operatorOptions : [user.name || "经办人"], { required: true })}</div>
        <div class="field"><label><span class="required-star">*</span>借用日期：</label><input name="borrowDate" required type="date" value="${todayValue()}"></div>
        <div class="field"><label><span class="required-star">*</span>预计归还日期：</label><input name="expectedReturnDate" required type="date" value="${dateOffsetValue(7)}"></div>
        <div class="field full"><label>${settings?.remarkRequired ? '<span class="required-star">*</span>' : ""}借用备注：</label><textarea name="borrowNote" ${settings?.remarkRequired ? "required" : ""} placeholder="${escapeHtml(settings?.remarkPrompt || "请输入借用备注")}"></textarea></div>
      </div>
    </section>
    ${employeeAssetRequestPickerMarkup(assets, selectedIds, selectedAssets)}
    <div class="modal-actions employee-request-modal-actions">
      <button type="button" class="btn" data-cancel-modal>关闭</button>
      <button type="submit" class="btn primary">签字并提交</button>
    </div>
  </form>`;
}

function employeeOwnedAssetRequestFormMarkup(type, asset = null) {
  const user = state.currentUser || {};
  const settings = enabledSelfServiceRequestSettings(type);
  const assets = employeeOwnedRequestAssets(type, asset);
  const selectedIds = new Set(asset && assets.some((item) => item.id === asset.id) ? [asset.id] : []);
  const selectedAssets = assets.filter((item) => selectedIds.has(item.id));
  const locationLabel = type === "资产交接" ? "接收位置" : type === "资产退还" ? "退还后位置" : "归还后位置";
  const dateLabel = type === "资产交接" ? "交接日期" : type === "资产退还" ? "退还日期" : "归还日期";
  const noteLabel = type.replace(/^资产/, "") + "备注";
  return `<form id="demoForm" class="employee-asset-request-form" data-mode="employee-owned-asset-request" data-request-type="${escapeHtml(type)}">
    <section class="employee-request-form-section">
      <div class="employee-request-form-grid">
        <div class="field"><label>申请人：</label><input name="applicant" value="${escapeHtml(user.name || "")}" readonly data-locked-field></div>
        <div class="field"><label>所属公司：</label><input name="company" value="${escapeHtml(user.company || "默认公司")}" readonly data-locked-field></div>
        <div class="field"><label>所在部门：</label><input name="department" value="${escapeHtml(user.department || "默认部门")}" readonly data-locked-field></div>
        <div class="field"><label><span class="required-star">*</span>${escapeHtml(locationLabel)}：</label>${inlineSelect("targetLocation", locationLabel, assetLocationOptions, { required: true, selected: asset?.location || "" })}</div>
        <div class="field"><label><span class="required-star">*</span>${escapeHtml(dateLabel)}：</label><input name="targetDate" required type="date" value="${todayValue()}"></div>
        ${
          type === "资产交接"
            ? `<div class="field"><label>交接类型：</label><input value="员工交接" readonly data-locked-field></div>
               <div class="field" data-handover-personal><label><span class="required-star">*</span>接收人：</label>${directoryPersonSelect("receiverSubject")}</div>`
            : ""
        }
        <div class="field full"><label>${settings?.remarkRequired ? '<span class="required-star">*</span>' : ""}${escapeHtml(noteLabel)}：</label><textarea name="requestNote" ${settings?.remarkRequired ? "required" : ""} placeholder="${escapeHtml(settings?.remarkPrompt || `请输入${noteLabel}`)}"></textarea></div>
      </div>
    </section>
    ${employeeAssetRequestPickerMarkup(assets, selectedIds, selectedAssets)}
    <div class="modal-actions employee-request-modal-actions">
      <button type="button" class="btn" data-cancel-modal>关闭</button>
      <button type="submit" class="btn primary">提交申请</button>
    </div>
  </form>`;
}

async function saveEmployeeAssetReceiveRequest(form) {
  if (!ensureAnyPermission(["asset:request:create"])) return false;
  const settings = enabledSelfServiceRequestSettings("资产领用");
  if (!settings) return showToast("资产领用自助申请当前未启用"), false;
  const selectedIds = Array.from(form.querySelectorAll("[data-employee-request-asset]:checked")).map((input) => input.value).filter(Boolean);
  const selectedAssets = selectedIds.map((id) => state.assets.find((asset) => asset.id === id)).filter(Boolean);
  const receiver = formValue(form, "receiver") || state.currentUser?.name || "员工";
  const receiveDate = formValue(form, "receiveDate") || todayValue();
  const receiveLocation = normalizeLocationValue(formValue(form, "receiveLocation"));
  const operator = formValue(form, "operator");
  const note = formValue(form, "receiveNote");
  if (settings.remarkRequired && !note) {
    showToast("请填写领用备注");
    return false;
  }
  if (!selectedAssets.length) {
    showToast("请先勾选要领用的资产");
    return false;
  }
  if (!receiveLocation || !operator) {
    showToast("请填写领用后位置和经办人");
    return false;
  }
  if (!validateManagedAssetLocation(receiveLocation, "请选择位置管理中的领用后位置")) return false;
  const created = await createBusinessRequest({
    type: "资产领用",
    applicant: receiver,
    asset: selectedAssets.map((asset) => asset.name || asset.id).join("、"),
    reason: note,
    assetCount: selectedAssets.length,
    assetIds: selectedIds,
    operator,
    receiveLocation,
    receiveDate,
  });
  if (!created) return false;
  state.employeeRequestTab = "pending";
  state.employeeRequestActiveType = "资产领用";
  return true;
}

async function saveEmployeeAssetBorrowRequest(form) {
  if (!ensureAnyPermission(["asset:request:create"])) return false;
  const settings = enabledSelfServiceRequestSettings("资产借用");
  if (!settings) return showToast("资产借用自助申请当前未启用"), false;
  const selectedIds = Array.from(form.querySelectorAll("[data-employee-request-asset]:checked")).map((input) => input.value).filter(Boolean);
  const selectedAssets = selectedIds.map((id) => state.assets.find((asset) => asset.id === id)).filter(Boolean);
  const borrower = formValue(form, "borrower") || state.currentUser?.name || "员工";
  const borrowDate = formValue(form, "borrowDate") || todayValue();
  const expectedReturnDate = formValue(form, "expectedReturnDate");
  const borrowLocation = normalizeLocationValue(formValue(form, "borrowLocation"));
  const operator = formValue(form, "operator");
  const note = formValue(form, "borrowNote");
  if (settings.remarkRequired && !note) {
    showToast("请填写借用备注");
    return false;
  }
  if (!selectedAssets.length) {
    showToast("请先勾选要借用的资产");
    return false;
  }
  if (!borrowLocation || !operator || !expectedReturnDate) {
    showToast("请填写借用后位置、经办人和预计归还日期");
    return false;
  }
  if (!validateManagedAssetLocation(borrowLocation, "请选择位置管理中的借用后位置")) return false;
  const created = await createBusinessRequest({
    type: "资产借用",
    applicant: borrower,
    asset: selectedAssets.map((asset) => asset.name || asset.id).join("、"),
    reason: note,
    assetCount: selectedAssets.length,
    assetIds: selectedIds,
    operator,
    borrowLocation,
    borrowDate,
    expectedReturnDate,
  });
  if (!created) return false;
  state.employeeRequestTab = "pending";
  state.employeeRequestActiveType = "资产借用";
  return true;
}

async function saveEmployeeOwnedAssetRequest(form) {
  if (!ensureAnyPermission(["asset:request:create"])) return false;
  const type = form.dataset.requestType || "";
  const settings = enabledSelfServiceRequestSettings(type);
  if (!settings) return showToast(`${type}自助申请当前未启用`), false;
  const selectedIds = Array.from(form.querySelectorAll("[data-employee-request-asset]:checked")).map((input) => input.value).filter(Boolean);
  const selectedAssets = selectedIds.map((id) => state.assets.find((asset) => asset.id === id)).filter(Boolean);
  const location = normalizeLocationValue(formValue(form, "targetLocation"));
  const targetDate = formValue(form, "targetDate") || todayValue();
  const note = formValue(form, "requestNote");
  if (settings.remarkRequired && !note) {
    showToast("请填写申请备注");
    return false;
  }
  if (!selectedAssets.length) {
    showToast("请先勾选要处理的资产");
    return false;
  }
  if (!location || !targetDate) {
    showToast("请填写位置和日期");
    return false;
  }
  if (!validateManagedAssetLocation(location, "请选择位置管理中的位置")) return false;
  const draft = {
    type,
    applicant: state.currentUser?.name || "",
    asset: selectedAssets.map((item) => item.name || item.id).join("、"),
    reason: note,
    assetCount: selectedAssets.length,
    assetIds: selectedIds,
  };
  if (type === "资产归还" || type === "资产退还") {
    draft.returnLocation = location;
    draft.returnDate = targetDate;
  } else if (type === "资产交接") {
    const handoverType = formValue(form, "handoverType") || "personal";
    draft.handoverLocation = location;
    draft.handoverDate = targetDate;
    draft.handoverType = handoverType === "public" ? "公共交接" : "员工交接";
    if (handoverType !== "public") {
      const receiverSubject = formValue(form, "receiverSubject");
      if (!receiverSubject) {
        showToast("请选择交接接收人");
        return false;
      }
      draft.receiverSubject = receiverSubject;
    }
  }
  const created = await createBusinessRequest(draft);
  if (!created) return false;
  state.employeeRequestTab = "pending";
  state.employeeRequestActiveType = type;
  return true;
}

function bindEmployeeAssetReceiveForm(root = modal) {
  const form = root.querySelector(".employee-asset-request-form");
  if (!form || form.dataset.employeeAssetRequestBound === "true") return;
  form.dataset.employeeAssetRequestBound = "true";
  const selectedHost = form.querySelector("[data-employee-request-selected-list]");
  const selectedCount = form.querySelector("[data-employee-request-selected-count]");
  const cards = Array.from(form.querySelectorAll("[data-employee-request-asset-card]"));
  const syncSelectedAssets = () => {
    const selectedIds = Array.from(form.querySelectorAll("[data-employee-request-asset]:checked")).map((input) => input.value);
    const selectedAssets = selectedIds.map((id) => state.assets.find((asset) => asset.id === id)).filter(Boolean);
    if (selectedHost) selectedHost.innerHTML = renderEmployeeSelectedAssets(selectedAssets);
    if (selectedCount) selectedCount.textContent = String(selectedAssets.length);
    selectedHost?.querySelectorAll("[data-employee-request-remove-asset]").forEach((button) =>
      button.addEventListener("click", () => {
        const checkbox = Array.from(form.querySelectorAll("[data-employee-request-asset]")).find(
          (input) => input.value === button.dataset.employeeRequestRemoveAsset
        );
        if (checkbox) checkbox.checked = false;
        syncSelectedAssets();
      })
    );
  };
  const applyFilter = () => {
    const query = (form.querySelector("[data-employee-request-query]")?.value || form.querySelector("[data-employee-request-inline-query]")?.value || "")
      .trim()
      .toLowerCase();
    const activeCategory = form.querySelector("[data-employee-request-category].active")?.dataset.employeeRequestCategory || "all";
    cards.forEach((card) => {
      const categoryMatched = activeCategory === "all" || card.dataset.category === activeCategory;
      const queryMatched = !query || card.textContent.toLowerCase().includes(query);
      card.hidden = !categoryMatched || !queryMatched;
    });
  };
  form.querySelectorAll("[data-employee-request-asset]").forEach((input) => input.addEventListener("change", syncSelectedAssets));
  form.querySelector("[data-employee-request-clear]")?.addEventListener("click", () => {
    form.querySelectorAll("[data-employee-request-asset]").forEach((input) => {
      input.checked = false;
    });
    syncSelectedAssets();
  });
  form.querySelectorAll("[data-employee-request-category]").forEach((button) =>
    button.addEventListener("click", () => {
      form.querySelectorAll("[data-employee-request-category]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      applyFilter();
    })
  );
  form.querySelector("[data-employee-request-search]")?.addEventListener("click", applyFilter);
  form.querySelector("[data-employee-request-query]")?.addEventListener("input", applyFilter);
  form.querySelector("[data-employee-request-inline-query]")?.addEventListener("input", applyFilter);
  syncSelectedAssets();
}

function renderStocktake() {
  const rows = getScopedStocktakes();
  const canUpdate = hasPermission("asset:stocktake:update");
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
                        <td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.scope)}</td><td>${escapeHtml(item.owner)}</td>
                        <td>${statusTag(item.progress)} <div class="panel-subtitle">${escapeHtml(item.checked)}/${escapeHtml(item.total)} · ${escapeHtml(percent)}%</div></td>
                        <td>${escapeHtml(item.diff)}</td><td>${escapeHtml(item.date)}</td><td><button class="btn" data-stocktake="${escapeHtml(item.id)}">查看明细</button>${canUpdate ? ` <button class="btn" data-stocktake-update="${escapeHtml(item.id)}">登记进度</button>` : ""}</td>
                      </tr>`;
                    })
                    .join("")
                : `<tr class="empty-row"><td colspan="8">当前账号没有可查看的盘点任务。</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderConsumables() {
  const rows = state.consumables;
  const canAdjust = hasPermission("asset:consumable:adjust");
  return `
    ${pageHeader("耗材库存", "低值耗材不进入固定资产台账，但需要入库、领用、退库、调拨和库存预警。", "耗材入库", "consumable")}
    <section class="panel">
      ${toolbar(["耗材名称/型号", "仓库", "库存状态"])}
      <div class="table-wrap">
        <table>
          <thead><tr><th>耗材名称</th><th>型号</th><th>当前库存</th><th>最小库存</th><th>仓库</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${rows.length
              ? rows.map(
                (item) => `<tr>
                  <td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.model)}</td><td>${escapeHtml(item.stock)}</td><td>${escapeHtml(item.min)}</td><td>${escapeHtml(item.warehouse)}</td>
                  <td>${item.stock < item.min ? statusTag("待执行") : statusTag("在用")}</td>
                  <td>${canAdjust ? `<button class="btn" data-consumable-adjust="${escapeHtml(item.id)}" data-adjust-direction="-1">领取</button> <button class="btn" data-consumable-adjust="${escapeHtml(item.id)}" data-adjust-direction="1">入库</button>` : "-"}</td>
                </tr>`
              )
              .join("")
              : '<tr class="empty-row"><td colspan="7">当前范围内没有耗材数据。</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderRepair() {
  const failures = state.repairs;
  const canUpdate = hasPermission("asset:repair:update");
  const subtitle =
    !canUpdate
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
                        `<tr><td>${escapeHtml(item.asset)}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.reporter)}</td><td>${statusTag(item.status)}</td><td>${escapeHtml(item.handler)}</td><td>${canUpdate ? `<button class="btn" data-repair-update="${escapeHtml(item.id)}">处理</button>` : '<span class="tag gray">只读</span>'}</td></tr>`
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
      ${state.contracts.length
        ? state.contracts.map(
          (item) => `<article class="stat-card" data-watermark="CT">
            <div class="stat-top"><span>${escapeHtml(item.supplier)}</span>${statusTag(item.status)}</div>
            <div class="stat-value">${escapeHtml(item.id)}</div>
            <div class="stat-note">${escapeHtml(item.name)} · 至 ${escapeHtml(item.endDate)} · ¥${Number(item.amount || 0).toLocaleString("zh-CN")}</div>
          </article>`
        )
        .join("")
        : '<div class="empty-note">当前范围内没有合同数据。</div>'}
    </section>`;
}

function formatSystemConfigTimestamp(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function renderSystemIntegrations() {
  const canCreate = hasPermission("asset:integration:create");
  const canUpdate = hasPermission("asset:integration:update");
  return `<div class="system-content">
    <section class="panel">
      <div class="panel-header">
        <div><h2 class="panel-title">系统对接</h2><div class="panel-subtitle">${systemIntegrations.length} 个连接配置</div></div>
        ${canCreate ? '<button class="btn primary" type="button" data-system-integration-create>新增连接</button>' : ""}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>编码</th><th>名称</th><th>提供方</th><th>基础地址</th><th>状态</th><th>密钥</th><th>版本</th><th>更新时间</th><th>操作</th></tr></thead>
        <tbody>${systemIntegrations.length ? systemIntegrations.map((item) => `<tr>
          <td><code>${escapeHtml(item.code)}</code></td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.provider)}</td>
          <td>${escapeHtml(item.baseUrl)}</td><td>${statusTag(item.enabled ? "在用" : "已取消")}</td>
          <td>${item.secretConfigured ? '<span class="tag">已配置</span>' : '<span class="tag gray">未配置</span>'}</td>
          <td>${Number(item.version) || 1}</td><td>${escapeHtml(formatSystemConfigTimestamp(item.updatedAt))}</td>
          <td>${canUpdate ? `<button class="btn" type="button" data-system-integration-edit="${escapeHtml(item.id)}">编辑</button>` : "-"}</td>
        </tr>`).join("") : '<tr class="empty-row"><td colspan="9">当前范围内没有系统连接配置。</td></tr>'}</tbody>
      </table></div>
    </section>
  </div>`;
}

function renderSystemForms() {
  const canCreate = hasPermission("asset:form:create");
  const canUpdate = hasPermission("asset:form:update");
  const canDelete = hasPermission("asset:form:delete");
  return `<div class="system-content">
    <section class="panel">
      <div class="panel-header">
        <div><h2 class="panel-title">表单管理</h2><div class="panel-subtitle">${systemForms.length} 个表单定义</div></div>
        ${canCreate ? '<button class="btn primary" type="button" data-system-form-create>新增表单</button>' : ""}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>编码</th><th>名称</th><th>说明</th><th>状态</th><th>版本</th><th>更新时间</th><th>操作</th></tr></thead>
        <tbody>${systemForms.length ? systemForms.map((item) => `<tr>
          <td><code>${escapeHtml(item.code)}</code></td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.description || "-")}</td>
          <td>${statusTag(item.enabled ? "在用" : "已取消")}</td><td>${Number(item.version) || 1}</td>
          <td>${escapeHtml(formatSystemConfigTimestamp(item.updatedAt))}</td>
          <td>
            ${canUpdate ? `<button class="btn" type="button" data-system-form-edit="${escapeHtml(item.id)}">编辑</button>` : ""}
            ${canDelete ? `<button class="btn" type="button" data-system-form-delete="${escapeHtml(item.id)}">删除</button>` : ""}
            ${!canUpdate && !canDelete ? "-" : ""}
          </td>
        </tr>`).join("") : '<tr class="empty-row"><td colspan="7">当前范围内没有表单定义。</td></tr>'}</tbody>
      </table></div>
    </section>
  </div>`;
}

function systemIntegrationFormMarkup(integration = null) {
  const config = JSON.stringify(integration?.config || {}, null, 2);
  const enabled = integration ? integration.enabled : true;
  return `<form id="demoForm" class="system-config-form" data-mode="system-integration" data-system-integration-id="${escapeHtml(integration?.id || "")}">
    <div class="form-grid">
      <div class="field"><label><span class="required-star">*</span>连接编码</label><input name="code" required maxlength="64" pattern="[a-z][a-z0-9._-]{0,63}" value="${escapeHtml(integration?.code || "")}" autocomplete="off" /></div>
      <div class="field"><label><span class="required-star">*</span>连接名称</label><input name="name" required maxlength="100" value="${escapeHtml(integration?.name || "")}" autocomplete="off" /></div>
      <div class="field"><label><span class="required-star">*</span>提供方</label><input name="provider" required maxlength="40" pattern="[a-z][a-z0-9_-]{0,39}" value="${escapeHtml(integration?.provider || "")}" autocomplete="off" /></div>
      <div class="field"><label><span class="required-star">*</span>基础地址</label><input name="baseUrl" type="url" required maxlength="2048" value="${escapeHtml(integration?.baseUrl || "")}" autocomplete="off" /></div>
      <div class="field full"><label>连接参数（JSON）</label><textarea name="config" rows="9" spellcheck="false">${escapeHtml(config)}</textarea></div>
      <div class="field"><label>${integration?.secretConfigured ? "更新密钥" : "密钥"}</label><input name="secret" type="password" maxlength="4096" autocomplete="new-password" /></div>
      <div class="field"><label>连接状态</label><label><input name="enabled" type="checkbox" ${enabled ? "checked" : ""} /> 启用</label></div>
      ${integration?.secretConfigured ? '<div class="field"><label>密钥处理</label><label><input name="clearSecret" type="checkbox" /> 清除已有密钥</label></div>' : ""}
    </div>
    <div class="modal-actions"><button type="button" class="btn" data-cancel-modal>取消</button><button type="submit" class="btn primary">保存</button></div>
  </form>`;
}

function systemFormDefinitionMarkup(definition = null) {
  const schema = JSON.stringify(definition?.schema || { type: "object", properties: {} }, null, 2);
  const enabled = definition ? definition.enabled : true;
  return `<form id="demoForm" class="system-config-form" data-mode="system-form" data-system-form-id="${escapeHtml(definition?.id || "")}">
    <div class="form-grid">
      <div class="field"><label><span class="required-star">*</span>表单编码</label><input name="code" required maxlength="64" pattern="[a-z][a-z0-9._-]{0,63}" value="${escapeHtml(definition?.code || "")}" autocomplete="off" /></div>
      <div class="field"><label><span class="required-star">*</span>表单名称</label><input name="name" required maxlength="100" value="${escapeHtml(definition?.name || "")}" autocomplete="off" /></div>
      <div class="field full"><label>表单说明</label><textarea name="description" maxlength="1000" rows="3">${escapeHtml(definition?.description || "")}</textarea></div>
      <div class="field full"><label><span class="required-star">*</span>JSON Schema</label><textarea name="schema" required rows="14" spellcheck="false">${escapeHtml(schema)}</textarea></div>
      <div class="field"><label>表单状态</label><label><input name="enabled" type="checkbox" ${enabled ? "checked" : ""} /> 启用</label></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn" data-cancel-modal>取消</button><button type="submit" class="btn primary">保存</button></div>
  </form>`;
}

function parseSystemConfigJson(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || ""));
  } catch (error) {
    throw new Error(`${label} JSON 格式错误：${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return parsed;
}

function openSystemIntegrationModal(id = "") {
  const integration = id ? systemIntegrations.find((item) => item.id === id) : null;
  if (id && !integration) return showToast("连接配置已更新，请刷新后重试");
  const permission = integration ? "asset:integration:update" : "asset:integration:create";
  if (!ensureAnyPermission([permission])) return;
  modalTitle.textContent = integration ? "编辑系统连接" : "新增系统连接";
  modalBody.innerHTML = systemIntegrationFormMarkup(integration);
  openModal();
}

function openSystemFormModal(id = "") {
  const definition = id ? systemForms.find((item) => item.id === id) : null;
  if (id && !definition) return showToast("表单定义已更新，请刷新后重试");
  const permission = definition ? "asset:form:update" : "asset:form:create";
  if (!ensureAnyPermission([permission])) return;
  modalTitle.textContent = definition ? "编辑表单" : "新增表单";
  modalBody.innerHTML = systemFormDefinitionMarkup(definition);
  openModal();
}

function replaceSystemConfigItem(items, saved) {
  const index = items.findIndex((item) => item.id === saved.id);
  if (index >= 0) items.splice(index, 1, saved);
  else items.unshift(saved);
  items.sort((left, right) => String(left.code || "").localeCompare(String(right.code || ""), "zh-CN"));
}

async function saveSystemIntegrationForm(form) {
  const id = String(form.dataset.systemIntegrationId || "");
  const current = id ? systemIntegrations.find((item) => item.id === id) : null;
  if (id && !current) throw new Error("连接配置版本已变化，请重新打开后编辑");
  const permission = current ? "asset:integration:update" : "asset:integration:create";
  if (!ensureAnyPermission([permission])) return false;
  const data = new FormData(form);
  const secret = String(data.get("secret") || "");
  const clearSecret = data.has("clearSecret");
  if (clearSecret && secret) throw new Error("更新密钥和清除密钥不能同时选择");
  if (secret && !secret.trim()) throw new Error("密钥不能只包含空白字符");
  const body = {
    code: String(data.get("code") || "").trim(),
    name: String(data.get("name") || "").trim(),
    provider: String(data.get("provider") || "").trim(),
    baseUrl: String(data.get("baseUrl") || "").trim(),
    enabled: data.has("enabled"),
    config: parseSystemConfigJson(data.get("config"), "连接参数"),
    ...(secret ? { secret } : {}),
    ...(current ? { clearSecret, expectedVersion: Number(current.version) } : {}),
  };
  try {
    const saved = await systemConfigApiRequest(
      current ? `/api/system/integrations/${encodeURIComponent(current.id)}` : "/api/system/integrations",
      { method: current ? "PUT" : "POST", body }
    );
    replaceSystemConfigItem(systemIntegrations, saved);
    return true;
  } catch (error) {
    if (error.status === 409) await hydrateSystemIntegrations();
    throw error;
  }
}

async function saveSystemFormDefinition(form) {
  const id = String(form.dataset.systemFormId || "");
  const current = id ? systemForms.find((item) => item.id === id) : null;
  if (id && !current) throw new Error("表单版本已变化，请重新打开后编辑");
  const permission = current ? "asset:form:update" : "asset:form:create";
  if (!ensureAnyPermission([permission])) return false;
  const data = new FormData(form);
  const body = {
    code: String(data.get("code") || "").trim(),
    name: String(data.get("name") || "").trim(),
    description: String(data.get("description") || "").trim(),
    enabled: data.has("enabled"),
    schema: parseSystemConfigJson(data.get("schema"), "JSON Schema"),
    ...(current ? { expectedVersion: Number(current.version) } : {}),
  };
  try {
    const saved = await systemConfigApiRequest(
      current ? `/api/system/forms/${encodeURIComponent(current.id)}` : "/api/system/forms",
      { method: current ? "PUT" : "POST", body }
    );
    replaceSystemConfigItem(systemForms, saved);
    return true;
  } catch (error) {
    if (error.status === 409) await hydrateSystemForms();
    throw error;
  }
}

async function deleteSystemForm(id) {
  if (!ensureAnyPermission(["asset:form:delete"])) return;
  const current = systemForms.find((item) => item.id === id);
  if (!current) return showToast("表单定义已更新，请刷新后重试");
  if (!window.confirm(`确定删除表单“${current.name}”吗？`)) return;
  try {
    await systemConfigApiRequest(`/api/system/forms/${encodeURIComponent(current.id)}?expectedVersion=${encodeURIComponent(current.version)}`, { method: "DELETE" });
    systemForms = systemForms.filter((item) => item.id !== current.id);
    render();
    showToast("表单已删除");
  } catch (error) {
    if (error.status === 409) {
      await hydrateSystemForms();
      render();
    }
    showToast(error?.message || "表单删除失败");
  }
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
      <p class="empty-note">当前账号没有可访问的系统配置内容。</p>
    </section>
  </div>`;
}

function renderEmployeeDirectory() {
  const query = String(state.query || "").trim().toLowerCase();
  const rows = ecpDirectoryUsers.filter((user) => !query || [
    user.name,
    user.employeeNo,
    user.jobTitle,
    user.company,
    user.department,
    user.subject,
  ].some((value) => String(value || "").toLowerCase().includes(query)));
  return `<div class="system-content">
    <section class="panel">
      <div class="panel-header">
        <div><h2 class="panel-title">员工信息</h2><div class="panel-subtitle">${rows.length} 个 ECP 目录账号</div></div>
      </div>
      <div class="toolbar"><input class="local-search" type="search" placeholder="姓名、工号、岗位或组织" value="${escapeHtml(state.query)}"><button class="btn primary" data-search>查询</button><button class="btn" data-reset>重置</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>姓名</th><th>工号</th><th>岗位</th><th>所属公司</th><th>部门</th><th>ECP Subject</th><th>状态</th></tr></thead>
        <tbody>${rows.length ? rows.map((user) => `<tr>
          <td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.employeeNo || "-")}</td><td>${escapeHtml(user.jobTitle || "-")}</td>
          <td>${escapeHtml(user.company || "-")}</td><td>${escapeHtml(user.department || "-")}</td><td><code>${escapeHtml(user.subject)}</code></td>
          <td>${statusTag(user.status || "在用")}</td>
        </tr>`).join("") : '<tr class="empty-row"><td colspan="7">当前范围内没有员工目录数据。</td></tr>'}</tbody>
      </table></div>
    </section>
  </div>`;
}

function renderDepartmentDirectory() {
  const departments = new Map();
  ecpDirectoryUsers.forEach((user) => {
    const userDepartments = user.departments?.length
      ? user.departments
      : user.department ? [{ id: user.department, name: user.department, path: user.department }] : [];
    userDepartments.forEach((department) => {
      const key = `${user.company || ""}\u0000${department.id || department.path || department.name}`;
      const entry = departments.get(key) || {
        company: user.company || "-",
        name: department.name,
        path: department.path || department.name,
        members: 0,
      };
      entry.members += 1;
      departments.set(key, entry);
    });
  });
  const query = String(state.query || "").trim().toLowerCase();
  const rows = Array.from(departments.values())
    .filter((item) => !query || [item.company, item.name, item.path].some((value) => String(value).toLowerCase().includes(query)))
    .sort((left, right) => `${left.company}/${left.path}`.localeCompare(`${right.company}/${right.path}`, "zh-CN"));
  return `<div class="system-content">
    <section class="panel">
      <div class="panel-header"><div><h2 class="panel-title">组织架构</h2><div class="panel-subtitle">${rows.length} 个 ECP 目录部门</div></div></div>
      <div class="toolbar"><input class="local-search" type="search" placeholder="公司、部门或组织路径" value="${escapeHtml(state.query)}"><button class="btn primary" data-search>查询</button><button class="btn" data-reset>重置</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>所属公司</th><th>部门名称</th><th>组织路径</th><th>目录成员</th></tr></thead>
        <tbody>${rows.length ? rows.map((item) => `<tr><td>${escapeHtml(item.company)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.path)}</td><td>${item.members}</td></tr>`).join("") : '<tr class="empty-row"><td colspan="4">当前范围内没有组织目录数据。</td></tr>'}</tbody>
      </table></div>
    </section>
  </div>`;
}

function renderSelfServiceReadOnly() {
  const rows = selfServiceSettingItems.map((meta) => {
    const settings = state.selfServiceSettings[meta.key] || {};
    return `<tr><td>${escapeHtml(meta.title)}</td><td>${statusTag(settings.enabled ? "在用" : "已取消")}</td><td>${settings.remarkRequired ? "是" : "否"}</td><td>${escapeHtml((settings.categories || []).join("、") || "-")}</td></tr>`;
  });
  return `<div class="system-content"><section class="panel">
    <div class="panel-header"><div><h2 class="panel-title">员工自助</h2><div class="panel-subtitle">当前账号具有只读权限</div></div></div>
    <div class="table-wrap"><table><thead><tr><th>功能</th><th>状态</th><th>备注必填</th><th>可申请分类</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
  </section></div>`;
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
  state.selfServiceMenu = "员工自助管理";
  return renderSelfServiceMainSettings();
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
  if (!ensureAnyPermission(["asset:self_service:update"])) return;
  const [itemKey, fieldKey] = key.split(":");
  const meta = selfServiceSettingMeta(itemKey);
  const allowedFields = ["enabled", "remarkRequired", ...(meta.extraSwitches || []).map((item) => item.key)];
  if (!state.selfServiceSettings[itemKey] || !allowedFields.includes(fieldKey)) return;
  state.selfServiceSettings[itemKey][fieldKey] = !state.selfServiceSettings[itemKey][fieldKey];
  saveSelfServiceSettings();
  refreshSelfServiceManagement();
}

function removeSelfServiceReceiveCategory(itemKey, category) {
  if (!ensureAnyPermission(["asset:self_service:update"])) return;
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

async function saveSelfServiceReceiveSettings(form) {
  if (!ensureAnyPermission(["asset:self_service:update"])) return;
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
  if (await saveSelfServiceSettings()) showToast("员工自助配置已保存");
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
  if (!ensureAnyPermission(["asset:self_service:update"])) return;
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

async function saveSelfServiceSignSettings(form) {
  if (!ensureAnyPermission(["asset:self_service:update"])) return;
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
  if (await saveSelfServiceSettings()) showToast("签字设置已保存");
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
  document.querySelector("[data-self-service-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSelfServiceReceiveSettings(event.currentTarget);
  });
  document.querySelector("[data-self-service-sign-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSelfServiceSignSettings(event.currentTarget);
  });
}

function renderSystemMainContent() {
  if (state.systemMenu === "员工信息") return renderEmployeeDirectory();
  if (state.systemMenu === "组织架构") return renderDepartmentDirectory();
  if (state.systemMenu === "员工自助") {
    return hasPermission("asset:self_service:update")
      ? renderSelfServiceManagement()
      : renderSelfServiceReadOnly();
  }
  if (state.systemMenu === "系统对接") return renderSystemIntegrations();
  if (state.systemMenu === "表单管理") return renderSystemForms();
  const descriptions = {
    员工信息: "维护员工档案、账号归属和员工端登录基础信息。",
    组织架构: "维护公司、部门和组织同步后的层级结构。",
    员工自助: "配置员工领用、退库、借用、报修和签字确认能力。",
  };
  return renderSystemPlaceholder(state.systemMenu, descriptions[state.systemMenu] || "系统配置模块。");
}

function renderSettings() {
  const items = portalMenuItems()
    .filter((item) => item.parentId === "settings")
    .map((item) => ({ id: item.id, label: item.title }));
  if (!items.some((item) => item.label === state.systemMenu)) {
    state.systemMenu = items[0]?.label || "";
  }
  if (!items.length) return renderSystemPlaceholder("系统", "当前账号没有系统设置查看权限。");
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
            (item) => `<button class="asset-subnav-item ${state.systemMenu === item.label ? "active" : ""}" type="button" data-system-menu="${escapeHtml(item.label)}" data-system-menu-id="${escapeHtml(item.id)}">
              <span class="asset-subnav-dot" aria-hidden="true"></span>
              <span class="asset-subnav-label">${escapeHtml(item.label)}</span>
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
  const actionAllowed = !options.actionPermissionCodes?.length || hasAnyPermission(options.actionPermissionCodes);
  const kindPermission = kind ? createPermissionByKind[kind] : "";
  if (action && options.actionAttr && actionAllowed) {
    buttons.push(`<button class="btn primary" ${options.actionAttr}>${escapeHtml(action)}</button>`);
  } else if (action && kind && (!kindPermission || hasPermission(kindPermission))) {
    buttons.push(`<button class="btn primary" data-open-kind="${escapeHtml(kind)}">${escapeHtml(action)}</button>`);
  }
  if (options.showExport !== false) {
    buttons.push(`<button class="btn">导出</button>`);
  }
  const showBatch = options.showBatch ?? (hasManagementExperience() && hasAnyPermission(portalWritePermissions));
  if (showBatch) {
    buttons.push(`<button class="btn">批量操作</button>`);
  }
  return `<section class="hero"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p>${buttons.length ? `<div class="quick-actions">${buttons.join("")}</div>` : ""}</section>`;
}

function toolbar(placeholders) {
  return `<div class="toolbar">
    <input class="local-search" type="search" placeholder="${escapeHtml(placeholders[0])}" value="${escapeHtml(state.query)}">
    <select><option>${escapeHtml(placeholders[1])}</option><option>全部</option><option>在用</option><option>闲置</option><option>维修中</option></select>
    <select><option>${escapeHtml(placeholders[2])}</option><option>全部</option><option>设备</option><option>软件</option></select>
    <button class="btn primary" data-search>查询</button>
    <button class="btn" data-reset>重置</button>
  </div>`;
}


function render() {
  if (!isAuthenticated() && isEcpAuthEnabled() && applyEcpSession()) {
    render();
    return;
  }

  if (isAuthenticated()) {
    ensureAccessibleRoute();
    ensureNavOpenForRoute();
  }

  renderChrome();

  if (!isAuthenticated()) {
    renderNav();
    renderSecondaryNav();
    page.innerHTML = `<section class="login-page"><article class="login-panel"><p class="panel-subtitle">正在同步 ECP 登录态...</p></article></section>`;
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
  const shouldRender = ["assets", "assetInbound", "assetReceiveReturn", "assetBorrowReturn", "requests", "repair", "settings"].includes(state.route);
  if (!shouldRender) return;

  const renderSearchResults = () => {
    render();
    const input = document.querySelector(".local-search");
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
  document.querySelectorAll("[data-terminal-mode]").forEach((el) =>
    el.addEventListener("click", () => setTerminalMode(el.dataset.terminalMode))
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
      state.route = "settings";
      if (state.systemMenu === "员工自助" && !state.selfServiceMenu) state.selfServiceMenu = "员工自助管理";
      persistRoute("settings");
      render();
    })
  );
  document.querySelector("[data-system-integration-create]")?.addEventListener("click", () => openSystemIntegrationModal());
  document.querySelectorAll("[data-system-integration-edit]").forEach((el) =>
    el.addEventListener("click", () => openSystemIntegrationModal(el.dataset.systemIntegrationEdit))
  );
  document.querySelector("[data-system-form-create]")?.addEventListener("click", () => openSystemFormModal());
  document.querySelectorAll("[data-system-form-edit]").forEach((el) =>
    el.addEventListener("click", () => openSystemFormModal(el.dataset.systemFormEdit))
  );
  document.querySelectorAll("[data-system-form-delete]").forEach((el) =>
    el.addEventListener("click", () => void deleteSystemForm(el.dataset.systemFormDelete))
  );
  document.querySelectorAll("[data-self-service-toggle]").forEach((el) =>
    el.addEventListener("click", toggleSelfServiceSignGroup)
  );
  document.querySelectorAll("[data-self-service-menu]").forEach((el) =>
    el.addEventListener("click", () => setSelfServiceMenu(el.dataset.selfServiceMenu || "员工自助管理"))
  );
  bindSelfServiceSettingsEvents();
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
    el.addEventListener("click", () => triggerAssetCategoryWorkbookAction(el.dataset.categoryWorkbookAction))
  );
  document.querySelector("[data-category-import-file]")?.addEventListener("change", (event) => {
    handleAssetCategoryImportFile(event.currentTarget.files?.[0]);
  });
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
    el.addEventListener("click", () => void cancelInboundOrder(el.dataset.cancelInbound))
  );
  document.querySelectorAll("[data-bulk-asset-action]").forEach((el) =>
    el.addEventListener("click", () => void handleBulkAssetAction(el.dataset.bulkAssetAction))
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
    el.addEventListener("click", () => void signHandoverOrder(el.dataset.signHandoverAsset))
  );
  document.querySelectorAll("[data-cancel-handover-asset]").forEach((el) =>
    el.addEventListener("click", () => void cancelHandoverOrder(el.dataset.cancelHandoverAsset))
  );
  document.querySelectorAll("[data-quick-borrow-flow]").forEach((el) =>
    el.addEventListener("click", () => openQuickBorrowFlow(el.dataset.assetId, el.dataset.quickBorrowFlow))
  );
  document.querySelectorAll("[data-delay-borrow-asset]").forEach((el) =>
    el.addEventListener("click", () => void delayBorrowAsset(el.dataset.delayBorrowAsset))
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
  document.querySelectorAll("[data-request-decision]").forEach((el) =>
    el.addEventListener("click", () => void decideBusinessRequest(el.dataset.requestDecision, el.dataset.decision))
  );
  document.querySelectorAll("[data-stocktake]").forEach((el) =>
    el.addEventListener("click", () => openStocktakeDetail(el.dataset.stocktake))
  );
  document.querySelectorAll("[data-stocktake-update]").forEach((el) =>
    el.addEventListener("click", () => void updateStocktakeProgress(el.dataset.stocktakeUpdate))
  );
  document.querySelectorAll("[data-consumable-adjust]").forEach((el) =>
    el.addEventListener("click", () => void adjustConsumable(el.dataset.consumableAdjust, Number(el.dataset.adjustDirection)))
  );
  document.querySelectorAll("[data-repair-update]").forEach((el) =>
    el.addEventListener("click", () => void advanceRepair(el.dataset.repairUpdate))
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
      const scope = el.closest(".toolbar, .asset-list-toolbar, .asset-list-search, .employee-request-list-head") || document;
      const input = scope.querySelector(".local-search") || document.querySelector(".local-search");
      updateSearchQuery(input?.value || "", "local", true);
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
  document.querySelector("[data-open-help]")?.addEventListener("click", openHelpModal);
  document.querySelector("[data-account-toggle]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = event.currentTarget.closest("[data-account-menu]");
    const open = !menu?.classList.contains("open");
    document.querySelectorAll("[data-account-menu]").forEach((item) => {
      item.classList.toggle("open", item === menu && open);
      item.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", item === menu && open ? "true" : "false");
    });
  });
  document.querySelector("[data-logout]")?.addEventListener("click", logout);
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
    state.selectedAssetIds = [asset.id];
    if (action === "领用" && isReceivableAsset(asset)) openAssetReceiveModal([asset]);
    else if (action === "退库" && isReturnableAsset(asset)) openAssetReturnModal([asset]);
    else if (action === "借用" && isBorrowableAsset(asset)) openAssetBorrowModal([asset]);
    else if (action === "归还" && isBorrowReturnableAsset(asset)) openAssetBorrowReturnModal([asset]);
    else if (action === "交接" && isHandoverAsset(asset)) openAssetHandoverModal([asset]);
    else if (action === "报修" || action === "维修") openRepairForAsset(asset);
    else showToast("当前资产状态不支持该操作");
    return;
  }
  const requestTypeByAction = {
    领用: "资产领用",
    借用: "资产借用",
    归还: "资产归还",
    退还: "资产退还",
    退库: "资产退还",
    交接: "资产交接",
  };
  if (action === "报修") {
    openRepairForAsset(asset);
    return;
  }
  openRequestModal(requestTypeByAction[action] || `资产${action}`, asset);
}

async function cancelInboundOrder(assetId) {
  if (!ensureAnyPermission(["asset:inbound:cancel"], "当前账号没有取消入库单的权限")) return;
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  const orderId = buildInboundOrders().find((order) => order.asset.id === assetId)?.id;
  try {
    await executeAssetCommand("cancel-inbound", [assetId], { operator: state.currentUser?.name || "admin", date: todayValue() });
  } catch (error) { showToast(error?.message || "取消入库失败"); return; }
  state.selectedAssetIds = state.selectedAssetIds.filter((id) => id !== assetId);
  if (orderId) state.selectedInboundOrderIds = state.selectedInboundOrderIds.filter((id) => id !== orderId);
  state.assetListPage = 1;
  render();
  showToast(`已取消 ${asset.id} 的入库单`);
}

async function handleBulkAssetAction(action) {
  if (action === "edit") {
    handleEditAction("modify");
    return;
  }

  if (action === "receive") {
    if (!ensureAnyPermission(["asset:receive_return:receive"])) return;
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
    if (!ensureAnyPermission(["asset:receive_return:return"])) return;
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
    if (!ensureAnyPermission(["asset:borrow_return:borrow"])) return;
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
    if (!ensureAnyPermission(["asset:borrow_return:return"])) return;
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
    if (!ensureAnyPermission(["asset:receive_return:handover"])) return;
    const selected = requireSelectedAssets("交接");
    if (!selected.length) return;
    if (selected.some((asset) => !isHandoverAsset(asset))) {
      showToast("只能交接在用或借用中的资产");
      return;
    }
    openAssetHandoverModal(selected);
  }
}

async function handleEditAction(action) {
  const requiredPermission = {
    modify: "asset:item:update",
    delete: "asset:item:delete",
    copy: "asset:item:copy",
    batch: "asset:item:batchUpdate",
  }[action];
  if (requiredPermission && !ensureAnyPermission([requiredPermission])) return;
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
    try { await executeAssetCommand("delete", Array.from(ids), {}); }
    catch (error) { showToast(error?.message || "资产删除失败"); return; }
    state.assets = state.assets.filter((asset) => !ids.has(asset.id));
    state.selectedAssetIds = [];
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
    let created;
    try {
      created = await createAssetCommand({ name: `${source.name || "未命名资产"} 副本` }, source.id);
    }
    catch (error) { showToast(error?.message || "资产复制失败"); return; }
    state.selectedAssetIds = [created.id];
    render();
    showToast(`已复制资产 ${created.id}`);
    return;
  }

  if (action === "batch") {
    const selected = requireSelectedAssets("批量修改");
    if (!selected.length) return;
    openAssetBatchEditModal(selected);
  }
}

function handleImportAction(action) {
  const routePermissions = state.route === "assetInbound"
    ? { asset: "asset:inbound:import", export: "asset:inbound:export" }
    : state.route === "assetReceiveReturn"
      ? { export: "asset:receive_return:export" }
      : state.route === "assetBorrowReturn"
        ? { export: "asset:borrow_return:export" }
        : {
            asset: "asset:item:assetImport",
            update: "asset:item:updateImport",
            receive: "asset:item:receiveImport",
            export: "asset:item:export",
          };
  const requiredPermission = routePermissions[action];
  if (requiredPermission && !ensureAnyPermission([requiredPermission])) return;
  if (action === "export") {
    if (state.route === "assetInbound") {
      exportSelectedInboundOrders();
      return;
    }
    if (state.route === "assetReceiveReturn") {
      exportSelectedReceiveReturnOrders();
      return;
    }
    if (state.route === "assets") {
      exportAssetWorkbook();
      return;
    }
    showToast("当前页面暂不支持导出");
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
      template: "资产更新模板.xls",
      mode: "更新导入",
      note: "按资产编码匹配已有资产，只更新模板内填写的字段。",
    },
    receive: {
      title: "批量领用导入",
      kind: "receive",
      template: "批量领用导入模板.xls",
      mode: "批量领用导入",
      note: "按资产编码和领用人批量生成领用记录。",
    },
  };
  openAssetImportModal(config[action] || config.asset);
}

function openQuickAssetReceive(id) {
  if (!ensureAnyPermission(["asset:receive_return:receive"])) return;
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
  if (!ensureAnyPermission(["asset:receive_return:receive"])) return;
  state.selectedAssetIds = [];
  openAssetReceiveModal([]);
}

function openBlankAssetReturnModal() {
  if (!ensureAnyPermission(["asset:receive_return:return"])) return;
  state.selectedAssetIds = [];
  openAssetReturnModal([]);
}

function openBlankAssetHandoverModal() {
  if (!ensureAnyPermission(["asset:receive_return:handover"])) return;
  state.selectedAssetIds = [];
  openAssetHandoverModal([]);
}

function openBlankAssetBorrowModal() {
  if (!ensureAnyPermission(["asset:borrow_return:borrow"])) return;
  state.selectedAssetIds = [];
  openAssetBorrowModal([]);
}

function openQuickAssetReturn(id) {
  if (!ensureAnyPermission(["asset:receive_return:return"])) return;
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
  if (!ensureAnyPermission(["asset:receive_return:handover"])) return;
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  if (!isHandoverAsset(asset)) {
    showToast("当前资产状态不能交接");
    return;
  }
  state.selectedAssetIds = [asset.id];
  openAssetHandoverModal([asset]);
}

async function signHandoverOrder(id) {
  if (!ensureAnyPermission(["asset:receive_return:sign"])) return;
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  try { await executeAssetCommand("handover-sign", [id], { date: todayValue() }); }
  catch (error) { showToast(error?.message || "交接签字失败"); return; }
  render();
  showToast("交接签字已完成");
}

async function cancelHandoverOrder(id) {
  if (!ensureAnyPermission(["asset:receive_return:cancel"])) return;
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  try { await executeAssetCommand("handover-cancel", [id], { operator: state.currentUser?.name || "admin", date: todayValue() }); }
  catch (error) { showToast(error?.message || "取消交接失败"); return; }
  state.selectedAssetIds = state.selectedAssetIds.filter((assetId) => assetId !== id);
  render();
  showToast("交接单已取消");
}

function openQuickBorrowFlow(id, flow) {
  const permission = flow === "borrow" ? "asset:borrow_return:borrow" : "asset:borrow_return:return";
  if (!ensureAnyPermission([permission])) return;
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

async function delayBorrowAsset(id) {
  if (!ensureAnyPermission(["asset:borrow_return:extend"])) return;
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  if (!isBorrowReturnableAsset(asset)) {
    showToast("只能延期借用中的资产");
    return;
  }
  const baseDate = asset.expectedReturnDate || todayValue();
  const nextDate = new Date(baseDate);
  nextDate.setDate(nextDate.getDate() + 7);
  const expectedReturnDate = nextDate.toISOString().slice(0, 10);
  try { await executeAssetCommand("borrow-delay", [id], { expectedReturnDate, operator: state.currentUser?.name || "admin", date: todayValue() }); }
  catch (error) { showToast(error?.message || "借用延期失败"); return; }
  render();
  showToast(`已延期至 ${expectedReturnDate}`);
}

function drawerActionMarkup(item) {
  if (!state.currentUser) return "";

  if (!hasAnyPermission(["asset:receive_return:handover", "asset:repair:update"])) {
    if (!hasPermission("asset:request:create")) return "";
    const primaryAction = item.owner === state.currentUser.name
      ? item.status === "借用中" ? "归还" : "退还"
      : "领用";
    return `<div class="detail-actions">
      <button class="btn primary" data-asset-action="${escapeHtml(item.id)}" data-action="${escapeHtml(primaryAction)}">${escapeHtml(assetActionLabel(item, primaryAction))}</button>
      <button class="btn" data-asset-action="${escapeHtml(item.id)}" data-action="报修">${escapeHtml(assetActionLabel(item, "报修"))}</button>
    </div>`;
  }

  return `<div class="detail-actions">
    <button class="btn primary" data-asset-action="${escapeHtml(item.id)}" data-action="交接">${escapeHtml(assetActionLabel(item, "交接"))}</button>
    <button class="btn" data-asset-action="${escapeHtml(item.id)}" data-action="维修">${escapeHtml(assetActionLabel(item, "维修"))}</button>
	  </div>`;
}

function assetDetailText(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function assetDetailReadonly(label, value, options = {}) {
  const { unit = "", wide = false, tall = false } = options;
  const content = escapeHtml(assetDetailText(value));
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
  const receiveButton = isReturnableAsset(item) && hasPermission("asset:receive_return:return")
    ? `<button class="table-action primary" type="button" data-quick-return-asset="${escapeHtml(item.id)}">退库</button>`
    : hasPermission("asset:receive_return:receive")
      ? `<button class="table-action primary" type="button" data-quick-receive-asset="${escapeHtml(item.id)}" ${isReceivableAsset(item) ? "" : "disabled"}>领用</button>`
      : "";
  const borrowButton = isBorrowReturnableAsset(item) && hasPermission("asset:borrow_return:return")
    ? `<button class="table-action primary" type="button" data-quick-borrow-flow="borrowReturn" data-asset-id="${escapeHtml(item.id)}">归还</button>`
    : hasPermission("asset:borrow_return:borrow")
      ? `<button class="table-action primary" type="button" data-quick-borrow-flow="borrow" data-asset-id="${escapeHtml(item.id)}" ${isBorrowableAsset(item) ? "" : "disabled"}>借用</button>`
      : "";
  const handoverButton = isHandoverAsset(item) && hasPermission("asset:receive_return:handover")
    ? `<button class="table-action" type="button" data-quick-handover-asset="${escapeHtml(item.id)}">交接</button>`
    : "";
  const actions = `${receiveButton}${borrowButton}${handoverButton}`;
  return actions ? `<div class="asset-detail-footer-actions">${actions}</div>` : "";
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
  const item = state.requests.find((request) => request.id === id) || employeeRequestRows().find((request) => request.id === id);
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
      ${detail("状态", statusTag(item.status), { html: true })}
      ${detail("资产数量", item.assetCount || "-")}
      ${detail("申请原因", item.reason)}
      ${detail("申请日期", item.date)}
      ${item.borrowLocation ? detail("借用后位置", item.borrowLocation) : ""}
      ${item.expectedReturnDate ? detail("预计归还日期", item.expectedReturnDate) : ""}
    </div>
    <h3>审批状态</h3>
    <div class="approval-flow">
      <div class="approval-step"><span class="step-dot done"></span><div><strong>资产系统创建单据</strong><div class="timeline-desc">生成业务单据并记录申请内容。</div></div></div>
      <div class="approval-step"><span class="step-dot current"></span><div><strong>${escapeHtml(item.currentNode || item.status)}</strong><div class="timeline-desc">Java 后端校验权限、资产归属和状态后执行。</div></div></div>
      <div class="approval-step"><span class="step-dot"></span><div><strong>资产动作归档</strong><div class="timeline-desc">审批通过后写入资产台账和操作记录。</div></div></div>
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
      ${detail("状态", statusTag(item.progress), { html: true })}
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

function detail(label, value, options = {}) {
  const content = options.html ? String(value || "-") : escapeHtml(value ?? "-");
  return `<div class="detail-item"><div class="detail-label">${escapeHtml(label)}</div><div class="detail-value">${content}</div></div>`;
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
  if (!ensureAnyPermission(["asset:request:create"])) return;
  if (!hasManagementExperience() && !enabledSelfServiceRequestSettings(type)) {
    showToast("该自助申请当前未启用");
    return;
  }
  state.employeeRequestActiveType = type;
  modalTitle.textContent = type;
  modal.classList.remove(
    "asset-create-modal",
    "asset-flow-modal",
    "asset-import-modal",
    "print-preview-modal",
    "asset-label-print-modal",
    "employee-request-modal",
    "location-modal"
  );
  if (!hasManagementExperience() && ["资产领用", "资产借用", "资产归还", "资产退还", "资产交接"].includes(type)) {
    modal.classList.add("employee-request-modal");
    modalBody.innerHTML = type === "资产借用"
      ? employeeAssetBorrowFormMarkup(asset)
      : type === "资产领用"
        ? employeeAssetReceiveFormMarkup(asset)
        : employeeOwnedAssetRequestFormMarkup(type, asset);
    openModal();
    return;
  }
  modalBody.innerHTML = formMarkup(type, asset, false);
  openModal();
}

function openRepairForAsset(asset) {
  if (!ensureAnyPermission(["asset:repair:create"])) return;
  modalTitle.textContent = "新建报修";
  modal.classList.remove("asset-create-modal", "employee-request-modal", "asset-flow-modal");
  modalBody.innerHTML = `<form id="demoForm" data-mode="business-repair">
    <div class="form-grid">
      <div class="field"><label>关联资产</label><input name="asset" required readonly value="${escapeHtml(asset.id)}"></div>
      <div class="field"><label>上报人</label><input name="reporter" required readonly value="${escapeHtml(state.currentUser?.name || "")}"></div>
      <div class="field full"><label>故障描述</label><textarea name="description" required></textarea></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn" data-cancel-modal>取消</button><button type="submit" class="btn primary">提交报修</button></div>
  </form>`;
  openModal();
}

function openKindModal(kind) {
  const requiredPermission = createPermissionByKind[kind];
  if (requiredPermission && !ensureAnyPermission([requiredPermission])) return;
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
  modalBody.innerHTML = kind === "asset" ? assetCreateFormMarkup() : businessKindFormMarkup(kind, map[kind] || "新建");
  openModal();
}

function businessKindFormMarkup(kind, title) {
  const common = (fields) => `<form id="demoForm" data-mode="business-${escapeHtml(kind)}"><div class="form-grid">${fields}</div><div class="modal-actions"><button type="button" class="btn" data-cancel-modal>取消</button><button type="submit" class="btn primary">确定</button></div></form>`;
  if (kind === "stocktake") return common(`
    <div class="field"><label>任务名称</label><input name="name" required></div><div class="field"><label>盘点范围</label><input name="scope" required></div>
    <div class="field"><label>负责人</label><input name="owner" required value="${escapeHtml(state.currentUser?.name || "")}"></div><div class="field"><label>应盘数量</label><input name="total" type="number" min="1" required></div>
    <div class="field"><label>计划日期</label><input name="date" type="date" required value="${todayValue()}"></div>`);
  if (kind === "consumable") return common(`
    <div class="field"><label>耗材名称</label><input name="name" required></div><div class="field"><label>型号</label><input name="model" required></div>
    <div class="field"><label>入库数量</label><input name="quantity" type="number" min="0" required></div><div class="field"><label>最小库存</label><input name="minimum" type="number" min="0" required></div>
    <div class="field full"><label>仓库</label><input name="warehouse" required></div>`);
  if (kind === "repair") return common(`
    <div class="field"><label>关联资产</label><input name="asset" required></div><div class="field"><label>上报人</label><input name="reporter" required value="${escapeHtml(state.currentUser?.name || "")}"></div>
    <div class="field full"><label>故障描述</label><textarea name="description" required></textarea></div>`);
  if (kind === "contract") return common(`
    <div class="field"><label>供应商</label><input name="supplier" required></div><div class="field"><label>合同名称</label><input name="name" required></div>
    <div class="field"><label>到期日期</label><input name="endDate" type="date" required></div><div class="field"><label>合同金额</label><input name="amount" type="number" min="0" step="0.01" required></div>`);
  return formMarkup(title);
}

async function submitBusinessKindForm(form, kind) {
  const requiredPermission = createPermissionByKind[kind];
  if (requiredPermission && !ensureAnyPermission([requiredPermission])) return;
  const data = Object.fromEntries(new FormData(form).entries());
  if (kind === "stocktake") data.total = Number(data.total);
  if (kind === "consumable") {
    data.quantity = Number(data.quantity);
    data.minimum = Number(data.minimum);
  }
  if (kind === "contract") data.amount = Number(data.amount);
  try {
    await runBusinessCommand(`${kind === "stocktake" ? "stocktakes" : `${kind}s`}`, "POST", data, kind === "stocktake" ? "stocktakes" : `${kind}s`);
    closeModal();
    render();
    showToast("业务数据已保存");
  } catch (error) {
    showToast(error?.message || "业务数据保存失败");
  }
}

async function adjustConsumable(id, direction) {
  if (!ensureAnyPermission(["asset:consumable:adjust"])) return;
  const raw = window.prompt(direction > 0 ? "请输入入库数量" : "请输入领取数量", "1");
  if (raw === null) return;
  const quantity = Number(raw);
  if (!Number.isInteger(quantity) || quantity <= 0) return showToast("请输入正整数数量");
  try {
    await runBusinessCommand(`consumables/${encodeURIComponent(id)}/adjust`, "POST", { quantity: quantity * direction, reason: direction > 0 ? "页面入库" : "页面领用" }, "consumables");
    render();
    showToast("耗材库存已更新");
  } catch (error) { showToast(error?.message || "库存更新失败"); }
}

async function updateStocktakeProgress(id) {
  if (!ensureAnyPermission(["asset:stocktake:update"])) return;
  const item = state.stocktakes.find((row) => row.id === id);
  if (!item) return;
  const checked = window.prompt(`已盘数量（总数 ${item.total}）`, String(item.checked));
  if (checked === null) return;
  const diff = window.prompt("差异数量", String(item.diff));
  if (diff === null) return;
  try {
    await runBusinessCommand(`stocktakes/${encodeURIComponent(id)}`, "PATCH", { checked: Number(checked), diff: Number(diff) }, "stocktakes");
    render();
    showToast("盘点进度已更新");
  } catch (error) { showToast(error?.message || "盘点进度更新失败"); }
}

async function advanceRepair(id) {
  const item = state.repairs.find((row) => row.id === id);
  if (!item || !ensureAnyPermission(["asset:repair:update"])) return;
  const status = item.status === "待处理" ? "维修中" : item.status === "维修中" ? "已完成" : item.status;
  if (status === item.status) return showToast("该维修单已结束");
  try {
    await runBusinessCommand(`repairs/${encodeURIComponent(id)}`, "PATCH", { status, handler: state.currentUser?.name || "普通管理员" }, "repairs");
    render();
    showToast(`维修状态已更新为${status}`);
  } catch (error) { showToast(error?.message || "维修状态更新失败"); }
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
        <strong>ECP 权限</strong>
        <p>页面入口和业务操作由当前 ECP 会话权限决定。</p>
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
        <div class="field"><label><span class="required-star">*</span>领用人</label>${directoryPersonSelect("receiverSubject")}</div>
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
        <div class="field"><label><span class="required-star">*</span>借用人：</label>${directoryPersonSelect("borrowerSubject")}</div>
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
        <div class="field" data-handover-personal><label><span class="required-star">*</span>接收人：</label>${directoryPersonSelect("receiverSubject")}</div>
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
    new Set([state.currentUser?.name, ...uniqueAssetFormValues("custodian")].filter(Boolean))
  );
  const categories = assetCategoryFormOptions([asset.category]);
  const locations = assetLocationOptions;
  return `<form id="demoForm" class="asset-create-form asset-edit-form" data-mode="asset-edit" data-asset-id="${escapeHtml(asset.id)}">
    <section class="asset-form-section">
      <div class="asset-form-section-head">
        <h3>使用信息</h3>
      </div>
      <div class="asset-form-grid">
        ${assetField("人员姓名", `<input value="${escapeHtml(asset.owner === "未分配" ? "" : asset.owner)}" readonly>`)}
        ${assetField("使用公司", inlineSelect("company", "使用公司", defaultCompanyOptions, { required: true, selected: asset.company || "默认公司" }), { required: true })}
        ${assetField("使用部门", inlineSelect("department", "使用部门", defaultDepartmentOptions, { selected: asset.department || "默认部门" }))}
        ${assetField("领用/借用日期", `<input type="date" value="${escapeHtml(asset.receiveDate || asset.borrowDate || "")}" readonly>`)}
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
        ${assetField("资产状况", `<input value="${escapeHtml(asset.condition || asset.status || "")}" readonly>`)}
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
    : `<button type="button" class="asset-template-download" data-download-template="${escapeHtml(config.template)}" data-download-template-kind="${escapeHtml(config.kind || "asset")}">⇩ ${escapeHtml(config.template)}</button>`;
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

function downloadAssetImportTemplate(kind, filename) {
  const configs = {
    update: {
      sheet: "资产更新",
      columns: [
        ["id", "资产编码*", 110], ["name", "资产名称", 130], ["category", "资产分类", 100],
        ["brand", "品牌", 80], ["model", "型号", 100], ["price", "金额", 80],
        ["purchaseMethod", "购置方式", 90], ["rent", "租金", 80], ["custodian", "管理员", 90],
        ["condition", "资产状况", 90], ["orderNo", "订单号", 110], ["unit", "计量单位", 72],
        ["ownerCompany", "所属/承租公司", 120], ["purchaseDate", "购置/起租日期", 110],
        ["receiveDate", "领用日期", 100], ["location", "所在位置", 160], ["company", "使用公司", 110],
        ["department", "使用部门", 110], ["owner", "使用人", 90], ["ownerSubject", "ECP人员Subject", 150],
        ["note", "备注", 180],
      ],
      instruction: { id: "必填项；按资产编码匹配，其余空白字段不修改", ownerSubject: "变更使用人时必填 ECP unionId subject" },
    },
    receive: {
      sheet: "批量领用",
      columns: [
        ["id", "资产编码*", 110], ["owner", "领用人", 100], ["ownerSubject", "ECP人员Subject*", 150],
        ["receiveDate", "领用日期*", 100], ["location", "领用后位置*", 160], ["note", "领用备注", 180],
      ],
      instruction: { id: "必填项", ownerSubject: "必填项；填写 ECP unionId subject", receiveDate: "必填项；YYYY-MM-DD", location: "必填项；填写位置完整路径" },
    },
  };
  const config = configs[kind];
  if (!config) return showToast("该导入类型暂无模板");
  const workbook = spreadsheetWorkbookXml(config.sheet, config.columns, [config.instruction]);
  downloadBlob(filename || `${config.sheet}模板.xls`, workbook, "application/vnd.ms-excel;charset=utf-8");
  showToast(`已下载${config.sheet}模板`);
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
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
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
  location: ["所在位置", "位置", "领用后位置", "接收位置"],
  company: ["使用公司"],
  department: ["部门", "使用部门"],
  employeeCode: ["人员编号", "员工编号"],
  email: ["电子邮箱", "邮箱"],
  owner: ["使用人", "人员姓名", "领用人", "接收人"],
  ownerSubject: ["ECP人员Subject", "人员Subject", "使用人Subject", "领用人Subject", "ownerSubject", "receiverSubject", "unionId"],
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
  if (record.owner || record.ownerSubject || record.receiveDate) return "在用";
  return "空闲";
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
  const id = String(record.id || "").trim();
  if (id && usedIds.has(id)) throw new Error(`第 ${rowNumber} 行资产编码“${id}”重复`);
  if (id) usedIds.add(id);
  const condition = normalizeImportCondition(record.condition);
  const purchaseDate = normalizeImportDate(record.purchaseDate);
  const receiveDate = normalizeImportDate(record.receiveDate);
  const location = normalizeLocationValue(record.location);
  const ownerUser = record.ownerSubject ? directoryUserBySubject(record.ownerSubject) : record.owner ? directoryUserByName(record.owner) : null;
  if (record.owner && !record.ownerSubject && !ownerUser) {
    throw new Error(`第 ${rowNumber} 行使用人“${record.owner}”无法唯一匹配 ECP 账号目录`);
  }
  const ownerSubject = String(record.ownerSubject || ownerUser?.subject || "").trim();
  const owner = ownerUser?.name || record.owner || (ownerSubject ? "待服务端解析" : "未分配");
  const asset = {
    id,
    name: record.name || `${category}资产`,
    category,
    type: category,
    model: record.model,
    sn: record.sn,
    owner,
    ownerSubject,
    custodian: record.custodian || state.currentUser?.name || "admin",
    department: ownerUser?.department || record.department || "默认部门",
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
    company: ownerUser?.company || record.company || record.ownerCompany || "默认公司",
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
  const response = await fetch("/api/assets/import", {
    method: "POST",
    headers: ecpSessionHeaders({ "content-type": "application/json; charset=utf-8" }),
    body: JSON.stringify({ items: assets }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `资产导入失败（HTTP ${response.status}）`);
  const created = (result.items || []).map(normalizeSavedAsset);
  state.assets.unshift(...created);
  state.selectedAssetIds = created.map((asset) => asset.id);
  state.assetListPage = 1;
  render();
  return created.length;
}

function importRecordHasValue(record, field) {
  return String(record?.[field] || "").trim() !== "";
}

function resolveImportedAssetParty(record, rowNumber, options = {}) {
  const owner = String(record.owner || "").trim();
  const suppliedSubject = String(record.ownerSubject || "").trim();
  if (options.allowUnassigned && owner === "未分配") return { name: "未分配", subject: "", user: null };
  const user = suppliedSubject ? directoryUserBySubject(suppliedSubject) : directoryUserByName(owner);
  const subject = suppliedSubject || user?.subject || "";
  if (!subject) throw new Error(`第 ${rowNumber} 行缺少可验证的 ECP 人员 Subject`);
  return {
    name: user?.name || owner || "待服务端解析",
    subject,
    user,
  };
}

function buildAssetUpdateImportOperation(record, rowNumber, assetsById) {
  const id = String(record.id || "").trim();
  if (!id) throw new Error(`第 ${rowNumber} 行缺少资产编码`);
  const asset = assetsById.get(id);
  if (!asset) throw new Error(`第 ${rowNumber} 行资产编码“${id}”不存在或不在当前数据范围`);
  const fields = {};
  const textFields = ["name", "brand", "model", "custodian", "ownerCompany", "purchaseMethod", "orderNo", "unit", "note"];
  textFields.forEach((field) => {
    if (importRecordHasValue(record, field)) fields[field] = String(record[field]).trim();
  });
  if (importRecordHasValue(record, "category")) {
    if (!assetCategoryFormOptions().includes(record.category)) throw new Error(`第 ${rowNumber} 行资产分类“${record.category}”不存在`);
    fields.category = record.category;
    fields.type = record.category;
  }
  if (importRecordHasValue(record, "location")) {
    const location = normalizeLocationValue(record.location);
    const message = locationValidationMessage(location);
    if (message) throw new Error(`第 ${rowNumber} 行${message}`);
    fields.location = location;
  }
  if (importRecordHasValue(record, "price")) fields.price = parseNumberValue(record.price);
  if (importRecordHasValue(record, "rent")) fields.rent = parseNumberValue(record.rent);
  if (importRecordHasValue(record, "condition")) fields.condition = normalizeImportCondition(record.condition);
  if (importRecordHasValue(record, "purchaseDate")) fields.purchaseDate = normalizeImportDate(record.purchaseDate);
  if (importRecordHasValue(record, "receiveDate")) fields.receiveDate = normalizeImportDate(record.receiveDate);
  if (importRecordHasValue(record, "owner") || importRecordHasValue(record, "ownerSubject")) {
    const party = resolveImportedAssetParty(record, rowNumber, { allowUnassigned: true });
    fields.owner = party.name;
    fields.ownerSubject = party.subject;
    if (party.user?.company) fields.company = party.user.company;
    if (party.user?.department) fields.department = party.user.department;
  } else {
    if (importRecordHasValue(record, "company")) fields.company = record.company;
    if (importRecordHasValue(record, "department")) fields.department = record.department;
  }
  if (!Object.keys(fields).length) throw new Error(`第 ${rowNumber} 行没有可更新的字段`);
  fields.date = todayValue();
  return { id, rowNumber, fields };
}

function buildAssetReceiveImportOperation(record, rowNumber, assetsById) {
  const id = String(record.id || "").trim();
  if (!id) throw new Error(`第 ${rowNumber} 行缺少资产编码`);
  const asset = assetsById.get(id);
  if (!asset) throw new Error(`第 ${rowNumber} 行资产编码“${id}”不存在或不在当前数据范围`);
  if (!isReceivableAsset(asset)) throw new Error(`第 ${rowNumber} 行资产“${id}”当前状态不能领用`);
  const party = resolveImportedAssetParty(record, rowNumber);
  const date = normalizeImportDate(record.receiveDate);
  if (!date) throw new Error(`第 ${rowNumber} 行缺少领用日期`);
  const location = normalizeLocationValue(record.location);
  if (!location) throw new Error(`第 ${rowNumber} 行缺少领用后位置`);
  const locationMessage = locationValidationMessage(location);
  if (locationMessage) throw new Error(`第 ${rowNumber} 行${locationMessage}`);
  return {
    id,
    rowNumber,
    fields: {
      receiver: party.name,
      receiverSubject: party.subject,
      company: party.user?.company || record.company || "",
      department: party.user?.department || record.department || "",
      location,
      note: record.note || "",
      date,
    },
  };
}

async function runAssetImportOperations(operations, action) {
  try {
    const operationFields = Object.fromEntries(operations.map((operation) => [operation.id, operation.fields]));
    await executeAssetCommand(action, operations.map((operation) => operation.id), { operations: operationFields });
  } catch (error) {
    await hydrateAssetsFromServer();
    throw new Error(error?.message || "批量写入失败");
  }
  await hydrateAssetsFromServer();
  state.selectedAssetIds = operations.map((operation) => operation.id);
  state.assetListPage = 1;
  render();
  return operations.length;
}

async function importAssetUpdateWorkbook(file) {
  const rows = await readAssetWorkbookRows(file);
  const records = assetImportRecordsFromRows(rows);
  if (!records.length) throw new Error("模板中没有可更新的资产数据");
  if (records.length > 5000) throw new Error("最大数据行数不超过5000行");
  const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
  const seen = new Set();
  const operations = records.map(({ record, rowNumber }) => {
    const operation = buildAssetUpdateImportOperation(record, rowNumber, assetsById);
    if (seen.has(operation.id)) throw new Error(`第 ${rowNumber} 行资产编码“${operation.id}”重复`);
    seen.add(operation.id);
    return operation;
  });
  return runAssetImportOperations(operations, "update-import");
}

async function importAssetReceiveWorkbook(file) {
  const rows = await readAssetWorkbookRows(file);
  const records = assetImportRecordsFromRows(rows);
  if (!records.length) throw new Error("模板中没有可领用的资产数据");
  if (records.length > 5000) throw new Error("最大数据行数不超过5000行");
  const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
  const seen = new Set();
  const operations = records.map(({ record, rowNumber }) => {
    const operation = buildAssetReceiveImportOperation(record, rowNumber, assetsById);
    if (seen.has(operation.id)) throw new Error(`第 ${rowNumber} 行资产编码“${operation.id}”重复`);
    seen.add(operation.id);
    return operation;
  });
  return runAssetImportOperations(operations, "receive-import");
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
  const requiredPermission = {
    asset: "asset:item:assetImport",
    update: "asset:item:updateImport",
    receive: "asset:item:receiveImport",
  }[kind];
  if (!requiredPermission || !ensureAnyPermission([requiredPermission])) return false;
  const importers = {
    asset: importAssetWorkbook,
    update: importAssetUpdateWorkbook,
    receive: importAssetReceiveWorkbook,
  };
  const importer = importers[kind];
  if (!importer) {
    setAssetImportStatus(form, "不支持的导入类型。", "error");
    return false;
  }
  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton?.textContent || "确定";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "导入中...";
  }
  setAssetImportStatus(form, "正在解析表格并通过服务端写入资产台账...", "info");
  try {
    const count = await importer(file);
    closeModal();
    const actionLabel = kind === "update" ? "更新" : kind === "receive" ? "领用" : "导入";
    showToast(`已${actionLabel} ${count} 条资产`);
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
  return `<span class="required-star">*</span>${escapeHtml(label)}`;
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
  const id = formValue(form, "assetCode");
  const name = formValue(form, "assetName");
  const purchaseDate = formValue(form, "purchaseDate");
  const ownerSubject = formValue(form, "ownerSubject");
  const ownerUser = directoryUserBySubject(ownerSubject);
  const owner = ownerUser?.name || "";
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
    ownerSubject: ownerUser?.subject || "",
    custodian: formValue(form, "custodian"),
    department: ownerUser?.department || formValue(form, "department"),
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
    company: ownerUser?.company || formValue(form, "company"),
    ownerCompany: formValue(form, "ownerCompany"),
    condition,
    usageMonths: formValue(form, "usageMonths"),
  };
  asset.completeness = calculateAssetCompleteness(asset);
  return normalizeSavedAsset(asset);
}

async function saveCreatedAsset(form) {
  if (!ensureAnyPermission(["asset:item:create"])) return false;
  if (!validateManagedAssetCategory(formValue(form, "category"))) return false;
  if (!validateManagedAssetLocation(formValue(form, "location"))) return false;
  const asset = createAssetFromForm(form);
  if (asset.id && state.assets.some((item) => item.id === asset.id)) {
    showToast("资产编码已存在，请修改后再提交");
    return false;
  }
  return createAssetCommand(asset);
}

async function saveAssetReceiveForm(form) {
  if (!ensureAnyPermission(["asset:receive_return:receive"])) return false;
  const selected = getFlowSelectedAssets(form);
  if (!selected.length) {
    showToast("请先选择要领用的资产");
    return false;
  }
  const receiverSubject = formValue(form, "receiverSubject");
  const receiverUser = directoryUserBySubject(receiverSubject);
  const receiver = receiverUser?.name || "";
  const receiveDate = formValue(form, "receiveDate");
  const department = receiverUser?.department || formValue(form, "department") || "默认部门";
  const company = receiverUser?.company || formValue(form, "company") || "默认公司";
  const location = normalizeLocationValue(formValue(form, "receiveLocation"));
  const note = formValue(form, "receiveNote");
  if (!receiver || !receiveDate || !location) {
    showToast("请填写领用人、领用日期和领用后位置");
    return false;
  }
  if (!validateManagedAssetLocation(location, "请选择位置管理中的领用后位置")) return false;

  await executeAssetCommand("receive", selected.map((asset) => asset.id), {
    receiver, receiverSubject, department, company, location, note, date: receiveDate,
  });
  state.selectedAssetIds = [];
  return true;
}

async function saveAssetReturnForm(form) {
  if (!ensureAnyPermission(["asset:receive_return:return"])) return false;
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

  await executeAssetCommand("return", selected.map((asset) => asset.id), { department, company, location, operator, note, date: returnDate });
  state.selectedAssetIds = [];
  return true;
}

async function saveAssetBorrowForm(form) {
  if (!ensureAnyPermission(["asset:borrow_return:borrow"])) return false;
  const selected = getSelectedAssets();
  if (!selected.length) {
    showToast("请先选择要借用的资产");
    return false;
  }
  const borrowerSubject = formValue(form, "borrowerSubject");
  const borrowerUser = directoryUserBySubject(borrowerSubject);
  const borrower = borrowerUser?.name || "";
  const borrowDate = formValue(form, "borrowDate");
  const expectedReturnDate = formValue(form, "expectedReturnDate");
  const company = borrowerUser?.company || formValue(form, "company") || "默认公司";
  const department = borrowerUser?.department || formValue(form, "department") || "默认部门";
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

  await executeAssetCommand("borrow", selected.map((asset) => asset.id), {
    borrower, borrowerSubject, department, company, location, note, date: borrowDate, expectedReturnDate,
    expectedReturnDates: Object.fromEntries(expectedDateByAsset),
  });
  state.selectedAssetIds = [];
  return true;
}

async function saveAssetBorrowReturnForm(form) {
  if (!ensureAnyPermission(["asset:borrow_return:return"])) return false;
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

  await executeAssetCommand("borrow-return", selected.map((asset) => asset.id), { location, operator, note, date: returnDate });
  state.selectedAssetIds = [];
  return true;
}

async function saveAssetHandoverForm(form) {
  if (!ensureAnyPermission(["asset:receive_return:handover"])) return false;
  const selected = getFlowSelectedAssets(form);
  if (!selected.length) {
    showToast("请先选择要交接的资产");
    return false;
  }
  const handoverDate = formValue(form, "handoverDate");
  const handoverType = formValue(form, "handoverType") || "personal";
  const receiverSubject = handoverType === "public" ? "" : formValue(form, "receiverSubject");
  const receiverUser = handoverType === "public" ? null : directoryUserBySubject(receiverSubject);
  const receiver = handoverType === "public" ? "公共区域" : receiverUser?.name || "";
  const company = receiverUser?.company || formValue(form, "receiverCompany") || "默认公司";
  const department = receiverUser?.department || formValue(form, "receiverDepartment") || "默认部门";
  const location = normalizeLocationValue(formValue(form, "receiverLocation"));
  const note = formValue(form, "handoverNote");
  if (!handoverDate || !location || (handoverType !== "public" && !receiver)) {
    showToast(handoverType === "public" ? "请填写接收位置和交接日期" : "请填写接收人、接收位置和交接日期");
    return false;
  }
  if (!validateManagedAssetLocation(location, "请选择位置管理中的接收位置")) return false;

  await executeAssetCommand("handover", selected.map((asset) => asset.id), {
    receiver, receiverSubject, company, department, location, note, date: handoverDate,
    handoverType: handoverType === "public" ? "公共交接" : "员工交接",
  });
  state.selectedAssetIds = [];
  return true;
}

async function saveAssetEditForm(form) {
  if (!ensureAnyPermission(["asset:item:update"])) return false;
  const asset = state.assets.find((item) => item.id === form.dataset.assetId);
  if (!asset) return false;
  const category = formValue(form, "category");
  const location = normalizeLocationValue(formValue(form, "location"));
  if (category !== asset.category && !validateManagedAssetCategory(category)) return false;
  if (!validateManagedAssetLocation(location)) return false;
  const fields = {
    company: formValue(form, "company"),
    department: formValue(form, "department"),
    name: formValue(form, "assetName"),
    category,
    type: category,
    custodian: formValue(form, "custodian"),
    brand: formValue(form, "brand"),
    model: formValue(form, "model"),
    ownerCompany: formValue(form, "ownerCompany"),
    location,
    price: Number(formValue(form, "price")) || 0,
    purchaseDate: formValue(form, "purchaseDate"),
    purchaseMethod: formValue(form, "purchaseMethod"),
    orderNo: formValue(form, "orderNo"),
    unit: formValue(form, "unit"),
    rent: Number(formValue(form, "rent")) || 0,
    note: formValue(form, "note"),
  };
  await executeAssetCommand("edit", [asset.id], fields);
  return true;
}

async function saveAssetBatchEditForm(form) {
  if (!ensureAnyPermission(["asset:item:batchUpdate"])) return false;
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
  patch.date = todayValue();
  await executeAssetCommand("batch-edit", selected.map((asset) => asset.id), patch);
  state.selectedAssetIds = [];
  return true;
}

function assetField(label, control, options = {}) {
  const { required = false, wide = false, full = false } = options;
  return `<div class="field ${wide ? "wide" : ""} ${full ? "full" : ""}">
    <label>${required ? requiredLabel(label) : escapeHtml(label)}</label>
    ${control}
  </div>`;
}

function assetCreateFormMarkup() {
  const user = state.currentUser;
  const admins = Array.from(
    new Set([user?.name, ...uniqueAssetFormValues("custodian")].filter(Boolean))
  );
  const categories = assetCategoryFormOptions();
  const locations = assetLocationOptions;

  return `<form id="demoForm" class="asset-create-form" data-mode="asset-create">
    <section class="asset-form-section">
      <div class="asset-form-section-head">
        <h3>使用信息</h3>
      </div>
      <div class="asset-form-grid">
        ${assetField("人员姓名", directoryPersonSelect("ownerSubject", "", false))}
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
        ${assetField("管理员", inlineSelect("custodian", "管理员", admins, { required: true, selected: user?.name || "" }), {
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
  const approvalSystem = direct ? "管理端直办" : asset?.approval || "ECP审批";
  const hintText = direct
    ? "该动作将直接写入资产履历，并保留服务端操作记录。"
    : !hasManagementExperience()
      ? "普通员工默认通过申请流程发起业务单据，审批通过后再执行资产动作。"
      : "提交后创建资产申请，由 Java 后端在审批通过时校验并执行资产动作。";

  return `<form id="demoForm" data-mode="${direct ? "direct" : "approval"}">
    <div class="approval-hint ${direct ? "direct" : ""}">
      <strong>${direct ? "管理端直办" : "资产申请"}</strong>
      <span>${escapeHtml(hintText)}</span>
    </div>
    <div class="form-grid">
      <div class="field"><label>业务类型</label><input name="businessType" value="${escapeHtml(type)}" readonly /></div>
      <div class="field"><label>${direct ? "执行方式" : "审批系统"}</label><input value="${escapeHtml(approvalSystem)}" readonly /></div>
      <div class="field"><label>${direct ? "操作人" : "申请人"}</label><input value="${escapeHtml(user?.name || "")}" readonly /></div>
      <div class="field"><label>登录身份</label><input value="${escapeHtml(`${user?.account || "-"} / ${user?.roleName || "-"}`)}" /></div>
      <div class="field"><label>关联资产/物品</label><input name="asset" required value="${escapeHtml(asset ? `${asset.id} · ${asset.name}` : "")}" placeholder="请选择资产、耗材或标准品" /></div>
      <div class="field"><label>期望日期</label><input type="date" value="${todayValue()}" /></div>
      <div class="field"><label>紧急程度</label><select><option>普通</option><option>紧急</option><option>低优先级</option></select></div>
      <div class="field"><label>外部身份</label><input value="${escapeHtml(state.session.provider || "ECP统一认证")}" /></div>
      <div class="field full"><label>${direct ? "操作说明" : "申请说明"}</label><textarea name="reason" required placeholder="${direct ? "填写直办原因，例如普通管理员盘点纠偏、紧急调拨、台账修正。" : "填写申请原因。"}"></textarea></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel-modal>取消</button>
      <button type="submit" class="btn primary">${direct ? "提交直办申请" : "提交申请"}</button>
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
  bindEmployeeAssetReceiveForm(modal);
  document.querySelector("[data-cancel-modal]")?.addEventListener("click", closeModal);
  document.querySelector("#demoForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const mode = form.dataset.mode;
    try {
    if (mode === "system-integration") {
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        if (!await saveSystemIntegrationForm(form)) return;
        closeModal();
        render();
        showToast(form.dataset.systemIntegrationId ? "系统连接已保存" : "系统连接已新增");
      } finally {
        if (submit) submit.disabled = false;
      }
      return;
    }
    if (mode === "system-form") {
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        if (!await saveSystemFormDefinition(form)) return;
        closeModal();
        render();
        showToast(form.dataset.systemFormId ? "表单已保存" : "表单已新增");
      } finally {
        if (submit) submit.disabled = false;
      }
      return;
    }
    if (mode === "asset-create") {
      if (!validateInlineSelects(form)) return;
      const asset = await saveCreatedAsset(form);
      if (!asset) return;
      closeModal();
      render();
      showToast(`已新增资产 ${asset.id}`);
      return;
    }
    if (mode === "employee-asset-receive") {
      if (!validateInlineSelects(form) || !await saveEmployeeAssetReceiveRequest(form)) return;
      closeModal();
      state.route = "requests";
      persistRoute(state.route);
      render();
      showToast("资产领用申请已提交，可在我的申请查看审批进度");
      return;
    }
    if (mode === "employee-asset-borrow") {
      if (!validateInlineSelects(form) || !await saveEmployeeAssetBorrowRequest(form)) return;
      closeModal();
      state.route = "requests";
      persistRoute(state.route);
      render();
      showToast("资产借用申请已提交，可在我的申请查看审批进度");
      return;
    }
    if (mode === "employee-owned-asset-request") {
      if (!validateInlineSelects(form) || !await saveEmployeeOwnedAssetRequest(form)) return;
      closeModal();
      state.route = "requests";
      persistRoute(state.route);
      render();
      showToast("资产申请已提交，可在我的申请查看审批进度");
      return;
    }
    if (mode === "asset-receive") {
      if (!validateInlineSelects(form) || !await saveAssetReceiveForm(form)) return;
      closeModal();
      render();
      showToast("领用单已保存，资产状态已更新");
      return;
    }
    if (mode === "asset-return") {
      if (!validateInlineSelects(form) || !await saveAssetReturnForm(form)) return;
      closeModal();
      render();
      showToast("退库单已保存，资产状态已更新");
      return;
    }
    if (mode === "asset-borrow") {
      if (!validateInlineSelects(form) || !await saveAssetBorrowForm(form)) return;
      closeModal();
      render();
      showToast("借用单已保存，资产状态已更新");
      return;
    }
    if (mode === "asset-borrow-return") {
      if (!validateInlineSelects(form) || !await saveAssetBorrowReturnForm(form)) return;
      closeModal();
      render();
      showToast("归还单已保存，资产状态已更新");
      return;
    }
    if (mode === "asset-handover") {
      if (!validateInlineSelects(form) || !await saveAssetHandoverForm(form)) return;
      closeModal();
      render();
      showToast("交接单已保存，资产状态已更新");
      return;
    }
    if (mode === "asset-edit") {
      if (!validateInlineSelects(form)) return;
      if (!await saveAssetEditForm(form)) return;
      closeModal();
      render();
      showToast("资产信息已保存");
      return;
    }
    if (mode === "asset-batch-edit") {
      if (!await saveAssetBatchEditForm(form)) return;
      closeModal();
      render();
      showToast("批量修改已保存");
      return;
    }
    if (mode === "asset-import") {
      submitAssetImportForm(form);
      return;
    }
    if (mode?.startsWith("business-")) {
      void submitBusinessKindForm(form, mode.slice("business-".length));
      return;
    }
    if (mode === "location-create" || mode === "location-edit") {
      if (!await commitLocationForm(form)) return;
      closeModal();
      render();
      showToast(mode === "location-edit" ? "位置已保存" : "位置已新增");
      return;
    }
    if (mode === "category-create" || mode === "category-edit") {
      if (!await commitAssetCategoryForm(form)) return;
      closeModal();
      render();
      showToast(mode === "category-edit" ? "分类已保存" : "分类已新增");
      return;
    }
    if (mode === "approval") {
      const request = await submitAdHocBusinessRequest(form);
      if (!request) return;
      closeModal();
      state.route = "requests";
      persistRoute(state.route);
      render();
      showToast("审批单据已创建");
      return;
    }
    } catch (error) {
      console.error("[asset-portal] command failed", error);
      showToast(error?.message || "操作失败");
    }
  });
  document.querySelector("[data-download-template]")?.addEventListener("click", (event) => {
    downloadAssetImportTemplate(
      event.currentTarget.dataset.downloadTemplateKind,
      event.currentTarget.dataset.downloadTemplate
    );
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
  const receiverInput = form.querySelector('select[name="receiverSubject"]');
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
    receiverInput.value = "";
    if (receiverLabel) receiverLabel.innerHTML = "接收对象：";
  } else {
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
  modal.classList.remove("employee-request-modal");
  modal.classList.remove("location-modal");
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
window.addEventListener("asset-portal-route", (event) => {
  if (!isAuthenticated()) return;
  applyPortalMenuRoute(event.detail, true);
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

async function bootApp() {
  const loadedSharedStore = await loadSharedStore();
  if (loadedSharedStore) applySharedStoreState();
  await hydrateEcpDirectoryUsers();
  await hydrateAssetsFromServer();
  await hydrateBusinessData();
  await hydrateSystemConfigs();
  if (isEcpAuthEnabled() && applyEcpSession()) {
    render();
    return;
  }
  render();
}

bootApp();
