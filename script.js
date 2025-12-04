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

/* ---------------- 页面初始化 ---------------- */
document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    updateTokenStatus();
    loadCachedData();
    loadProjectSelect();
    updateLastFetchTime();
});

/* ---------------- Tab 切换 ---------------- */
function initTabs() {
    const tabs = document.querySelectorAll(".nav-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const targetTab = tab.dataset.tab;
            
            // 更新 tab 状态
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            
            // 更新内容显示
            document.querySelectorAll(".tab-content").forEach(content => {
                content.classList.remove("active");
            });
            document.getElementById(`tab-${targetTab}`).classList.add("active");
        });
    });
}

/* ---------------- Loading Progress ---------------- */
function showLoading(text = "正在加载...", detail = "") {
    const container = document.getElementById("loading-container");
    const textEl = document.getElementById("loading-text");
    const percentEl = document.getElementById("loading-percent");
    const fillEl = document.getElementById("loading-bar-fill");
    const detailEl = document.getElementById("loading-detail");
    const btn = document.getElementById("fetch-btn");
    
    if (container) {
        container.classList.remove("hidden");
    }
    if (textEl) textEl.textContent = text;
    if (percentEl) percentEl.textContent = "0%";
    if (fillEl) fillEl.style.width = "0%";
    if (detailEl) detailEl.textContent = detail;
    if (btn) btn.classList.add("loading");
}

function updateLoading(percent, text = null, detail = null) {
    const percentEl = document.getElementById("loading-percent");
    const fillEl = document.getElementById("loading-bar-fill");
    const textEl = document.getElementById("loading-text");
    const detailEl = document.getElementById("loading-detail");
    
    if (percentEl) percentEl.textContent = `${Math.round(percent)}%`;
    if (fillEl) fillEl.style.width = `${percent}%`;
    if (text && textEl) textEl.textContent = text;
    if (detail !== null && detailEl) detailEl.textContent = detail;
}

function hideLoading() {
    const container = document.getElementById("loading-container");
    const btn = document.getElementById("fetch-btn");
    
    if (container) {
        container.classList.add("hidden");
    }
    if (btn) btn.classList.remove("loading");
}

// 保留旧的函数兼容性
function showLoadingBar() {
    showLoading("正在加载数据...");
}

function hideLoadingBar() {
    hideLoading();
}

/* ---------------- Token 管理 ---------------- */
function loadToken() {
    return localStorage.getItem(STORAGE_KEYS.TOKEN) || "";
}

function saveToken() {
    const input = document.getElementById("token-input");
    const token = input.value.trim();
    if (token) {
        localStorage.setItem(STORAGE_KEYS.TOKEN, token);
        input.value = "";
        updateTokenStatus();
        fetchProjects();
    }
}

function clearToken() {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    updateTokenStatus();
}

function updateTokenStatus() {
    const status = document.getElementById("token-status");
    const token = loadToken();
    if (status) {
        if (token) {
            status.className = "token-status success";
            status.innerHTML = "✓ Token 已配置（" + token.substring(0, 8) + "...）";
        } else {
            status.className = "token-status error";
            status.innerHTML = "✗ 未配置 Token";
        }
    }
}

/* ---------------- 缓存管理 ---------------- */
function loadCachedData() {
    const cached = localStorage.getItem(STORAGE_KEYS.CACHED_ISSUES);
    if (cached) {
        try {
            cachedIssues = JSON.parse(cached);
            if (cachedIssues.length > 0) {
                refreshStats();
            }
        } catch (e) {
            cachedIssues = [];
        }
    }
}

function saveCachedIssues() {
    localStorage.setItem(STORAGE_KEYS.CACHED_ISSUES, JSON.stringify(cachedIssues));
}

function updateLastFetchTime() {
    const timeEl = document.getElementById("last-fetch-time");
    const lastFetch = localStorage.getItem(STORAGE_KEYS.LAST_FETCH_TIME);
    if (timeEl && lastFetch) {
        timeEl.textContent = "上次更新: " + new Date(parseInt(lastFetch)).toLocaleString();
    }
}

/* ---------------- 项目管理 ---------------- */
function loadProjectSelect() {
    const select = document.getElementById("project-select");
    const saved = localStorage.getItem(STORAGE_KEYS.PROJECTS);
    const selectedProject = localStorage.getItem(STORAGE_KEYS.SELECTED_PROJECT);
    
    if (!select) return;
    
    select.innerHTML = '<option value="">-- 请选择 --</option>';
    
    if (saved) {
        try {
            const projects = JSON.parse(saved);
            projects.forEach(p => {
                const opt = document.createElement("option");
                opt.value = JSON.stringify(p);
                opt.textContent = `${p.owner} / ${p.title}`;
                if (selectedProject === JSON.stringify(p)) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            });
        } catch (e) {
            console.error("加载项目列表失败", e);
        }
    }
}

function saveSelectedProject() {
    const select = document.getElementById("project-select");
    if (select && select.value) {
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
    
    showLoadingBar();
    
    const query = `
    query {
        viewer {
            login
            projectsV2(first: 50) {
                nodes {
                    title
                    number
                    owner {
                        ... on Organization { login }
                        ... on User { login }
                    }
                }
            }
            organizations(first: 20) {
                nodes {
                    login
                    projectsV2(first: 50) {
                        nodes {
                            title
                            number
                            owner {
                                ... on Organization { login }
                                ... on User { login }
                            }
                        }
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
            hideLoadingBar();
            alert("获取项目失败：" + json.errors[0].message);
            return;
        }
        
        const projects = [];
        
        // 用户项目
        json.data.viewer.projectsV2.nodes.forEach(p => {
            projects.push({
                title: p.title,
                number: p.number,
                owner: p.owner.login,
                ownerType: "User"
            });
        });
        
        // 组织项目
        json.data.viewer.organizations.nodes.forEach(org => {
            org.projectsV2.nodes.forEach(p => {
                projects.push({
                    title: p.title,
                    number: p.number,
                    owner: p.owner.login,
                    ownerType: "Organization"
                });
            });
        });
        
        localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
        loadProjectSelect();
        
        hideLoadingBar();
        
    } catch (err) {
        hideLoadingBar();
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
        refreshStats();
    }
}

/* ---------------- 从 Project 拉取 Issue ---------------- */
async function fetchProjectIssues() {
    const select = document.getElementById("project-select");
    if (!select || !select.value) {
        alert("请先选择一个项目");
        return null;
    }
    
    const token = loadToken();
    if (!token) {
        alert("请先配置 GitHub Token");
        return null;
    }
    
    const project = JSON.parse(select.value);
    const { owner, number, ownerType } = project;
    
    saveSelectedProject();
    
    showLoading("正在获取 Issue 列表...", `项目: ${project.title}`);
    
    const ownerQuery = ownerType === "Organization" ? "organization" : "user";
    
    const query = `
    query($owner: String!, $number: Int!, $cursor: String) {
        ${ownerQuery}(login: $owner) {
            projectV2(number: $number) {
                title
                items(first: 100, after: $cursor) {
                    totalCount
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                    nodes {
                        content {
                            ... on Issue {
                                id
                                number
                                title
                                state
                                url
                                updatedAt
                                milestone { title }
                                labels(first: 20) { nodes { name } }
                                assignees(first: 10) { nodes { login } }
                                repository {
                                    name
                                    owner { login }
                                }
                            }
                        }
                        fieldValues(first: 20) {
                            nodes {
                                ... on ProjectV2ItemFieldSingleSelectValue {
                                    field { ... on ProjectV2SingleSelectField { name } }
                                    name
                                }
                                ... on ProjectV2ItemFieldTextValue {
                                    field { ... on ProjectV2FieldCommon { name } }
                                    text
                                }
                                ... on ProjectV2ItemFieldDateValue {
                                    field { ... on ProjectV2FieldCommon { name } }
                                    date
                                }
                                ... on ProjectV2ItemFieldNumberValue {
                                    field { ... on ProjectV2FieldCommon { name } }
                                    number
                                }
                                ... on ProjectV2ItemFieldIterationValue {
                                    field { ... on ProjectV2IterationField { name } }
                                    title
                                    startDate
                                    duration
                                }
                            }
                        }
                    }
                }
            }
        }
    }`;
    
    let allItems = [];
    let cursor = null;
    let projectTitle = project.title;
    let totalCount = 0;
    let pageNum = 0;
    
    try {
        do {
            pageNum++;
            const res = await fetch(GITHUB_GRAPHQL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ 
                    query, 
                    variables: { owner, number, cursor } 
                })
            });
            
            const json = await res.json();
            
            if (json.errors) {
                console.error("GraphQL errors:", json.errors);
                hideLoading();
                alert("GitHub API 错误：" + json.errors[0].message);
                return null;
            }
            
            const projectData = json.data[ownerQuery]?.projectV2;
            
            if (!projectData) {
                hideLoading();
                alert("无法找到该 Project，请检查权限");
                return null;
            }
            
            projectTitle = projectData.title;
            const items = projectData.items;
            
            if (totalCount === 0) {
                totalCount = items.totalCount;
            }
            
            allItems = allItems.concat(items.nodes);
            
            // 更新进度（Issue 获取阶段占 50%）
            const progress = Math.min((allItems.length / totalCount) * 50, 50);
            updateLoading(progress, "正在获取 Issue 列表...", `已获取 ${allItems.length} / ${totalCount} 条`);
            
            cursor = items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null;
            
        } while (cursor);
        
    } catch (err) {
        console.error(err);
        hideLoading();
        alert("网络或请求错误，请检查 Token 和网络");
        return null;
    }
    
    updateLoading(50, "正在处理 Issue 数据...", `共 ${allItems.length} 条`);
    
    // 收集所有 Issue 基础数据
    const issuesData = allItems
        .filter(item => item.content && item.content.url)
        .map(item => {
            const content = item.content;
            const fvals = item.fieldValues.nodes;
            
            // 获取 Status 字段
            const statusField = fvals.find(f => f?.field?.name?.toLowerCase() === "status");
            const projectStatus = statusField ? (statusField.name || statusField.text || "未知") : "未知";
            
            // 获取 Priority 字段
            const priorityField = fvals.find(f => f?.field?.name?.toLowerCase() === "priority");
            const priority = priorityField ? (priorityField.name || priorityField.text || "未设置") : "未设置";
            
            // 获取 FunctionType 字段
            const funcField = fvals.find(f => f?.field?.name?.toLowerCase() === "functiontype");
            const FunctionType = funcField ? (funcField.text || funcField.name) : "";
            
            // 获取 Estimation 字段
            const estimationField = fvals.find(f => f?.field?.name?.toLowerCase() === "estimation");
            let estimation = null;
            if (estimationField && typeof estimationField.number === "number") {
                estimation = estimationField.number;
            }
            
            // 获取 Team 字段
            const teamField = fvals.find(f => f?.field?.name?.toLowerCase() === "team");
            const team = teamField ? (teamField.name || teamField.text || teamField.title || "未设置") : "未设置";
            
            const assignees = content.assignees?.nodes?.map(a => a.login) || [];
            
            return {
                id: content.id,
                owner: content.repository.owner.login,
                repo: content.repository.name,
                number: content.number,
                url: content.url,
                title: content.title,
                state: projectStatus,
                issueState: content.state,
                milestone: content.milestone?.title || null,
                updated_at: content.updatedAt,
                labels: content.labels?.nodes?.map(n => n.name) || [],
                priority: priority,
                project_name: projectTitle,
                FunctionType: FunctionType,
                assignees: assignees,
                estimation: estimation,
                team: team,
                parentId: null,
                childIds: []
            };
        })
        .filter(i => i.issueState !== "CLOSED");
    
    updateLoading(60, "正在获取父子关系...", `处理 ${issuesData.length} 个 Issue`);
    
    // 获取每个 Issue 的父子关系
    await fetchParentChildRelationships(issuesData, token);
    
    updateLoading(100, "加载完成！", `共 ${issuesData.length} 个 Issue`);
    
    // 延迟隐藏，让用户看到完成状态
    setTimeout(() => {
        hideLoading();
    }, 500);
    
    return issuesData;
}

/* 获取父子关系（带进度显示） */
async function fetchParentChildRelationships(issues, token) {
    const issueMap = new Map();
    const issueByNodeId = new Map();
    issues.forEach(i => {
        issueMap.set(`${i.owner}/${i.repo}#${i.number}`, i);
        issueByNodeId.set(i.id, i);
    });
    
    const batchSize = 100;
    const batches = [];
    
    for (let i = 0; i < issues.length; i += batchSize) {
        batches.push(issues.slice(i, i + batchSize));
    }
    
    // 逐批处理并更新进度
    for (let i = 0; i < batches.length; i++) {
        await fetchBatchParentChild(batches[i], token, issueMap, issueByNodeId);
        
        // 更新进度（父子关系阶段占 60% - 100%）
        const progress = 60 + ((i + 1) / batches.length) * 40;
        updateLoading(progress, "正在获取父子关系...", `批次 ${i + 1} / ${batches.length}`);
    }
}

/* 批量获取父子关系 */
async function fetchBatchParentChild(batch, token, issueMap, issueByNodeId) {
    const queries = batch.map((issue, idx) => `
        issue${idx}: node(id: "${issue.id}") {
            ... on Issue {
                id
                number
                parent {
                    id
                    number
                    repository {
                        owner { login }
                        name
                    }
                }
            }
        }
    `).join("\n");
    
    const query = `query { ${queries} }`;
    
    try {
        const res = await fetch(GITHUB_GRAPHQL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "GraphQL-Features": "sub_issues"
            },
            body: JSON.stringify({ query })
        });
        
        const json = await res.json();
        
        if (json.errors) {
            console.warn("获取父子关系时出错:", json.errors);
            return;
        }
        
        batch.forEach((issue, idx) => {
            const result = json.data[`issue${idx}`];
            if (result?.parent) {
                const parent = result.parent;
                const parentKey = `${parent.repository.owner.login}/${parent.repository.name}#${parent.number}`;
                
                issue.parentId = parent.id;
                
                const parentIssue = issueMap.get(parentKey) || issueByNodeId.get(parent.id);
                if (parentIssue) {
                    if (!parentIssue.childIds.includes(issue.id)) {
                        parentIssue.childIds.push(issue.id);
                    }
                }
            }
        });
        
    } catch (err) {
        console.error("获取父子关系失败:", err);
    }
}

/* 拉取并刷新统计 */
async function fetchAndRefreshStats() {
    const select = document.getElementById("project-select");
    if (!select || !select.value) {
        return alert("请先选择一个 Project");
    }
    
    const issues = await fetchProjectIssues();
    if (issues) {
        cachedIssues = issues;
        // 重置所有过滤器
        filters = {
            state: null,
            priority: null,
            milestone: null,
            assignee: null,
            team: null,
            hasEstimation: null
        };
        assigneePage = 0;
        
        // 保存拉取时间
        const now = new Date().toISOString();
        localStorage.setItem(STORAGE_KEYS.LAST_FETCH_TIME, now);
        updateLastFetchTimeDisplay();
        
        // 保存到缓存
        saveCachedIssues();
        
        refreshStats();
    }
}

/* 更新最后拉取时间显示 */
function updateLastFetchTimeDisplay() {
    const container = document.getElementById("last-fetch-time");
    const lastFetchTime = localStorage.getItem(STORAGE_KEYS.LAST_FETCH_TIME);
    
    if (container) {
        if (lastFetchTime) {
            const date = new Date(lastFetchTime);
            container.textContent = `最后更新时间：${date.toLocaleString()}`;
            container.style.display = "block";
        } else {
            container.textContent = "";
            container.style.display = "none";
        }
    }
}

/* ---------------- 统计页面专用函数 ---------------- */

/* 获取用于统计的 Issue（过滤掉父 Issue 在列表中的子 Issue） */
function getIssuesForStats(issues) {
    // 构建 Issue ID 集合
    const issueIdSet = new Set(issues.map(i => i.id));
    
    // 过滤掉父 Issue 在当前列表中的子 Issue
    return issues.filter(issue => {
        // 如果没有父 Issue，保留
        if (!issue.parentId) return true;
        // 如果父 Issue 不在当前列表中，保留
        if (!issueIdSet.has(issue.parentId)) return true;
        // 父 Issue 在列表中，过滤掉这个子 Issue
        return false;
    });
}

/* 生成统计数据 */
function getStatsData(issues) {
    // 获取用于统计的 Issue（排除父 Issue 在列表中的子 Issue）
    const statsIssues = getIssuesForStats(issues);
    
    const stateStats = {};
    const priorityStats = {};
    const milestoneStats = {};
    const assigneeStats = {};
    const teamWorkloadStats = {};  // 每个 Team 的工作量总和
    let noEstimationCount = 0;  // 未设置工作量的 Issue 数量
    
    statsIssues.forEach(i => {
        const state = i.state || "未知";
        const priority = i.priority || "未设置";
        const milestone = i.milestone || "未设置";
        const team = i.team || "未设置";
        const estimation = i.estimation;
        
        stateStats[state] = (stateStats[state] || 0) + 1;
        priorityStats[priority] = (priorityStats[priority] || 0) + 1;
        milestoneStats[milestone] = (milestoneStats[milestone] || 0) + 1;
        
        // 统计工作量
        if (estimation !== null && estimation > 0) {
            teamWorkloadStats[team] = (teamWorkloadStats[team] || 0) + estimation;
        } else {
            noEstimationCount++;
        }
        
        if (i.assignees && i.assignees.length > 0) {
            i.assignees.forEach(a => {
                assigneeStats[a] = (assigneeStats[a] || 0) + 1;
            });
        } else {
            assigneeStats["未分配"] = (assigneeStats["未分配"] || 0) + 1;
        }
    });
    
    return { 
        stateStats, 
        priorityStats, 
        milestoneStats, 
        assigneeStats, 
        teamWorkloadStats, 
        noEstimationCount,
        statsIssueCount: statsIssues.length,  // 用于统计的 Issue 数量
        totalIssueCount: issues.length         // 总 Issue 数量（包含子 Issue）
    };
}

/* 刷新统计界面 */
function refreshStats() {
    // 应用过滤器获取过滤后的 Issue
    const filteredIssues = applyFilters(cachedIssues);
    
    const { 
        stateStats, 
        priorityStats, 
        milestoneStats, 
        assigneeStats, 
        teamWorkloadStats, 
        noEstimationCount,
        statsIssueCount,
        totalIssueCount
    } = getStatsData(filteredIssues);
    
    const container = document.getElementById("stats-container");
    
    if (!container) return;
    
    container.innerHTML = "";
    
    // 显示统计说明
    const statsInfo = document.createElement("div");
    statsInfo.className = "stats-info";
    if (statsIssueCount < totalIssueCount) {
        statsInfo.innerHTML = `<span class="stats-note">📊 统计基于 ${statsIssueCount} 个顶层 Issue（已排除 ${totalIssueCount - statsIssueCount} 个子 Issue）</span>`;
    } else {
        statsInfo.innerHTML = `<span class="stats-note">📊 统计基于 ${statsIssueCount} 个 Issue</span>`;
    }
    container.appendChild(statsInfo);
    
    // 显示当前过滤条件
    if (hasActiveFilters()) {
        const filterInfo = document.createElement("div");
        filterInfo.className = "filter-info";
        
        const activeFilters = [];
        if (filters.state) activeFilters.push(`状态: ${filters.state}`);
        if (filters.priority) activeFilters.push(`优先级: ${filters.priority}`);
        if (filters.milestone) activeFilters.push(`里程碑: ${filters.milestone}`);
        if (filters.assignee) activeFilters.push(`分配人: ${filters.assignee}`);
        if (filters.team) activeFilters.push(`Team: ${filters.team}`);
        if (filters.hasEstimation === true) activeFilters.push(`工作量: 有`);
        if (filters.hasEstimation === false) activeFilters.push(`工作量: 未设置`);
        
        filterInfo.innerHTML = `
            <span class="filter-label">当前过滤：${activeFilters.join(" + ")}</span>
            <button class="btn btn-small btn-secondary" onclick="clearAllFilters()">清除全部</button>
        `;
        container.appendChild(filterInfo);
    }
    
    // 对分配人按 Issue 数量降序排序
    const sortedAssigneeStats = Object.entries(assigneeStats)
        .sort((a, b) => b[1] - a[1])
        .reduce((acc, [key, value]) => {
            acc[key] = value;
            return acc;
        }, {});
    
    // 对 Team 工作量按值降序排序
    const sortedTeamWorkloadStats = Object.entries(teamWorkloadStats)
        .sort((a, b) => b[1] - a[1])
        .reduce((acc, [key, value]) => {
            acc[key] = value;
            return acc;
        }, {});
    
    // 添加"未设置"到工作量统计
    const workloadDataWithNoEstimation = { ...sortedTeamWorkloadStats };
    if (noEstimationCount > 0) {
        workloadDataWithNoEstimation["未设置"] = noEstimationCount;
    }
    
    const chartsRow = document.createElement("div");
    chartsRow.className = "charts-row";
    
    const categories = [
        { title: "状态", data: stateStats, type: "state", colors: ["#2da44e", "#cf222e", "#57606a", "#0969da", "#8250df", "#bf8700"] },
        { title: "优先级", data: priorityStats, type: "priority", colors: ["#cf222e", "#bf8700", "#2da44e", "#6e7781"] },
        { title: "里程碑", data: milestoneStats, type: "milestone", colors: ["#0969da", "#6f42c1", "#fd7e14", "#20c997"] },
        { title: "工作量", data: workloadDataWithNoEstimation, type: "workload", colors: ["#8250df", "#0969da", "#2da44e", "#bf8700", "#cf222e", "#fd7e14", "#e83e8c", "#17a2b8", "#6e7781"], isWorkload: true },
        { title: "分配人", data: sortedAssigneeStats, type: "assignee", colors: ["#0969da", "#6f42c1", "#fd7e14", "#20c997", "#e83e8c", "#17a2b8", "#2da44e", "#cf222e"], paginated: true }
    ];
    
    categories.forEach((category, categoryIdx) => {
        const chartWrapper = document.createElement("div");
        chartWrapper.className = "chart-wrapper";
        
        const title = document.createElement("h3");
        
        // 如果是工作量，显示总计
        if (category.isWorkload) {
            const total = Object.entries(category.data)
                .filter(([key]) => key !== "未设置")
                .reduce((sum, [, value]) => sum + value, 0);
            title.innerHTML = `${category.title} <span class="workload-total">(${total})</span>`;
        } else {
            title.textContent = category.title;
        }
        
        // 如果该类型有过滤，显示标记
        if (category.isWorkload) {
            if (filters.team || filters.hasEstimation !== null) {
                title.innerHTML += ` <span class="filter-active-mark">✓</span>`;
            }
        } else if (filters[category.type]) {
            title.innerHTML += ` <span class="filter-active-mark">✓</span>`;
        }
        
        chartWrapper.appendChild(title);
        
        const canvasContainer = document.createElement("div");
        canvasContainer.className = "canvas-container";
        
        const canvas = document.createElement("canvas");
        canvas.id = `chart-${category.type}`;
        canvasContainer.appendChild(canvas);
        chartWrapper.appendChild(canvasContainer);
        
        const labelsContainer = document.createElement("div");
        labelsContainer.className = "chart-labels";
        labelsContainer.id = `labels-${category.type}`;
        
        chartWrapper.appendChild(labelsContainer);
        chartsRow.appendChild(chartWrapper);
        
        // 渲染标签
        if (category.paginated) {
            renderPaginatedLabels(category, labelsContainer);
        } else if (category.isWorkload) {
            renderWorkloadLabels(category, labelsContainer);
        } else {
            renderLabels(category, labelsContainer);
        }
        
        setTimeout(() => {
            renderPieChart(canvas.id, category, categoryIdx);
        }, 0);
    });
    
    container.appendChild(chartsRow);
    
    loadFilteredIssues();
}

/* 渲染工作量标签（显示 Team 的 Estimation 总和） */
function renderWorkloadLabels(category, container) {
    container.innerHTML = "";
    const colors = category.colors;
    
    // 计算有工作量的总和（不包括"未设置"）
    const totalWorkload = Object.entries(category.data)
        .filter(([key]) => key !== "未设置")
        .reduce((sum, [, value]) => sum + value, 0);
    
    // 添加 "全部" 标签
    const allLabelTag = document.createElement("div");
    allLabelTag.className = "label-tag";
    allLabelTag.style.borderLeftColor = "#6e7781";
    
    const isAllActive = !filters.team && filters.hasEstimation === null;
    if (isAllActive) {
        allLabelTag.classList.add("active");
    }
    
    allLabelTag.innerHTML = `<span class="label-text">全部</span><span class="label-count workload-value">${totalWorkload}</span>`;
    
    allLabelTag.addEventListener("click", () => {
        filters.team = null;
        filters.hasEstimation = null;
        saveCachedIssues();
        refreshStats();
    });
    
    container.appendChild(allLabelTag);
    
    // 渲染有工作量的 Team
    let colorIdx = 0;
    Object.entries(category.data).forEach(([team, value]) => {
        if (team === "未设置") return; // 最后渲染"未设置"
        
        const labelTag = document.createElement("div");
        labelTag.className = "label-tag";
        labelTag.style.borderLeftColor = colors[colorIdx % colors.length];
        colorIdx++;
        
        const isActive = filters.team === team && filters.hasEstimation === true;
        if (isActive) {
            labelTag.classList.add("active");
        }
        
        labelTag.innerHTML = `<span class="label-text">${team}</span><span class="label-count workload-value">${value}</span>`;
        
        labelTag.addEventListener("click", () => {
            if (filters.team === team && filters.hasEstimation === true) {
                filters.team = null;
                filters.hasEstimation = null;
            } else {
                filters.team = team;
                filters.hasEstimation = true;
            }
            
            saveCachedIssues();
            refreshStats();
        });
        
        container.appendChild(labelTag);
    });
    
    // 最后渲染"未设置"标签
    if (category.data["未设置"]) {
        const noEstimationTag = document.createElement("div");
        noEstimationTag.className = "label-tag";
        noEstimationTag.style.borderLeftColor = "#6e7781";
        
        const isActive = filters.hasEstimation === false;
        if (isActive) {
            noEstimationTag.classList.add("active");
        }
        
        noEstimationTag.innerHTML = `<span class="label-text">未设置</span><span class="label-count">${category.data["未设置"]} 个</span>`;
        
        noEstimationTag.addEventListener("click", () => {
            if (filters.hasEstimation === false) {
                filters.team = null;
                filters.hasEstimation = null;
            } else {
                filters.team = null;
                filters.hasEstimation = false;
            }
            
            saveCachedIssues();
            refreshStats();
        });
        
        container.appendChild(noEstimationTag);
    }
}

/* ---------------- 应用过滤器 ---------------- */
function applyFilters(issues) {
    let result = [...issues];
    
    if (filters.state) {
        result = result.filter(i => i.state === filters.state);
    }
    
    if (filters.priority) {
        result = result.filter(i => i.priority === filters.priority);
    }
    
    if (filters.milestone) {
        result = result.filter(i => (i.milestone || "未设置") === filters.milestone);
    }
    
    if (filters.assignee) {
        if (filters.assignee === "未分配") {
            result = result.filter(i => !i.assignees || i.assignees.length === 0);
        } else {
            result = result.filter(i => i.assignees && i.assignees.includes(filters.assignee));
        }
    }
    
    // 按 Team 过滤
    if (filters.team) {
        result = result.filter(i => (i.team || "未设置") === filters.team);
    }
    
    // 按是否有工作量过滤
    if (filters.hasEstimation === true) {
        result = result.filter(i => i.estimation !== null && i.estimation > 0);
    } else if (filters.hasEstimation === false) {
        result = result.filter(i => i.estimation === null || i.estimation === 0);
    }
    
    return result;
}

/* 检查是否有任何过滤器激活 */
function hasActiveFilters() {
    return filters.state || filters.priority || filters.milestone || filters.assignee || filters.team || filters.hasEstimation !== null;
}

/* 清除所有过滤器 */
function clearAllFilters() {
    filters = {
        state: null,
        priority: null,
        milestone: null,
        assignee: null,
        team: null,
        hasEstimation: null
    };
    assigneePage = 0;
    saveCachedIssues();
    refreshStats();
}

/* ---------------- 创建加载指示器 ---------------- */
function showLoadingBar() {
    const existing = document.querySelector(".loading-bar");
    if (existing) existing.remove();
    
    const loadingBar = document.createElement("div");
    loadingBar.className = "loading-bar";
    loadingBar.innerHTML = `
        <div class="loading-bar-progress"></div>
        <div class="loading-bar-text">加载中...</div>
    `;
    document.body.appendChild(loadingBar);
    
    return loadingBar;
}

function hideLoadingBar() {
    const loadingBar = document.querySelector(".loading-bar");
    if (loadingBar) {
        loadingBar.classList.add("done");
        setTimeout(() => loadingBar.remove(), 600);
    }
}

/* ---------------- 优先级样式 ---------------- */
function priorityClass(p) {
    if (!p) return "none";
    if (/p0|high|critical/i.test(p)) return "high";
    if (/p1|medium/i.test(p)) return "medium";
    if (/p2|low/i.test(p)) return "low";
    return "none";
}

/* 绘制饼图 */
function renderPieChart(canvasId, category, idx) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const labels = Object.keys(category.data);
    const data = Object.values(category.data);
    
    if (data.length === 0) return;
    
    const colors = category.colors || [
        "#0969da", "#6f42c1", "#fd7e14", "#20c997", "#e83e8c", "#17a2b8"
    ];
    
    // 确定过滤器类型
    const filterType = category.type;
    const isWorkload = category.isWorkload;
    
    new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: labels.map((label, i) => {
                    // "未设置"使用灰色
                    if (label === "未设置") return "#6e7781";
                    return colors[i % colors.length];
                }),
                borderColor: "#ffffff",
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label;
                            const value = context.parsed;
                            if (isWorkload) {
                                if (label === "未设置") {
                                    return `${label}: ${value} 个 Issue`;
                                }
                                return `${label}: ${value} (工作量)`;
                            }
                            return `${label}: ${value}`;
                        }
                    }
                }
            },
            onClick: (event, activeElements, chart) => {
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    const label = labels[index];
                    
                    // 工作量饼图的特殊处理
                    if (isWorkload) {
                        if (label === "未设置") {
                            if (filters.hasEstimation === false) {
                                filters.team = null;
                                filters.hasEstimation = null;
                            } else {
                                filters.team = null;
                                filters.hasEstimation = false;
                            }
                        } else {
                            if (filters.team === label && filters.hasEstimation === true) {
                                filters.team = null;
                                filters.hasEstimation = null;
                            } else {
                                filters.team = label;
                                filters.hasEstimation = true;
                            }
                        }
                    } else {
                        // 使用正确的过滤器类型
                        if (filters[filterType] === label) {
                            filters[filterType] = null;
                        } else {
                            filters[filterType] = label;
                        }
                    }
                    
                    saveCachedIssues();
                    refreshStats();
                }
            }
        }
    });
}

/* 根据过滤条件加载 Issue 列表 */
function loadFilteredIssues() {
    // 注意：这里传入的是过滤后的 issues，但父子关系需要基于原始数据
    const filteredIssues = applyFilters(cachedIssues);
    loadIssuesListBySession(filteredIssues, cachedIssues);
}

/* Issue 列表 */
function loadIssuesListBySession(issues, allIssues) {
    const c = document.getElementById("issues-details");
    
    if (!c) return;

    if (!issues || !issues.length) {
        c.innerHTML = "<p>暂无 Issue</p>";
        return;
    }

    // 使用所有 Issue 构建映射（包括未过滤的），以便正确建立父子关系
    const allIssueMap = new Map();
    (allIssues || issues).forEach(i => {
        if (i.id) {
            allIssueMap.set(i.id, i);
        }
    });
    
    // 过滤后的 Issue ID 集合
    const filteredIds = new Set(issues.map(i => i.id));
    
    // 找出在当前过滤结果中的子 Issue（其父 Issue 也在过滤结果中）
    const childIdsInFiltered = new Set();
    issues.forEach(i => {
        if (i.parentId && filteredIds.has(i.parentId)) {
            childIdsInFiltered.add(i.id);
        }
    });
    
    // 顶层 Issue = 过滤结果中不是子 Issue 的
    const topLevelIssues = issues.filter(i => !childIdsInFiltered.has(i.id));
    
    // 按 FunctionType 排序
    topLevelIssues.sort((a, b) => {
        if (!a.FunctionType) return 1;
        if (!b.FunctionType) return -1;
        return a.FunctionType.localeCompare(b.FunctionType);
    });
    
    // 计算 Estimation 总和（只计算顶层 Issue，避免重复计算）
    const totalEstimation = topLevelIssues.reduce((sum, i) => sum + (i.estimation || 0), 0);
    
    // 计算子 Issue 数量
    const childIssueCount = childIdsInFiltered.size;
    
    // 生成表格行
    function generateRows() {
        let rows = "";
        
        topLevelIssues.forEach(issue => {
            // 获取当前 Issue 的子 Issue（必须在过滤结果中）
            const children = (issue.childIds || [])
                .filter(cid => filteredIds.has(cid))
                .map(cid => allIssueMap.get(cid))
                .filter(Boolean);
            
            const hasChildren = children.length > 0;
            
            // 检查 Estimation 是否匹配
            let estimationMismatch = false;
            if (hasChildren) {
                const parentEstimation = issue.estimation;
                const childrenEstimationSum = children.reduce((sum, child) => sum + (child.estimation || 0), 0);
                const anyChildHasEstimation = children.some(child => child.estimation !== null && child.estimation > 0);
                
                // 只有当父 Issue 有 Estimation 且至少一个子 Issue 有 Estimation 时才检查
                if (parentEstimation !== null && parentEstimation > 0 && anyChildHasEstimation) {
                    estimationMismatch = parentEstimation !== childrenEstimationSum;
                }
            }
            
            const rowClass = estimationMismatch ? 'estimation-mismatch' : '';
            const safeId = (issue.id || issue.number).toString().replace(/[^a-zA-Z0-9]/g, '_');
            const toggleId = `toggle-${safeId}`;
            
            rows += `
                <tr class="${rowClass}" data-issue-id="${issue.id || issue.number}">
                    <td class="toggle-cell">
                        ${hasChildren ? `<span class="toggle-arrow" onclick="toggleChildren('${toggleId}')" data-toggle="${toggleId}">▶</span>` : ''}
                    </td>
                    <td>${issue.FunctionType || ""}</td>
                    <td><a class="issue-link" href="${issue.url}" target="_blank">${issue.title || ("#" + issue.number)}</a></td>
                    <td class="status-${(issue.state || "unknown").toLowerCase()}">${issue.state || "未知"}</td>
                    <td>${issue.assignees && issue.assignees.length ? issue.assignees.join(", ") : "未分配"}</td>
                    <td><span class="estimation-badge">${issue.estimation !== null ? issue.estimation : "-"}</span></td>
                    <td><span class="team-badge">${issue.team || "未设置"}</span></td>
                    <td><span class="priority-badge priority-${priorityClass(issue.priority)}">${issue.priority || "未设置"}</span></td>
                    <td>${issue.milestone || "未设置"}</td>
                    <td>${issue.updated_at ? new Date(issue.updated_at).toLocaleString() : "未知"}</td>
                </tr>`;
            
            // 添加子 Issue 行（默认隐藏）
            if (hasChildren) {
                children.forEach(child => {
                    rows += `
                        <tr class="child-issue hidden" data-parent="${toggleId}">
                            <td class="toggle-cell"></td>
                            <td class="child-indent">${child.FunctionType || ""}</td>
                            <td class="child-indent"><span class="child-indicator">↳</span> <a class="issue-link" href="${child.url}" target="_blank">${child.title || ("#" + child.number)}</a></td>
                            <td class="status-${(child.state || "unknown").toLowerCase()}">${child.state || "未知"}</td>
                            <td>${child.assignees && child.assignees.length ? child.assignees.join(", ") : "未分配"}</td>
                            <td><span class="estimation-badge">${child.estimation !== null ? child.estimation : "-"}</span></td>
                            <td><span class="team-badge">${child.team || "未设置"}</span></td>
                            <td><span class="priority-badge priority-${priorityClass(child.priority)}">${child.priority || "未设置"}</span></td>
                            <td>${child.milestone || "未设置"}</td>
                            <td>${child.updated_at ? new Date(child.updated_at).toLocaleString() : "未知"}</td>
                        </tr>`;
                });
            }
        });
        
        return rows;
    }
    
    // 构建摘要信息
    let summaryText = `共 ${issues.length} 个 Issue`;
    if (childIssueCount > 0) {
        summaryText += `（顶层 ${topLevelIssues.length} 个，子 Issue ${childIssueCount} 个）`;
    }
    
    c.innerHTML = `
    <div class="issues-summary">
        <span>${summaryText}</span>
        <span>Estimation 总计: <strong>${totalEstimation}</strong></span>
    </div>
    <table class="issues-table" style="margin-bottom:20px;">
        <thead>
            <tr>
                <th style="width: 30px;"></th>
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
        <tbody>
            ${generateRows()}
        </tbody>
    </table>`;
}

/* 切换子 Issue 显示/隐藏 */
window.toggleChildren = function(toggleId) {
    const arrow = document.querySelector(`[data-toggle="${toggleId}"]`);
    const children = document.querySelectorAll(`[data-parent="${toggleId}"]`);
    
    if (!arrow || children.length === 0) return;
    
    const isExpanded = arrow.classList.contains("expanded");
    
    if (isExpanded) {
        arrow.classList.remove("expanded");
        arrow.textContent = "▶";
        children.forEach(child => child.classList.add("hidden"));
    } else {
        arrow.classList.add("expanded");
        arrow.textContent = "▼";
        children.forEach(child => child.classList.remove("hidden"));
    }
};

/* 渲染普通标签 */
function renderLabels(category, container) {
    container.innerHTML = "";
    const colors = category.colors;
    
    const totalCount = Object.values(category.data).reduce((a, b) => a + b, 0);
    
    // 添加 "全部" 标签
    const allLabelTag = document.createElement("div");
    allLabelTag.className = "label-tag";
    allLabelTag.style.borderLeftColor = "#6e7781";
    
    const isAllActive = !filters[category.type];
    if (isAllActive) {
        allLabelTag.classList.add("active");
    }
    
    allLabelTag.innerHTML = `<span class="label-text">全部</span><span class="label-count">${totalCount}</span>`;
    
    allLabelTag.addEventListener("click", () => {
        filters[category.type] = null;
        saveCachedIssues();
        refreshStats();
    });
    
    container.appendChild(allLabelTag);
    
    Object.entries(category.data).forEach(([label, count], idx) => {
        const labelTag = document.createElement("div");
        labelTag.className = "label-tag";
        labelTag.style.borderLeftColor = colors[idx % colors.length];
        
        const isActive = filters[category.type] === label;
        if (isActive) {
            labelTag.classList.add("active");
        }
        
        labelTag.innerHTML = `<span class="label-text">${label}</span><span class="label-count">${count}</span>`;
        
        labelTag.addEventListener("click", () => {
            if (filters[category.type] === label) {
                filters[category.type] = null;
            } else {
                filters[category.type] = label;
            }
            
            saveCachedIssues();
            refreshStats();
        });
        
        container.appendChild(labelTag);
    });
}

/* 渲染分页标签（分配人专用） */
function renderPaginatedLabels(category, container) {
    container.innerHTML = "";
    const colors = category.colors;
    const entries = Object.entries(category.data);
    const totalPages = Math.ceil(entries.length / ASSIGNEE_PAGE_SIZE);
    
    if (assigneePage >= totalPages) {
        assigneePage = Math.max(0, totalPages - 1);
    }
    
    const startIdx = assigneePage * ASSIGNEE_PAGE_SIZE;
    const endIdx = Math.min(startIdx + ASSIGNEE_PAGE_SIZE, entries.length);
    const pageEntries = entries.slice(startIdx, endIdx);
    
    const totalCount = Object.values(category.data).reduce((a, b) => a + b, 0);
    
    // 添加 "全部" 标签
    const allLabelTag = document.createElement("div");
    allLabelTag.className = "label-tag";
    allLabelTag.style.borderLeftColor = "#6e7781";
    
    const isAllActive = !filters[category.type];
    if (isAllActive) {
        allLabelTag.classList.add("active");
    }
    
    allLabelTag.innerHTML = `<span class="label-text">全部</span><span class="label-count">${totalCount}</span>`;
    
    allLabelTag.addEventListener("click", () => {
        filters[category.type] = null;
        saveCachedIssues();
        refreshStats();
    });
    
    container.appendChild(allLabelTag);
    
    // 渲染当前页的标签
    pageEntries.forEach(([label, count], idx) => {
        const globalIdx = startIdx + idx;
        const labelTag = document.createElement("div");
        labelTag.className = "label-tag";
        labelTag.style.borderLeftColor = colors[globalIdx % colors.length];
        
        const isActive = filters[category.type] === label;
        if (isActive) {
            labelTag.classList.add("active");
        }
        
        labelTag.innerHTML = `<span class="label-text">${label}</span><span class="label-count">${count}</span>`;
        
        labelTag.addEventListener("click", () => {
            if (filters[category.type] === label) {
                filters[category.type] = null;
            } else {
                filters[category.type] = label;
            }
            
            saveCachedIssues();
            refreshStats();
        });
        
        container.appendChild(labelTag);
    });
    
    // 添加分页控制
    if (totalPages > 1) {
        const paginationWrapper = document.createElement("div");
        paginationWrapper.className = "pagination-wrapper";
        
        const prevBtn = document.createElement("button");
        prevBtn.className = "pagination-btn";
        prevBtn.innerHTML = "◀";
        prevBtn.disabled = assigneePage === 0;
        prevBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (assigneePage > 0) {
                assigneePage--;
                saveCachedIssues();
                renderPaginatedLabels(category, container);
            }
        });
        
        const pageInfo = document.createElement("span");
        pageInfo.className = "pagination-info";
        pageInfo.textContent = `${assigneePage + 1}/${totalPages}`;
        
        const nextBtn = document.createElement("button");
        nextBtn.className = "pagination-btn";
        nextBtn.innerHTML = "▶";
        nextBtn.disabled = assigneePage >= totalPages - 1;
        nextBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (assigneePage < totalPages - 1) {
                assigneePage++;
                saveCachedIssues();
                renderPaginatedLabels(category, container);
            }
        });
        
        paginationWrapper.appendChild(prevBtn);
        paginationWrapper.appendChild(pageInfo);
        paginationWrapper.appendChild(nextBtn);
        
        container.appendChild(paginationWrapper);
    }
}

