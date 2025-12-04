# GitHub Issue 项目跟踪器

一个本地运行的 Web 应用，用于从文本中提取 GitHub issue 并获取相关的项目信息。

## 功能特点

- 从粘贴的文本中自动提取 GitHub issue 链接
- 获取 issue 的基本信息（标题、状态、创建时间等）
- 获取 issue 关联的 GitHub Projects 信息
- 显示项目中的自定义字段值

## 使用方法

1. 在 GitHub 上生成 Personal Access Token：
   - 访问 https://github.com/settings/tokens
   - 生成新 token，选择 `repo` 和 `read:project` 权限

2. 打开 `index.html` 文件在浏览器中运行

3. 在配置部分输入你的 GitHub token

4. 在文本区域粘贴包含 GitHub issue 链接的文本

5. 点击"提取 Issue"按钮

## 技术说明

- 使用 GitHub REST API 获取 issue 信息
- 使用 GitHub GraphQL API 获取项目信息
- 纯前端实现，数据不会发送到第三方服务器

## 注意事项

- 确保你的 token 有足够的权限访问相关仓库和项目
- 应用完全在本地运行，token 只存储在浏览器本地存储中