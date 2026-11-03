# 第三方组件与许可

本仓库自身以 MIT 许可发布（见 [LICENSE](./LICENSE)）。以下组件随附或作为运行前提，遵循各自的许可。

## 随仓库分发

### three.js

- 位置：`vendor/three.module.js`、`vendor/OrbitControls.js`
- 版本：r170
- 许可：MIT
- 版权：Copyright © 2010-2024 three.js authors
- 项目主页：https://github.com/mrdoob/three.js

## 不随仓库分发（可选运行前提）

### OpenCascade / OCP

- 用途：仅 `parse-step.py` 解析 STEP 时使用
- 是否随包分发：**否**
- 安装方式：`pip install cadquery-ocp`
- 许可：Open CASCADE Technology 采用 LGPL-2.1（含例外条款）；OCP 绑定遵循其自身许可
- 项目主页：https://dev.opencascade.org/ 、https://github.com/CadQuery/OCP

用户需自行安装并遵守其许可条款。本仓库不包含 OCCT 二进制或源码。

## 运行环境

- Node.js（MIT 及各类许可）
- Python 3（PSF License）
- DeepSeek Harness（其自身许可）
