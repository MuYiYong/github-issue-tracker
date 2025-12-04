# GitHub Issue Tracker

一个基于 GitHub Project V2 API 的 Issue 追踪和统计工具，帮助团队可视化管理项目进度。

## ✨ 功能特性

### 📊 数据统计
- **状态统计** - 按 Issue 状态（Todo、In Progress、Done 等）分类统计
- **优先级统计** - 按优先级（P0、P1、P2、P3）分类统计
- **里程碑统计** - 按里程碑分组查看 Issue 分布
- **工作量统计** - 按 Team 统计 Estimation 工作量总和
- **分配人统计** - 查看每个成员负责的 Issue 数量（支持分页）

### 🔍 多条件过滤
- 支持按状态、优先级、里程碑、分配人、Team 进行过滤
- 支持按是否设置工作量（Estimation）过滤
- 多条件组合过滤（AND 逻辑）
- 点击图表或标签即可快速筛选
- 一键清除所有过滤条件

### 🔗 父子 Issue 关系
- 自动获取 GitHub Sub-Issues 父子关系
- 子 Issue 折叠显示在父 Issue 下方
- 点击箭头展开/收起子 Issue
- 父子 Issue Estimation 不匹配时高亮提示
- 统计时自动排除已有父 Issue 的子 Issue，避免重复计算

### 📋 Issue 列表
- 按 FunctionType 排序展示
- 显示 Issue 标题、状态、分配人、Estimation、Team、优先级、里程碑等
- 点击 Issue 标题直接跳转 GitHub
- 显示 Estimation 总计

### 💾 数据缓存
- 本地缓存 Issue 数据，刷新页面无需重新拉取
- 显示上次更新时间
- 手动点击"拉取并刷新"更新数据

### 📈 加载进度
- 实时显示数据拉取进度
- 分阶段显示：获取 Issue → 处理数据 → 获取父子关系
- 显示已获取数量和总数

## 🚀 快速开始

### 1. 配置 GitHub Token

1. 访问 [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. 点击 "Generate new token (classic)"
3. 选择以下权限：
   - `repo` - 完整的仓库访问权限
   - `read:org` - 读取组织信息
   - `read:project` - 读取项目信息
4. 生成 Token 并复制
5. 在工具的"配置"页面粘贴并保存 Token

### 2. 获取项目列表

1. 切换到"配置"页面
2. 点击"获取项目列表"按钮
3. 系统会自动获取您有权限访问的所有 GitHub Projects

### 3. 查看统计

1. 切换到"统计"页面
2. 从下拉菜单选择一个项目
3. 点击"拉取并刷新"按钮
4. 等待数据加载完成，即可查看统计图表和 Issue 列表

## 📁 项目结构

```
github-issue-tracker/
├── index.html      # 主页面
├── style.css       # 样式文件
├── script.js       # 主逻辑
└── README.md       # 说明文档
```

## 🔧 支持的 Project 字段

工具会自动读取以下 GitHub Project 字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| Status | Single Select | Issue 状态 |
| Priority | Single Select | 优先级（P0/P1/P2/P3） |
| Estimation | Number | 工作量估算 |
| Team | Single Select | 所属团队 |
| FunctionType | Text | 功能类型 |

## 🎨 界面预览

### 统计图表
- 5 个环形图展示不同维度的统计
- 点击图表或标签可快速过滤
- 工作量图表显示各 Team 的 Estimation 总和

### Issue 列表
- 表格形式展示所有 Issue
- 支持父子 Issue 折叠展示
- 父子 Estimation 不匹配时行背景高亮

## ⚠️ 注意事项

1. **Token 安全** - Token 存储在浏览器 localStorage 中，请勿在公共电脑上使用
2. **API 限制** - GitHub API 有速率限制，大型项目可能需要等待
3. **Sub-Issues** - 父子关系功能需要 GitHub 的 Sub-Issues 预览特性支持
4. **已关闭 Issue** - 工具会自动过滤已关闭的 Issue

## 🛠️ 技术栈

- 原生 HTML/CSS/JavaScript
- [Chart.js](https://www.chartjs.org/) - 图表渲染
- GitHub GraphQL API - 数据获取

## 📝 更新日志

### v1.2.0
- ✨ 新增父子 Issue 关系支持
- ✨ 新增实时加载进度显示
- ✨ 统计时排除子 Issue 避免重复计算
- 🎨 优化导航栏样式
- 🐛 修复多项 Bug

### v1.1.0
- ✨ 新增 Team 工作量统计
- ✨ 新增多条件组合过滤
- ✨ 新增分配人分页显示

### v1.0.0
- 🎉 初始版本发布
- ✨ 基础统计功能
- ✨ Issue 列表展示