# GitHub Issue Tracker

一个轻量级的 GitHub Project Issue 追踪和统计工具，支持从 GitHub Project V2 拉取 Issue 数据，提供可视化统计和多维度过滤功能。

## ✨ 功能特性

### 数据获取
- 🔐 安全的 Token 管理（本地存储）
- 📦 自动获取用户和组织的 GitHub Projects
- 🚀 优化的 GraphQL 批量请求，快速拉取大量 Issue
- 💾 本地缓存，无需重复请求
- ⏹️ 支持请求取消，避免重复请求

### 统计分析
- 📊 多维度饼图统计：状态、优先级、里程碑、工作量、分配人
- 👥 分配人支持多人分配统计（一个 Issue 分配多人时，每人都计入）
- 📈 工作量（Estimation）按 Team 汇总
- 🎯 智能排除子 Issue 避免重复统计

### 过滤功能
- 🔍 支持多条件 AND 过滤
- 🏷️ 点击图表或标签快速过滤
- 🔄 一键清除所有过滤条件
- 📄 分页显示分配人列表

### Issue 列表
- 📋 支持父子 Issue 层级展示
- 🔽 可折叠/展开子 Issue
- ↳ 孤立子 Issue（父 Issue 不在列表中）特殊标识
- ⚠️ 父子 Estimation 不匹配提醒
- 🔢 智能排序：FunctionType → 优先级 → 更新时间

## 🛠️ 技术栈

- **前端**: 原生 JavaScript (ES6+)
- **图表**: Chart.js
- **API**: GitHub GraphQL API v4
- **存储**: LocalStorage

## 📦 安装使用

### 1. 克隆项目

```bash
git clone https://github.com/your-username/github-issue-tracker.git
cd github-issue-tracker
```

### 2. 启动本地服务器

```bash
# 使用 Python
python3 -m http.server 8080

# 或使用 Node.js
npx serve .

# 或使用 VS Code Live Server 插件
```

### 3. 配置 GitHub Token

1. 访问 [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. 生成新 Token，需要以下权限：
   - `repo` - 访问仓库
   - `read:org` - 读取组织信息
   - `project` - 访问 Project V2
3. 在应用的「配置」页面输入 Token

## 📁 项目结构

```
github-issue-tracker/
├── index.html      # 主页面
├── style.css       # 样式文件
├── script.js       # 核心逻辑
└── README.md       # 说明文档
```

## 🔧 配置项

在 `script.js` 中可调整以下常量：

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `PAGE_SIZE` | 100 | 每次请求获取的 Issue 数量 |
| `ASSIGNEE_PAGE_SIZE` | 10 | 分配人标签每页显示数量 |
| `MAX_CONCURRENT` | 6 | 最大并发请求数（预留） |

## 📊 支持的 Project 字段

| 字段名 | 类型 | 用途 |
|--------|------|------|
| Status | Single Select | Issue 状态 |
| Priority | Single Select | 优先级（P0/P1/P2/P3） |
| Estimation | Number | 工作量估算 |
| Team | Single Select | 所属团队 |
| FunctionType | Single Select | 功能类型 |

## 🎯 过滤逻辑

### 普通过滤
- 点击标签切换过滤状态
- 再次点击取消过滤
- 点击「全部」清除该维度过滤

### 工作量过滤
- 点击具体 Team：过滤该 Team + 只显示有工作量的 Issue
- 点击「未设置」：只显示无工作量的 Issue
- 点击「全部」：清除工作量相关过滤

### 多条件过滤
- 所有过滤条件为 AND 关系
- 顶部显示当前激活的过滤条件
- 支持一键清除全部过滤

## 📈 统计说明

### 子 Issue 处理
- **统计时**：排除父 Issue 在列表中的子 Issue，避免重复计算
- **列表显示**：
  - 父 Issue 在列表中 → 子 Issue 折叠显示
  - 父 Issue 不在列表中 → 子 Issue 作为「孤立子 Issue」独立显示（带缩进标识）

### 分配人统计
- 一个 Issue 分配给多人时，每个人都计入统计
- 未分配的 Issue 计入「未分配」类别

## 🔒 数据安全

- Token 仅存储在浏览器 LocalStorage
- 所有请求直接发往 GitHub API
- 无任何第三方服务器参与

## 📝 更新日志

### v0.3.0
- ✨ 新增孤立子 Issue 显示支持
- ✨ 新增多分配人统计
- ⚡ 优化 escapeHtml 性能
- 🐛 修复标签点击过滤失效问题
- 🐛 修复分页状态未重置问题

### v0.2.0
- ✨ 新增请求取消功能
- ✨ 新增全局错误处理
- ⚡ 优化 GraphQL 查询压缩
- ⚡ 优化 DOM 缓存策略

### v0.1.0
- 🎉 初始版本发布

## 📄 License

MIT License