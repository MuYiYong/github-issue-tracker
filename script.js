/* =========================================================
   GitHub Issue Tracker
   功能：
   - 自动拉取用户有权限的 GitHub Project
   - 直接从 GitHub Project 拉取 Issue（不本地保存）
   - 过滤已关闭的 Issue
   - 统计：状态、优先级、里程碑、分配人、Estimation
   - 多条件同时过滤（AND 逻辑）
   - 只有点击刷新按钮才更新数据
========================================================= */

const STORAGE_KEYS = {
    TOKEN: "github_token",
    PROJECTS: "my_projects",
    SELECTED_PROJECT: "selected_project",
    CACHED_ISSUES: "cached_issues",
    LAST_FETCH_TIME: "last_fetch_time"
};

const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const ASSIGNEE_PAGE_SIZE = 10;
const PAGE_SIZE = 100;
const MAX_CONCURRENT = 6; // 最大并发数

// 全局状态
let cachedIssues = [];
let filters = {
    state: null,
    priority: null,
    milestone: null,
    assignee: null,
    team: null,
    hasEstimation: null
};
let assigneePage = 0;

// 当前请求的 AbortController
let currentAbortController = null;

// 缓存 Chart 实例
const chartInstances = new Map();

// DOM 元素缓存（仅缓存静态元素）
const staticDomCache = new Map();

/* ---------------- 工具函数 ---------------- */

/**
 * 获取 DOM 元素（带缓存，仅用于静态元素）
 */
const STATIC_ELEMENTS = new Set([
    "loading-container", "loading-text", "loading-percent", 
    "loading-bar-fill", "loading-detail", "fetch-btn",
    "token-status", "token-input", "project-select", "last-fetch-time"
]);

function getElement(id, useCache = true) {
    const canCache = useCache && STATIC_ELEMENTS.has(id);
    
    if (canCache && staticDomCache.has(id)) {
        return staticDomCache.get(id);
    }
    
    const el = document.getElementById(id);
    
    if (canCache && el) {
        staticDomCache.set(id, el);
    }
    
    return el;
}

/**
 * 安全地设置元素文本
 */
function setText(el, text) {
    if (el) el.textContent = text;
}

/**
 * 安全地设置元素 HTML
 */
function setHTML(el, html) {
    if (el) el.innerHTML = html;
}

/**
 * 防抖函数
 */
function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * 按值排序对象
 */
function sortObjectByValue(obj, desc = true) {
    return Object.entries(obj)
        .sort((a, b) => desc ? b[1] - a[1] : a[1] - b[1])
        .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});
}

/**
 * 获取优先级样式类
 */
function getPriorityClass(priority) {
    if (!priority) return "none";
    const lower = priority.toLowerCase();
    if (/p0|high|critical/.test(lower)) return "high";
    if (/p1|medium/.test(lower)) return "medium";
    if (/p2|low/.test(lower)) return "low";
    return "none";
}

/**
 * 格式化日期
 */
function formatDate(dateStr) {
    if (!dateStr) return "未知";
    try {
        return new Date(dateStr).toLocaleString();
    } catch {
        return "未知";
    }
}

/**
 * 生成安全的 ID
 */
function safeId(str) {
    return String(str || "").replace(/[^a-zA-Z0-9]/g, "_");
}

/* ---------------- 页面初始化 ---------------- */
document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initEventDelegation();
    updateTokenStatus();
    loadProjectSelect();
    updateLastFetchTime();
    loadCachedData();
});

/* ---------------- Tab 切换 ---------------- */
function initTabs() {
    const navTabs = document.querySelectorAll(".nav-tab");
    const tabContents = document.querySelectorAll(".tab-content");
    
    navTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const targetTab = tab.dataset.tab;
            
            requestAnimationFrame(() => {
                // 更新 Tab 状态
                navTabs.forEach(t => t.classList.toggle("active", t === tab));
                
                // 更新内容区域
                tabContents.forEach(content => {
                    content.classList.toggle("active", content.id === `tab-${targetTab}`);
                });
            });
        });
    });
}

/* ---------------- 事件委托 ---------------- */
function initEventDelegation() {
    document.addEventListener("click", handleGlobalClick);
}

function handleGlobalClick(e) {
    const target = e.target;
    
    // 处理展开/折叠子 Issue
    const toggleArrow = target.closest(".toggle-arrow");
    if (toggleArrow) {
        e.preventDefault();
        const toggleId = toggleArrow.dataset.toggle;
        if (toggleId) toggleChildren(toggleId);
        return;
    }
    
    // 处理标签点击过滤
    const labelTag = target.closest(".label-tag");
    if (labelTag && labelTag.dataset.filterType) {
        e.preventDefault();
        handleLabelFilter(labelTag);
        return;
    }
    
    // 处理分页按钮
    const paginationBtn = target.closest(".pagination-btn");
    if (paginationBtn && !paginationBtn.disabled) {
        e.preventDefault();
        const delta = paginationBtn.dataset.delta;
        const type = paginationBtn.dataset.type;
        if (delta && type) handlePageChange(parseInt(delta), type);
        return;
    }
}

/**
 * 处理标签过滤点击
 */
function handleLabelFilter(labelTag) {
    const filterType = labelTag.dataset.filterType;
    const filterValue = labelTag.dataset.filterValue;
    const isWorkload = labelTag.dataset.isWorkload === "true";
    
    // 重置分配人分页
    assigneePage = 0;
    
    if (isWorkload) {
        handleWorkloadFilter(filterValue);
    } else {
        handleNormalFilter(filterType, filterValue);
    }
    
    // 添加这行：刷新统计界面
    refreshStats();
}

function handleWorkloadFilter(filterValue) {
    if (filterValue === "all") {
        filters.team = null;
        filters.hasEstimation = null;
    } else if (filterValue === "no-estimation") {
        filters.hasEstimation = filters.hasEstimation === false ? null : false;
        if (filters.hasEstimation === false) filters.team = null;
    } else {
        if (filters.team === filterValue && filters.hasEstimation === true) {
            filters.team = null;
            filters.hasEstimation = null;
        } else {
            filters.team = filterValue;
            filters.hasEstimation = true;
        }
    }
}

function handleNormalFilter(filterType, filterValue) {
    if (filterValue === "all") {
        filters[filterType] = null;
    } else if (filters[filterType] === filterValue) {
        filters[filterType] = null;
    } else {
        filters[filterType] = filterValue;
    }
}

/**
 * 处理分页变化
 */
function handlePageChange(delta, type) {
    assigneePage = Math.max(0, assigneePage + delta);
    
    // 只更新分配人标签区域
    const container = document.getElementById(`labels-${type}`);
    if (container) {
        // 使用当前过滤后的数据重新计算
        const filteredIssues = applyFilters(cachedIssues);
        const stats = getStatsData(filteredIssues);
        
        const category = {
            type,
            data: stats.assigneeStats,
            colors: getAssigneeColors(),
            paginated: true
        };
        renderPaginatedLabels(category, container);
    }
}

/* ---------------- Loading Progress ---------------- */
function showLoading(text = "正在加载...", detail = "") {
    requestAnimationFrame(() => {
        const container = getElement("loading-container");
        const textEl = getElement("loading-text");
        const percentEl = getElement("loading-percent");
        const fillEl = getElement("loading-bar-fill");
        const detailEl = getElement("loading-detail");
        const btn = getElement("fetch-btn");
        
        if (container) container.classList.remove("hidden");
        setText(textEl, text);
        setText(percentEl, "0%");
        if (fillEl) fillEl.style.width = "0%";
        setText(detailEl, detail);
        if (btn) btn.classList.add("loading");
    });
}

function updateLoading(percent, text = null, detail = null) {
    requestAnimationFrame(() => {
        const percentEl = getElement("loading-percent");
        const fillEl = getElement("loading-bar-fill");
        
        setText(percentEl, `${Math.round(percent)}%`);
        if (fillEl) fillEl.style.width = `${percent}%`;
        
        if (text !== null) setText(getElement("loading-text"), text);
        if (detail !== null) setText(getElement("loading-detail"), detail);
    });
}

function hideLoading() {
    requestAnimationFrame(() => {
        const container = getElement("loading-container");
        const btn = getElement("fetch-btn");
        
        if (container) container.classList.add("hidden");
        if (btn) btn.classList.remove("loading");
    });
}

// 精简 Token 管理

/* ---------------- Token 管理 ---------------- */
const loadToken = () => localStorage.getItem(STORAGE_KEYS.TOKEN) || "";

function saveToken() {
    const token = getElement("token-input")?.value?.trim();
    if (!token) return alert("请输入有效的 Token");
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    getElement("token-input").value = "";
    updateTokenStatus();
    fetchProjects();
}

function clearToken() {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    updateTokenStatus();
}

function updateTokenStatus() {
    const el = getElement("token-status");
    if (!el) return;
    const token = loadToken();
    el.className = `token-status ${token ? "success" : "error"}`;
    el.textContent = token ? `✓ Token 已配置（${token.slice(0, 8)}...）` : "✗ 未配置 Token";
}

/* ---------------- 缓存管理 ---------------- */
function loadCachedData() {
    try {
        const cached = localStorage.getItem(STORAGE_KEYS.CACHED_ISSUES);
        if (cached) {
            cachedIssues = JSON.parse(cached);
            if (cachedIssues.length > 0) {
                // 延迟渲染，优先显示页面框架
                if ("requestIdleCallback" in window) {
                    requestIdleCallback(() => refreshStats(), { timeout: 500 });
                } else {
                    setTimeout(refreshStats, 100);
                }
            }
        }
    } catch (e) {
        console.error("加载缓存失败:", e);
        cachedIssues = [];
    }
}

const saveCachedIssues = debounce(() => {
    try {
        localStorage.setItem(STORAGE_KEYS.CACHED_ISSUES, JSON.stringify(cachedIssues));
    } catch (e) {
        console.error("保存缓存失败:", e);
        // 如果存储失败（可能是存储已满），尝试清理旧数据
        try {
            localStorage.removeItem(STORAGE_KEYS.CACHED_ISSUES);
        } catch {}
    }
}, 300);

function updateLastFetchTime() {
    const timeEl = getElement("last-fetch-time");
    const lastFetch = localStorage.getItem(STORAGE_KEYS.LAST_FETCH_TIME);
    
    if (timeEl && lastFetch) {
        const date = new Date(parseInt(lastFetch));
        timeEl.textContent = `上次更新: ${date.toLocaleString()}`;
    }
}

/* ---------------- 项目管理 ---------------- */
function loadProjectSelect() {
    const select = getElement("project-select");
    if (!select) return;
    
    const saved = localStorage.getItem(STORAGE_KEYS.PROJECTS);
    const selectedProject = localStorage.getItem(STORAGE_KEYS.SELECTED_PROJECT);
    
    // 使用 DocumentFragment 批量操作
    const fragment = document.createDocumentFragment();
    
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "-- 请选择 --";
    fragment.appendChild(defaultOpt);
    
    if (saved) {
        try {
            const projects = JSON.parse(saved);
            projects.forEach(p => {
                const opt = document.createElement("option");
                const value = JSON.stringify(p);
                opt.value = value;
                opt.textContent = `${p.owner} / ${p.title}`;
                opt.selected = selectedProject === value;
                fragment.appendChild(opt);
            });
        } catch (e) {
            console.error("加载项目列表失败:", e);
        }
    }
    
    select.innerHTML = "";
    select.appendChild(fragment);
}

function saveSelectedProject() {
    const select = getElement("project-select");
    if (select?.value) {
        localStorage.setItem(STORAGE_KEYS.SELECTED_PROJECT, select.value);
    }
}

/* ---------------- 获取项目列表 ---------------- */
async function fetchProjects() {
    const token = loadToken();
    if (!token) {
        alert("请先配置 Token");
        return;
    }
    
    showLoading("正在获取项目列表...");
    
    const query = `
    query {
        viewer {
            login
            projectsV2(first: 50) {
                nodes { title number owner { ... on Organization { login } ... on User { login } } }
            }
            organizations(first: 20) {
                nodes {
                    login
                    projectsV2(first: 50) {
                        nodes { title number owner { ... on Organization { login } ... on User { login } } }
                    }
                }
            }
        }
    }`;
    
    try {
        const res = await fetch(GITHUB_GRAPHQL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ query })
        });
        
        const json = await res.json();
        
        if (json.errors) {
            hideLoading();
            alert("获取项目失败：" + json.errors[0].message);
            return;
        }
        
        const projects = [];
        const viewer = json.data?.viewer;
        
        if (!viewer) {
            hideLoading();
            alert("无法获取用户信息，请检查 Token");
            return;
        }
        
        // 用户项目
        viewer.projectsV2?.nodes?.forEach(p => {
            if (p?.title && p?.number && p?.owner?.login) {
                projects.push({
                    title: p.title,
                    number: p.number,
                    owner: p.owner.login,
                    ownerType: "User"
                });
            }
        });
        
        // 组织项目
        viewer.organizations?.nodes?.forEach(org => {
            org?.projectsV2?.nodes?.forEach(p => {
                if (p?.title && p?.number && p?.owner?.login) {
                    projects.push({
                        title: p.title,
                        number: p.number,
                        owner: p.owner.login,
                        ownerType: "Organization"
                    });
                }
            });
        });
        
        localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
        loadProjectSelect();
        hideLoading();
        
        if (projects.length === 0) {
            alert("未找到任何项目，请确认您有权限访问 GitHub Projects");
        }
        
    } catch (err) {
        hideLoading();
        console.error("获取项目失败:", err);
        alert("网络错误：" + err.message);
    }
}

/* ---------------- 拉取并刷新 ---------------- */
async function fetchAndRefresh() {
    const issues = await fetchProjectIssues();
    if (issues) {
        cachedIssues = issues;
        saveCachedIssues();
        localStorage.setItem(STORAGE_KEYS.LAST_FETCH_TIME, Date.now().toString());
        updateLastFetchTime();
        
        // 重置过滤器和分页
        resetFilters();
        refreshStats();
    }
}

function resetFilters() {
    filters = {
        state: null,
        priority: null,
        milestone: null,
        assignee: null,
        team: null,
        hasEstimation: null
    };
    assigneePage = 0;
}

/* ---------------- 从 Project 拉取 Issue（优化版） ---------------- */
async function fetchProjectIssues() {
    const select = getElement("project-select");
    if (!select?.value) return alert("请先选择一个项目"), null;
    
    const token = loadToken();
    if (!token) return alert("请先配置 GitHub Token"), null;
    
    let project;
    try {
        project = JSON.parse(select.value);
    } catch {
        return alert("项目数据格式错误"), null;
    }
    
    saveSelectedProject();
    showLoading("正在获取 Issue 列表...", `项目: ${project.title}`);
    
    const ownerQuery = project.ownerType === "Organization" ? "organization" : "user";
    const query = buildQuery(ownerQuery);
    
    try {
        // 取消之前的请求
        if (currentAbortController) {
            currentAbortController.abort();
        }
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;
        
        // 获取第一页和总数
        const first = await fetchPage(token, query, project.owner, project.number, null, signal);
        if (!first.ok) return hideLoading(), alert(first.error), null;
        
        let allItems = first.items;
        const { totalCount, projectTitle } = first;
        
        updateLoading(15, null, `已获取 ${allItems.length} / ${totalCount} 条`);
        
        // 并发获取剩余页面
        if (first.hasNext) {
            const remaining = await fetchAllPages(token, query, project.owner, project.number, first.cursor, totalCount, allItems.length);
            allItems = allItems.concat(remaining);
        }
        
        updateLoading(90, "正在处理数据...", `共 ${allItems.length} 条`);
        
        const issues = processItems(allItems, projectTitle);
        
        updateLoading(100, "加载完成！", `共 ${issues.length} 个有效 Issue`);
        setTimeout(hideLoading, 200);
        
        return issues;
    } catch (err) {
        console.error("获取 Issue 失败:", err);
        hideLoading();
        return alert("请求错误：" + err.message), null;
    }
}

/**
 * 构建 GraphQL 查询
 */
function buildQuery(ownerQuery) {
    return `query($owner:String!,$number:Int!,$cursor:String){${ownerQuery}(login:$owner){projectV2(number:$number){title items(first:${PAGE_SIZE},after:$cursor){totalCount pageInfo{hasNextPage endCursor}nodes{content{...on Issue{id number title state url updatedAt milestone{title}labels(first:10){nodes{name}}assignees(first:5){nodes{login}}repository{name owner{login}}parent{id}}}fieldValues(first:15){nodes{...on ProjectV2ItemFieldSingleSelectValue{field{...on ProjectV2SingleSelectField{name}}name}...on ProjectV2ItemFieldNumberValue{field{...on ProjectV2FieldCommon{name}}number}}}}}}}}`;
}

/**
 * 获取单页数据
 */
async function fetchPage(token, query, owner, number, cursor, signal = null) {
    const options = {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "GraphQL-Features": "sub_issues"
        },
        body: JSON.stringify({ query, variables: { owner, number, cursor } })
    };
    
    if (signal) options.signal = signal;
    
    const res = await fetch(GITHUB_GRAPHQL, options);
    
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    
    const json = await res.json();
    if (json.errors) return { ok: false, error: json.errors[0].message };
    
    const proj = json.data?.[Object.keys(json.data)[0]]?.projectV2;
    if (!proj) return { ok: false, error: "无法找到该 Project" };
    
    const items = proj.items;
    return {
        ok: true,
        items: items.nodes || [],
        totalCount: items.totalCount || 0,
        hasNext: items.pageInfo?.hasNextPage,
        cursor: items.pageInfo?.endCursor,
        projectTitle: proj.title
    };
}

/**
 * 并发获取所有剩余页面
 */
async function fetchAllPages(token, query, owner, number, startCursor, totalCount, fetched) {
    const results = [];
    let cursor = startCursor;
    
    while (cursor) {
        const res = await fetchPage(token, query, owner, number, cursor);
        
        if (!res.ok) {
            console.error("获取页面失败:", res.error);
            break;
        }
        
        results.push(...res.items);
        cursor = res.hasNext ? res.cursor : null;
        
        const progress = Math.min(15 + ((fetched + results.length) / totalCount) * 70, 85);
        updateLoading(progress, null, `已获取 ${fetched + results.length} / ${totalCount} 条`);
    }
    
    return results;
}

/**
 * 处理 Issue 数据
 */
function processItems(items, projectTitle) {
    const issues = [];
    const issueMap = new Map();
    
    for (let i = 0, len = items.length; i < len; i++) {
        const content = items[i]?.content;
        if (!content?.url || content.state === "CLOSED") continue;
        
        const fields = items[i].fieldValues?.nodes;
        let status, priority, estimation, team, funcType;
        
        if (fields) {
            for (const f of fields) {
                const name = f?.field?.name?.toLowerCase();
                if (!name) continue;
                const val = f.name ?? f.number;
                if (name === FIELD_NAMES.STATUS) status = val;
                else if (name === FIELD_NAMES.PRIORITY) priority = val;
                else if (name === "estimation") estimation = val;
                else if (name === "team") team = val;
                else if (name === "functiontype") funcType = val;
            }
        }
        
        const issue = {
            id: content.id,
            owner: content.repository?.owner?.login || "",
            repo: content.repository?.name || "",
            number: content.number,
            url: content.url,
            title: content.title || "",
            state: status || "未知",
            issueState: content.state,
            milestone: content.milestone?.title || null,
            updated_at: content.updatedAt,
            labels: content.labels?.nodes?.map(n => n.name) || [],
            priority: priority || "未设置",
            project_name: projectTitle,
            FunctionType: funcType || "",
            assignees: content.assignees?.nodes?.map(a => a.login) || [],
            estimation: typeof estimation === "number" ? estimation : null,
            team: team || "未设置",
            parentId: content.parent?.id || null,
            childIds: []
        };
        
        issues.push(issue);
        issueMap.set(issue.id, issue);
    }
    
    // 建立父子关系
    for (const issue of issues) {
        if (issue.parentId) {
            issueMap.get(issue.parentId)?.childIds.push(issue.id);
        }
    }
    
    return issues;
}

/* ---------------- 统计相关函数 ---------------- */

/**
 * 获取用于统计的 Issue（排除在列表中有父 Issue 的子 Issue）
 */
function getIssuesForStats(issues) {
    const issueIdSet = new Set(issues.map(i => i.id));
    return issues.filter(issue => !issue.parentId || !issueIdSet.has(issue.parentId));
}

/**
 * 生成统计数据（带缓存）
 */
function getStatsData(issues) {
    const statsIssues = getIssuesForStats(issues);
    
    const stats = {
        stateStats: {},
        priorityStats: {},
        milestoneStats: {},
        assigneeStats: {},
        teamWorkloadStats: {},
        noEstimationCount: 0,
        statsIssueCount: statsIssues.length,
        totalIssueCount: issues.length
    };
    
    for (const issue of statsIssues) {
        const { 
            state = "未知", 
            priority = "未设置", 
            milestone, 
            team = "未设置", 
            estimation, 
            assignees 
        } = issue;
        
        stats.stateStats[state] = (stats.stateStats[state] || 0) + 1;
        stats.priorityStats[priority] = (stats.priorityStats[priority] || 0) + 1;
        stats.milestoneStats[milestone || "未设置"] = (stats.milestoneStats[milestone || "未设置"] || 0) + 1;
        
        if (estimation > 0) {
            stats.teamWorkloadStats[team] = (stats.teamWorkloadStats[team] || 0) + estimation;
        } else {
            stats.noEstimationCount++;
        }
        
        if (assignees?.length > 0) {
            for (const assignee of assignees) {
                stats.assigneeStats[assignee] = (stats.assigneeStats[assignee] || 0) + 1;
            }
        } else {
            stats.assigneeStats["未分配"] = (stats.assigneeStats["未分配"] || 0) + 1;
        }
    }
    
    stats.assigneeStats = sortObjectByValue(stats.assigneeStats);
    stats.teamWorkloadStats = sortObjectByValue(stats.teamWorkloadStats);
    
    return stats;
}

/**
 * 检查是否有激活的过滤器
 */
const hasActiveFilters = () => !!(filters.state || filters.priority || filters.milestone || filters.assignee || filters.team || filters.hasEstimation !== null);

/**
 * 应用过滤器
 */
function applyFilters(issues) {
    if (!hasActiveFilters()) return issues;
    
    const { state, priority, milestone, assignee, team, hasEstimation } = filters;
    
    return issues.filter(issue => {
        if (state && issue.state !== state) return false;
        if (priority && issue.priority !== priority) return false;
        if (milestone && (issue.milestone || "未设置") !== milestone) return false;
        if (assignee) {
            if (assignee === "未分配" ? issue.assignees?.length : !issue.assignees?.includes(assignee)) return false;
        }
        if (team && (issue.team || "未设置") !== team) return false;
        // 修改：更明确的 estimation 判断
        if (hasEstimation === true && !(issue.estimation > 0)) return false;  // 必须有且 > 0
        if (hasEstimation === false && issue.estimation > 0) return false;     // 必须无或 = 0
        return true;
    });
}

/**
 * 清除所有过滤器
 */
function clearAllFilters() {
    resetFilters();
    refreshStats();
}

/* ---------------- 颜色配置 ---------------- */
function getStateColors() {
    return ["#2da44e", "#cf222e", "#57606a", "#0969da", "#8250df", "#bf8700"];
}

function getPriorityColors() {
    return ["#cf222e", "#bf8700", "#2da44e", "#6e7781"];
}

function getMilestoneColors() {
    return ["#0969da", "#6f42c1", "#fd7e14", "#20c997", "#e83e8c", "#17a2b8"];
}

function getWorkloadColors() {
    return ["#8250df", "#0969da", "#2da44e", "#bf8700", "#cf222e", "#fd7e14", "#e83e8c", "#17a2b8", "#6e7781"];
}

function getAssigneeColors() {
    return ["#0969da", "#6f42c1", "#fd7e14", "#20c997", "#e83e8c", "#17a2b8", "#2da44e", "#cf222e"];
}

/* ---------------- 刷新统计界面 ---------------- */
function refreshStats() {
    const container = getElement("stats-container", false);
    if (!container) return;
    
    destroyAllCharts();
    
    const filteredIssues = applyFilters(cachedIssues);
    const stats = getStatsData(filteredIssues);
    
    // 移除这行，缓存逻辑有问题
    // cachedStats = stats;
    
    // 构建 DOM
    const fragment = document.createDocumentFragment();
    
    // 统计说明
    fragment.appendChild(createStatsInfo(stats));
    
    // 过滤条件显示
    if (hasActiveFilters()) {
        fragment.appendChild(createFilterInfo());
    }
    
    // 图表区域
    const chartsRow = document.createElement("div");
    chartsRow.className = "charts-row";
    
    const categories = getChartCategories(stats);
    categories.forEach(category => {
        chartsRow.appendChild(createChartWrapper(category));
    });
    
    fragment.appendChild(chartsRow);
    
    // 一次性更新 DOM
    container.innerHTML = "";
    container.appendChild(fragment);
    
    // 延迟渲染图表
    requestAnimationFrame(() => {
        categories.forEach(category => {
            renderPieChart(`chart-${category.type}`, category);
        });
    });
    
    // 渲染 Issue 列表
    loadFilteredIssues();
}

function destroyAllCharts() {
    chartInstances.forEach(chart => {
        try {
            chart.destroy();
        } catch (e) {
            console.warn("销毁图表失败:", e);
        }
    });
    chartInstances.clear();
}

function createStatsInfo(stats) {
    const div = document.createElement("div");
    div.className = "stats-info";
    
    const { statsIssueCount, totalIssueCount } = stats;
    const excluded = totalIssueCount - statsIssueCount;
    
    div.innerHTML = excluded > 0
        ? `<span class="stats-note">📊 统计基于 ${statsIssueCount} 个顶层 Issue（已排除 ${excluded} 个子 Issue）</span>`
        : `<span class="stats-note">📊 统计基于 ${statsIssueCount} 个 Issue</span>`;
    
    return div;
}

function createFilterInfo() {
    const div = document.createElement("div");
    div.className = "filter-info";
    
    const activeFilters = [];
    if (filters.state) activeFilters.push(`状态: ${filters.state}`);
    if (filters.priority) activeFilters.push(`优先级: ${filters.priority}`);
    if (filters.milestone) activeFilters.push(`里程碑: ${filters.milestone}`);
    if (filters.assignee) activeFilters.push(`分配人: ${filters.assignee}`);
    if (filters.team) activeFilters.push(`Team: ${filters.team}`);
    if (filters.hasEstimation === true) activeFilters.push(`工作量: 有`);
    if (filters.hasEstimation === false) activeFilters.push(`工作量: 未设置`);
    
    div.innerHTML = `
        <span class="filter-label">当前过滤：${activeFilters.join(" + ")}</span>
        <button class="btn btn-small btn-secondary" onclick="clearAllFilters()">清除全部</button>
    `;
    
    return div;
}

function getChartCategories(stats) {
    const workloadData = { ...stats.teamWorkloadStats };
    if (stats.noEstimationCount > 0) {
        workloadData["未设置"] = stats.noEstimationCount;
    }
    
    return [
        { title: "状态", data: stats.stateStats, type: "state", colors: getStateColors() },
        { title: "优先级", data: stats.priorityStats, type: "priority", colors: getPriorityColors() },
        { title: "里程碑", data: stats.milestoneStats, type: "milestone", colors: getMilestoneColors() },
        { title: "工作量", data: workloadData, type: "workload", colors: getWorkloadColors(), isWorkload: true },
        { title: "分配人", data: stats.assigneeStats, type: "assignee", colors: getAssigneeColors(), paginated: true }
    ];
}

/* ---------------- 图表组件 ---------------- */
function createChartWrapper(category) {
    const wrapper = document.createElement("div");
    wrapper.className = "chart-wrapper";
    
    // 标题
    wrapper.appendChild(createChartTitle(category));
    
    // Canvas
    const canvasContainer = document.createElement("div");
    canvasContainer.className = "canvas-container";
    
    const canvas = document.createElement("canvas");
    canvas.id = `chart-${category.type}`;
    canvasContainer.appendChild(canvas);
    wrapper.appendChild(canvasContainer);
    
    // 标签
    const labelsContainer = document.createElement("div");
    labelsContainer.className = "chart-labels";
    labelsContainer.id = `labels-${category.type}`;
    
    if (category.paginated) {
        renderPaginatedLabels(category, labelsContainer);
    } else if (category.isWorkload) {
        renderWorkloadLabels(category, labelsContainer);
    } else {
        renderLabels(category, labelsContainer);
    }
    
    wrapper.appendChild(labelsContainer);
    
    return wrapper;
}

function createChartTitle(category) {
    const title = document.createElement("h3");
    
    if (category.isWorkload) {
        const total = Object.entries(category.data)
            .filter(([key]) => key !== "未设置")
            .reduce((sum, [, val]) => sum + val, 0);
        title.innerHTML = `${category.title} <span class="workload-total">(${total})</span>`;
        
        if (filters.team || filters.hasEstimation !== null) {
            title.innerHTML += ` <span class="filter-active-mark">✓</span>`;
        }
    } else {
        title.textContent = category.title;
        if (filters[category.type]) {
            title.innerHTML += ` <span class="filter-active-mark">✓</span>`;
        }
    }
    
    return title;
}

/* ---------------- 标签渲染 ---------------- */
function createLabelTag(text, count, color, options = {}) {
    const tag = document.createElement("div");
    tag.className = `label-tag${options.isActive ? " active" : ""}`;
    tag.style.borderLeftColor = color;
    
    tag.dataset.filterType = options.filterType || "";
    tag.dataset.filterValue = options.filterValue || "";
    if (options.isWorkload) tag.dataset.isWorkload = "true";
    
    const countClass = options.isWorkloadValue ? "label-count workload-value" : "label-count";
    tag.innerHTML = `<span class="label-text">${escapeHtml(text)}</span><span class="${countClass}">${count}</span>`;
    
    return tag;
}

// 替换 escapeHtml 函数

const escapeHtmlMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, char => escapeHtmlMap[char]);
}

function renderLabels(category, container) {
    const fragment = document.createDocumentFragment();
    const colors = category.colors;
    const data = category.data;
    const totalCount = Object.values(data).reduce((a, b) => a + b, 0);
    
    // 全部标签
    fragment.appendChild(createLabelTag("全部", totalCount, "#6e7781", {
        filterType: category.type,
        filterValue: "all",
        isActive: !filters[category.type]
    }));
    
    // 各项标签
    Object.entries(data).forEach(([label, count], idx) => {
        fragment.appendChild(createLabelTag(label, count, colors[idx % colors.length], {
            filterType: category.type,
            filterValue: label,
            isActive: filters[category.type] === label
        }));
    });
    
    container.innerHTML = "";
    container.appendChild(fragment);
}

function renderWorkloadLabels(category, container) {
    const fragment = document.createDocumentFragment();
    const colors = category.colors;
    const data = category.data;
    
    const totalWorkload = Object.entries(data)
        .filter(([key]) => key !== "未设置")
        .reduce((sum, [, val]) => sum + val, 0);
    
    // 全部标签
    fragment.appendChild(createLabelTag("全部", totalWorkload, "#6e7781", {
        filterType: "workload",
        filterValue: "all",
        isWorkload: true,
        isActive: !filters.team && filters.hasEstimation === null,
        isWorkloadValue: true
    }));
    
    // Team 标签
    let colorIdx = 0;
    Object.entries(data).forEach(([team, value]) => {
        if (team === "未设置") return;
        
        fragment.appendChild(createLabelTag(team, value, colors[colorIdx % colors.length], {
            filterType: "workload",
            filterValue: team,
            isWorkload: true,
            isActive: filters.team === team && filters.hasEstimation === true,
            isWorkloadValue: true
        }));
        colorIdx++;
    });
    
    // 未设置标签
    if (data["未设置"]) {
        fragment.appendChild(createLabelTag("未设置", `${data["未设置"]} 个`, "#6e7781", {
            filterType: "workload",
            filterValue: "no-estimation",
            isWorkload: true,
            isActive: filters.hasEstimation === false
        }));
    }
    
    container.innerHTML = "";
    container.appendChild(fragment);
}

function renderPaginatedLabels(category, container) {
    const fragment = document.createDocumentFragment();
    const colors = category.colors;
    const entries = Object.entries(category.data);
    const totalPages = Math.ceil(entries.length / ASSIGNEE_PAGE_SIZE);
    
    // 修正页码
    if (assigneePage >= totalPages) {
        assigneePage = Math.max(0, totalPages - 1);
    }
    
    const startIdx = assigneePage * ASSIGNEE_PAGE_SIZE;
    const pageEntries = entries.slice(startIdx, startIdx + ASSIGNEE_PAGE_SIZE);
    const totalCount = entries.reduce((sum, [, count]) => sum + count, 0);
    
    // 全部标签
    fragment.appendChild(createLabelTag("全部", totalCount, "#6e7781", {
        filterType: category.type,
        filterValue: "all",
        isActive: !filters[category.type]
    }));
    
    // 当前页标签
    pageEntries.forEach(([label, count], idx) => {
        const globalIdx = startIdx + idx;
        fragment.appendChild(createLabelTag(label, count, colors[globalIdx % colors.length], {
            filterType: category.type,
            filterValue: label,
            isActive: filters[category.type] === label
        }));
    });
    
    // 分页控制
    if (totalPages > 1) {
        const pagination = document.createElement("div");
        pagination.className = "pagination-wrapper";
        pagination.innerHTML = `
            <button class="pagination-btn" data-delta="-1" data-type="${category.type}" ${assigneePage === 0 ? "disabled" : ""}>◀</button>
            <span class="pagination-info">${assigneePage + 1}/${totalPages}</span>
            <button class="pagination-btn" data-delta="1" data-type="${category.type}" ${assigneePage >= totalPages - 1 ? "disabled" : ""}>▶</button>
        `;
        fragment.appendChild(pagination);
    }
    
    container.innerHTML = "";
    container.appendChild(fragment);
}

/* ---------------- 饼图渲染 ---------------- */
function renderPieChart(canvasId, category) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const labels = Object.keys(category.data);
    const data = Object.values(category.data);
    
    if (data.length === 0) return;
    
    const colors = category.colors;
    const isWorkload = category.isWorkload;
    const filterType = category.type;
    
    const chart = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: labels.map((label, i) => 
                    label === "未设置" ? "#6e7781" : colors[i % colors.length]
                ),
                borderColor: "#ffffff",
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const label = ctx.label;
                            const value = ctx.parsed;
                            if (isWorkload) {
                                return label === "未设置" 
                                    ? `${label}: ${value} 个 Issue` 
                                    : `${label}: ${value} (工作量)`;
                            }
                            return `${label}: ${value}`;
                        }
                    }
                }
            },
            onClick: (event, activeElements) => {
                if (activeElements.length === 0) return;
                
                const label = labels[activeElements[0].index];
                
                if (isWorkload) {
                    handleWorkloadFilter(label === "未设置" ? "no-estimation" : label);
                } else {
                    handleNormalFilter(filterType, label);
                }
                
                refreshStats();
            }
        }
    });
    
    chartInstances.set(canvasId, chart);
}

/* ---------------- Issue 列表 ---------------- */
function loadFilteredIssues() {
    const filteredIssues = applyFilters(cachedIssues);
    renderIssueList(filteredIssues, cachedIssues);
}


/**
 * 获取优先级排序权重（数值越小优先级越高）
 */
function getPriorityWeight(priority) {
    if (!priority) return 999;
    const lower = priority.toLowerCase();
    if (/p0|critical/.test(lower)) return 0;
    if (/p1|high/.test(lower)) return 1;
    if (/p2|medium/.test(lower)) return 2;
    if (/p3|low/.test(lower)) return 3;
    return 999;
}

/**
 * Issue 排序比较函数
 * 排序优先级：有 FunctionType 的优先 → P0 优先 → 更新时间新的优先
 */
function compareIssues(a, b) {
    // 1. 有 FunctionType 的优先（有值的排前面）
    const aHasFuncType = !!(a.FunctionType && a.FunctionType.trim());
    const bHasFuncType = !!(b.FunctionType && b.FunctionType.trim());
    
    if (aHasFuncType !== bHasFuncType) {
        return aHasFuncType ? -1 : 1;
    }
    
    // 如果都有 FunctionType，按字母顺序排序
    if (aHasFuncType && bHasFuncType) {
        const funcTypeCompare = a.FunctionType.localeCompare(b.FunctionType);
        if (funcTypeCompare !== 0) return funcTypeCompare;
    }
    
    // 2. 优先级排序（P0 > P1 > P2 > P3 > 未设置）
    const aPriority = getPriorityWeight(a.priority);
    const bPriority = getPriorityWeight(b.priority);
    
    if (aPriority !== bPriority) {
        return aPriority - bPriority;
    }
    
    // 3. 更新时间新的优先（降序）
    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    
    return bTime - aTime;
}


function renderIssueList(issues, allIssues) {
    const container = getElement("issues-details", false);
    if (!container) return;
    
    if (!issues?.length) {
        container.innerHTML = '<p class="no-issues">暂无 Issue</p>';
        return;
    }
    
    // 构建索引
    const allIssueMap = new Map();
    (allIssues || issues).forEach(i => {
        if (i.id) allIssueMap.set(i.id, i);
    });
    
    const filteredIds = new Set(issues.map(i => i.id));
    
    // 分类 Issue
    // 1. 子 Issue 且父 Issue 在列表中 → 跟随父 Issue 显示
    // 2. 子 Issue 但父 Issue 不在列表中 → 作为"孤立子 Issue"独立显示
    // 3. 非子 Issue → 作为顶层 Issue 显示
    const childrenOfFilteredParent = new Set();
    const orphanChildren = []; // 父 Issue 不在列表中的子 Issue
    const topLevelIssues = [];
    
    issues.forEach(issue => {
        if (issue.parentId) {
            if (filteredIds.has(issue.parentId)) {
                // 父 Issue 在列表中，作为子 Issue 跟随显示
                childrenOfFilteredParent.add(issue.id);
            } else {
                // 父 Issue 不在列表中，作为孤立子 Issue
                orphanChildren.push(issue);
            }
        } else {
            // 无父 Issue，作为顶层显示
            topLevelIssues.push(issue);
        }
    });
    
    // 合并顶层 Issue 和孤立子 Issue，一起排序
    const displayIssues = [...topLevelIssues, ...orphanChildren].sort(compareIssues);
    
    // 计算统计（仅统计顶层显示的 Issue，不重复计算子 Issue）
    const totalEstimation = issues.reduce((sum, i) => sum + (i.estimation || 0), 0);
    const childIssueCount = childrenOfFilteredParent.size;
    
    // 生成表格行
    const rows = displayIssues.map(issue => {
        // 判断是否为孤立子 Issue
        const isOrphanChild = issue.parentId && !filteredIds.has(issue.parentId);
        return generateIssueRow(issue, filteredIds, allIssueMap, isOrphanChild);
    }).join("");
    
    // 摘要文本
    let summaryText = `共 ${issues.length} 个 Issue`;
    const parts = [];
    if (topLevelIssues.length > 0) parts.push(`顶层 ${topLevelIssues.length} 个`);
    if (orphanChildren.length > 0) parts.push(`孤立子 Issue ${orphanChildren.length} 个`);
    if (childIssueCount > 0) parts.push(`嵌套子 Issue ${childIssueCount} 个`);
    if (parts.length > 0) summaryText += `（${parts.join("，")}）`;
    
    // 使用 template 提升性能
    const template = document.createElement("template");
    template.innerHTML = `
        <div class="issues-summary">
            <span>${summaryText}</span>
            <span>Estimation 总计: <strong>${totalEstimation}</strong></span>
        </div>
        <table class="issues-table">
            <thead>
                <tr>
                    <th style="width:30px"></th>
                    <th>FunctionType</th>
                    <th>Issue</th>
                    <th>状态</th>
                    <th>分配人</th>
                    <th>Estimation</th>
                    <th>Team</th>
                    <th>优先级</th>
                    <th>里程碑</th>
                    <th>更新时间</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
    
    container.innerHTML = "";
    container.appendChild(template.content.cloneNode(true));
}

function generateIssueRow(issue, filteredIds, allIssueMap, isOrphanChild = false) {
    // 获取子 Issue（仅父 Issue 在列表中的）
    const children = (issue.childIds || [])
        .filter(cid => filteredIds.has(cid))
        .map(cid => allIssueMap.get(cid))
        .filter(Boolean);
    
    const hasChildren = children.length > 0;
    
    // 检查 Estimation 是否匹配
    let estimationMismatch = false;
    if (hasChildren) {
        const parentEst = issue.estimation || 0;
        const childEst = children.reduce((sum, c) => sum + (c.estimation || 0), 0);
        const anyChildHasEst = children.some(c => c.estimation > 0);
        if (parentEst > 0 && anyChildHasEst) {
            estimationMismatch = parentEst !== childEst;
        }
    }
    
    const toggleId = `toggle-${safeId(issue.id || issue.number)}`;
    
    // 生成主行（如果是孤立子 Issue，使用特殊样式）
    let html = generateRowHtml(issue, {
        toggleId,
        hasChildren,
        estimationMismatch,
        isChild: false,
        isOrphanChild // 新增：标记孤立子 Issue
    });
    
    // 子 Issue 行（仅当有子 Issue 时）
    if (hasChildren) {
        children.forEach(child => {
            html += generateRowHtml(child, {
                toggleId,
                hasChildren: false,
                estimationMismatch: false,
                isChild: true,
                isOrphanChild: false
            });
        });
    }
    
    return html;
}

function generateRowHtml(issue, options) {
    const { toggleId, hasChildren, estimationMismatch, isChild, isOrphanChild } = options;
    
    const rowClass = [
        isChild ? "child-issue hidden" : "",
        isOrphanChild ? "orphan-child-issue" : "",
        estimationMismatch ? "estimation-mismatch" : ""
    ].filter(Boolean).join(" ");
    
    const dataAttr = isChild 
        ? `data-parent="${toggleId}"` 
        : `data-issue-id="${issue.id}"`;
    
    const toggleCell = hasChildren
        ? `<span class="toggle-arrow" data-toggle="${toggleId}">▶</span>`
        : "";
    
    // 孤立子 Issue 和普通子 Issue 都显示缩进指示器
    const showIndent = isChild || isOrphanChild;
    const titlePrefix = showIndent ? '<span class="child-indicator">↳</span> ' : "";
    const indentClass = showIndent ? "child-indent" : "";
    
    return `
        <tr class="${rowClass}" ${dataAttr}>
            <td class="toggle-cell">${toggleCell}</td>
            <td class="${indentClass}">${escapeHtml(issue.FunctionType || "")}</td>
            <td class="${indentClass}">${titlePrefix}<a class="issue-link" href="${issue.url}" target="_blank">${escapeHtml(issue.title)}</a></td>
            <td class="status-${(issue.state || "").toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(issue.state || "未知")}</td>
            <td>${escapeHtml(issue.assignees?.join(", ") || "未分配")}</td>
            <td><span class="estimation-badge">${issue.estimation ?? "-"}</span></td>
            <td><span class="team-badge">${escapeHtml(issue.team || "未设置")}</span></td>
            <td><span class="priority-badge priority-${getPriorityClass(issue.priority)}">${escapeHtml(issue.priority || "未设置")}</span></td>
            <td>${escapeHtml(issue.milestone || "未设置")}</td>
            <td>${formatDate(issue.updated_at)}</td>
        </tr>`;
}

/* ---------------- 子 Issue 展开/折叠 ---------------- */
function toggleChildren(toggleId) {
    const arrow = document.querySelector(`[data-toggle="${toggleId}"]`);
    const children = document.querySelectorAll(`[data-parent="${toggleId}"]`);
    
    if (!arrow || !children.length) return;
    
    const isExpanded = arrow.classList.contains("expanded");
    
    requestAnimationFrame(() => {
        arrow.classList.toggle("expanded", !isExpanded);
        arrow.textContent = isExpanded ? "▶" : "▼";
        
        children.forEach(child => {
            child.classList.toggle("hidden", isExpanded);
        });
    });
}

/* ---------------- 导出全局函数 ---------------- */
// 供 HTML onclick 调用
window.saveToken = saveToken;
window.clearToken = clearToken;
window.fetchProjects = fetchProjects;
window.fetchAndRefresh = fetchAndRefresh;
window.clearAllFilters = clearAllFilters;

// 新增常量定义
const FIELD_NAMES = {
    STATUS: "status",
    PRIORITY: "priority",
    ESTIMATION: "estimation",
    TEAM: "team",
    FUNCTION_TYPE: "functiontype"
};

const ISSUE_STATE = {
    CLOSED: "CLOSED",
    OPEN: "OPEN"
};

// 添加全局错误处理

window.addEventListener("error", (event) => {
    console.error("全局错误:", event.error);
    hideLoading();
});

window.addEventListener("unhandledrejection", (event) => {
    console.error("未处理的 Promise 错误:", event.reason);
    hideLoading();
});

