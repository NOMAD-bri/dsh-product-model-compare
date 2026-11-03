# 本地 3D 工作台 · DSH 插件

给 DeepSeek Harness 侧栏用的本地三维查看与测量工作台。打开本机的 STEP / STP / STL / OBJ / 模型 JSON，单模型查看或双模型对比，不需要产品资料库、不上传模型、不修改原始文件。

> 插件不包含任何产品库、参数保存或云端同步功能。它只做一件事：把你电脑上的模型文件看清楚、量出来。

## 功能

| 区域 | 能力 |
| --- | --- |
| 顶部 | 打开本地文件、搜索本机 STEP 列表、下拉选择模型、刷新列表 |
| 左侧工具条 | 旋转、部件尺寸、两点距离、三点角度、当前姿态尺寸、摆正模型 |
| 中央视窗 | 自适应取景、前 / 顶 / 侧 / 等轴视角、蓝色实体高亮选中部件 |
| 右侧属性面板 | 选中部件名称与 X / Y / Z 尺寸、操作按钮、测量记录 |
| 工作区 | 单模型 / 双模型对比，两侧各自记忆模型与视角 |
| 恢复 | 重新进入或重启后自动恢复上次的模型、视角、姿态、孤立部件与测量 |

其他行为：

- 「摆正模型」点选一个平面，把该面法线对齐到 Z 轴；「恢复原始姿态」可撤销。
- 「单独查看部件」只显示选中部件，可单独摆正和测量；「返回整机」复原。
- 「清除测量」只清标记；「清除模型」只清当前视窗与该侧缓存，**不会删除磁盘上的原文件**。
- 双模型模式下左右两侧使用独立缓存，互不覆盖。

## 环境要求

- DeepSeek Harness，且支持安装本地 bundle 插件。
- Node.js 20 以上（扫描脚本与插件 Host 使用）。
- **只有 STEP / STP 需要 Python**：Python 3.10+ 与 `OCP`（OpenCascade 绑定，推荐 `pip install cadquery-ocp`）。
- STL、OBJ、模型 JSON 在前端直接解析，不需要 Python。

## 安装

在 Harness 里以本地目录安装 bundle，或在支持插件的界面里选择这个目录：

```
<仓库目录>            # 含 package.json / cordis.patch.yml / index.js / client.js
```

安装后侧栏出现「本地3D工作台」。

## 首次配置

1. **生成本地模型索引**（模型下拉列表读取它）：

   ```bash
   node scripts/scan-models.mjs
   ```

   默认扫描所有固定磁盘，索引写到 `~/.product-model-compare/step-index.json`。
   只扫描指定目录、或换输出位置：

   ```bash
   node scripts/scan-models.mjs --root "D:\CAD" --root "E:\Models"
   node scripts/scan-models.mjs --root "D:\CAD" --out "D:\my-step-index.json"
   ```

2. **STEP 解析环境**（仅当你的 Python 不是 PATH 上的 `python`，或 OCP 装在别处）：

   | 环境变量 | 作用 |
   | --- | --- |
   | `PRODUCT_VIEWER_PYTHON` | Python 解释器完整路径 |
   | `PRODUCT_MODEL_OCP_PATH` | 含 `OCP` 包的目录，多个用 `;`（Windows）或 `:`（macOS/Linux）分隔 |
   | `PRODUCT_MODEL_INDEX` | 索引文件路径，覆盖默认的 `~/.product-model-compare/step-index.json` |

   设置后重启 Harness 让 Host 进程读到新环境变量。

3. 打开侧栏 → 选择模型（或直接「打开本地模型」）。第一次打开后，之后会自动恢复。

## 隐私与本地数据

- 模型文件只在本机读取，**不上传**，也不复制进资料库。
- 视窗状态（模型网格、视角、姿态、测量）保存在浏览器 **IndexedDB**（`dsh-local-model-viewer`），用于下次自动恢复；点「清除模型」会同时删除该侧缓存。
- 模型索引只记录文件路径，保存在 `~/.product-model-compare/step-index.json`。
- STEP 解析使用一次性临时目录，请求结束即删除。

## 已知限制

- 尺寸、距离、角度都基于**三角网格**计算，属于近似值；不是精确 B-Rep 测量，也**不包含壁厚测量**。
- 姿态尺寸是显示网格在世界轴向的外形包围盒，随摆正/孤立而变，不等同于 CAD 的精确外形。
- STEP 的三角化容差为线性 0.8、角度 0.35；极大装配体可能较慢或占用较多内存。
- 摆正需要点选平面；点到圆管曲面上的单个三角面得到的基准不可靠。
- 原文件在外部被修改后，缓存里的旧网格不会自动更新，需要重新选择该文件打开。
- 目前没有部件树、剖切、爆炸图、模型对比差值。

## 项目结构

```
index.js            Host 半：本地索引、文件读取、STEP 解析子进程、静态资源下发
client.js           Client 半：注册侧栏入口与主面板、单/双模型外壳
local-viewer.js     查看器：Shadow DOM 界面 + three.js 场景、工具与测量、本地恢复
parse-step.py       STEP → 三角网格（子进程，需 OCP）
vendor/             three.js r170 + OrbitControls（随包分发，无需外部依赖）
scripts/scan-models.mjs     生成本地 STEP 索引
scripts/pack.ps1            生成可分发 zip
scripts/publish-github.mjs  无需本地 git 的发布脚本
test/api.test.mjs   Host 接口测试
UI-ARCHITECTURE.md  分区与扩展约定
legacy/            早期「完整工作台」实验代码，不参与打包
```

## 开发

```bash
node --check index.js client.js local-viewer.js
node test/api.test.mjs
node scripts/scan-models.mjs --root "D:\CAD"
```

打包成可分发 zip：

```powershell
powershell -File scripts/pack.ps1
```

发布到 GitHub（不需要本机安装 git，走 REST API 单次提交）：

```bash
node scripts/publish-github.mjs --dry-run    # 先看会提交哪些文件
GITHUB_TOKEN=... node scripts/publish-github.mjs
```

token 也可以写到仓库上一级的 `.gh-token`（已被忽略）。需要的权限：`Administration: Read and write`（建仓）与 `Contents: Read and write`（推送）。

## 参与贡献

欢迎 issue 与 PR。改动界面或新增工具前，先读 `UI-ARCHITECTURE.md` 的分区约定，避免又把功能堆回顶部工具栏。提交前请确保 `node --check` 与 `node test/api.test.mjs` 通过。

## License

[MIT](./LICENSE) · 第三方组件许可见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)
