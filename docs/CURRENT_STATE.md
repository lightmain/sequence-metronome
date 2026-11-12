# 当前项目状态

更新：2026-11-13

## 结论

- 项目当前为 **V5 已完成**：音频 SHA-256 绑定、多音频关联、按 SHA 保存对齐参数、对齐完成后的 BPM 写回均已实现。
- `main` 已包含 V5 并推送；Pages 由现有 GitHub Actions 构建部署，本地未检查 Actions 运行结果。
- 当前没有 V6 计划或已确认的 V6 范围。开始 V6 前应先确认目标和交互细节，不要把历史计划里的“后续版本”直接当成需求。
- 发生冲突时，以本文件、`README.md` 的当前说明和 `docs/plans/V5_PLAN.md` 的实施记录为准；V1–V4 计划是历史记录，不代表当前行为。

## 技术与运行

- React 19 + TypeScript + Vite，pnpm；Vitest 单元测试，Playwright 浏览器回归。
- 纯前端，无后端；线上为 GitHub Pages 静态文件。
- 普通节拍器与变拍序列节拍器；序列支持多曲目标签、段落/注释、撤销重做、文本/JSON 导入导出和浏览器本地保存。
- 音频为 WAV/MP3，保存在 IndexedDB；播放、对齐、预备节拍和 WAV/MP3 合成均已实现。

## 当前数据格式（V5）

- 音频身份是**原始文件字节的 SHA-256**（64 位小写十六进制），不是文件名、不是音乐内容指纹；重新编码或修改任何字节都会产生新 SHA。
- 一个序列可关联多份音频，同一时间只有一份 `activeSha`。音频引用、IndexedDB 键和对齐映射都以 SHA 为键。
- 曲目 JSON：空曲目仍为 `version: 1`；带音乐参数为 `version: 3`，包含 `music.audios`、`music.alignments`、`activeSha`、`countIn`、`volume`。JSON 不包含音频二进制。
- TXT 对齐行六项必填：

  ```text
  Alignment:{SHA:<64 位十六进制>, bpm:120, start:250, countin:2, countin_bpm:120, countin_time:4/4}
  ```

- `start` 是首拍毫秒数；`countin`、`countin_bpm`、`countin_time` 是预备节拍快照。对齐确认时参考 BPM 写入预备节拍 BPM 和第一段 BPM，拍号不变。
- 本地曲目库：`localStorage` 键 `metronome.workspace.v2`，文档版本 4；IndexedDB 数据库 `metronome.audio.v2`。
- **不保留旧格式兼容**：升级时清空旧 `localStorage` 曲目库和旧 IndexedDB 数据库；旧 `Aligned`、version 1/2 音乐字段和旧 TXT/JSON 会被拒绝。升级或回退前应导出文本/JSON 并保留原音频文件。
- 删除音频只移除音频引用，保留对齐映射；重新选择相同 SHA 会沿用对齐。

## 验证状态

- `pnpm check`：格式、ESLint、TypeScript、单元测试和生产构建通过；当前 131 项单元测试。
- `pnpm test:e2e`：26 项浏览器回归通过，1 项三分钟规模测试默认跳过。
- 浏览器测试模拟扬声器输出，并使用真实服务器文件、真实 WAV/MP3 解码；**不代表实体扬声器声音和系统延迟已验收**。
- 三分钟、44.1 kHz、双声道 WAV 规模实测在 V4 通过；V5 的该项测试默认跳过，未在 V5 重跑。更长音频的内存和耗时仍待实测。

## 已知限制与候选方向

- 实体声音试听尚未由自动测试覆盖；人工验收仍建议使用熟悉的恒速音乐和真实输出设备。
- 手机适配、锁屏播放、分组重音、循环练习仍在 README 的后续方向中，未确认进入 V6。
- 更长音频的 SHA 和内存开销未设硬上限；手机端和低内存环境待验证。
- V5 是破坏性格式升级；从 V4/V3 回退不能直接读取 V5 保存。

## 文档入口

- [README](../README.md)：使用说明、功能、快捷键、构建与部署。
- [AGENTS](../AGENTS.md)：仓库的界面、行为和工程约定。
- [V5 计划](plans/V5_PLAN.md)：当前数据模型、对齐规则和实施记录。
- [V4 计划](plans/V4_PLAN.md)、[V3 计划](plans/V3_PLAN.md)、[V2 计划](plans/V2_PLAN.md)、[V1 开发计划](plans/DEVELOPMENT_PLAN.md)：历史记录。
- [第三方声明](THIRD_PARTY_NOTICES.md)：MP3 编码器和音效许可。

## 新对话建议阅读顺序

1. 本文件。
2. `AGENTS.md`。
3. `README.md` 的“音乐与对齐”“文本格式”“本地保存”“检查与构建”。
4. 需要改 V5 数据或对齐逻辑时，再读 `docs/plans/V5_PLAN.md`。
