# V5 音频哈希与对齐映射计划

状态：已完成（2026-11-13，用户确认）。本地自动验收通过；音频输出使用模拟设备，实体声音未由自动测试覆盖。当前项目状态见 [CURRENT_STATE.md](../CURRENT_STATE.md)。V5 允许一个序列关联多份音频，并用音频内容哈希作为对齐参数的键。按用户说明，不保留旧 TXT/JSON/本地存储兼容。

## 实施记录（2026-11-13）

- 使用浏览器 WebCrypto 对原文件字节计算 SHA-256；音频引用、IndexedDB 键和对齐映射均使用 SHA。
- 曲目支持多份音频和 `activeSha`；空曲目仍为 version 1，带音乐参数的曲目为 version 3。
- TXT 改为六字段 `Alignment:{...}`，JSON 使用 `audios`、`alignments`、`activeSha` 映射；旧的 `Aligned`、version 1/2 音乐字段和旧本地数据不再读取。
- 对齐确认写入当前 SHA，并把参考 BPM 写入预备节拍 BPM 和第一段 BPM；拍号不变。切换 SHA 时恢复其预备节拍快照并更新第一段 BPM；修改预备节拍时同步当前 SHA 快照。
- 删除音频保留对齐映射；重新选择相同 SHA 的文件会沿用对齐。
- 本地曲目库使用新键和文档版本 4，IndexedDB 使用 v2；启动时清除旧键和旧数据库。
- 在 Windows、Node.js 24、pnpm 11 下验证：`pnpm check` 通过（131 项单元测试及生产构建）；`pnpm test:e2e` 通过（26 项浏览器回归，1 项规模测试默认跳过）。音频输出使用模拟设备，尚未进行实体声音试听。
- 实现中新发现并修正的问题：当前音频文件缺失时重新选择同一 SHA 的文件，原逻辑因 `activeSha` 未变化而不重新加载；现在 `stage` 在 SHA 与当前音频相同时直接恢复缓冲。
- 实现中新发现并修正的问题：确认对齐时第二步试听可能仍在播放，`sequenceLocked` 会阻止曲目提交，导致点击确定后仍显示未对齐；确认路径现在停止声音并强制提交一次曲目修改。
- 2026-11-13 用户确认 V5 完成。

## 1. 结论与哈希选择

采用 **SHA-256（小写十六进制，64 个字符）** 标识音频文件内容。它由浏览器原生 `crypto.subtle.digest` 计算，无需第三方依赖，足以把对齐参数绑定到具体文件字节。

不建议的替代方案：

- 截短 SHA、文件大小加首尾字节：文本更短，但无法满足“唯一对应”的要求。
- UUID 或递增 ID：只能标识一次导入，不能识别重新选择的同一份录音。
- BLAKE3：速度更快，但需要额外依赖；当前音频规模下 SHA-256 已足够。
- 如需进一步缩短文本，可用 SHA-256 的 base64url 形式（43 字符），但不如十六进制便于人工核对。

哈希对象是**原始文件字节**。因此改文件名、移动目录不影响 SHA；重新编码、修改 ID3 标签或任何字节变化都会产生新 SHA，旧 SHA 的对齐不会自动沿用。这是文件身份，不是音乐内容指纹。

## 2. 数据模型

`Music` 由单音频改为音频集合与 SHA 对齐映射：

```ts
type Sha256 = string; // 64 位小写十六进制

type AudioReference = {
  sha256: Sha256;
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

type Alignment = {
  bpm: number; // 参考 BPM，允许手动小数
  start: number; // 首拍时间，毫秒，允许负数
  countin: number; // 预备小节数
  countin_bpm: number; // 预备节拍 BPM
  countin_time: string; // 预备节拍拍号，如 "4/4"
};

type Music = {
  audios: Record<Sha256, AudioReference>;
  alignments: Record<Sha256, Alignment>;
  activeSha?: Sha256;
  countIn?: CountIn; // 序列当前的预备节拍，界面和播放使用
  volume?: number; // 序列级音频音量
};
```

- 对齐映射的六个字段是 SHA、bpm、start、countin、countin_bpm、countin_time。SHA 在 TXT 中平铺为字段，在 JSON 中是映射键。
- 六项均必填。`countin` 可以为 0，但 `countin`、`countin_bpm`、`countin_time` 仍必须出现。
- `countin` 是非负整数；`countin_bpm` 是有限正数；`countin_time` 是合法拍号字符串，例如 `4/4`、`3/8`，分母沿用现有允许集合。
- 音频二进制仍放在 IndexedDB，键改为 SHA，不再用随机 `id`；相同 SHA 的字节只存一份。
- `name`、`size`、`type`、`lastModified` 仅用于显示，不参与身份判断。
- `activeSha` 指定当前用于播放、对齐和合成的那一份音频。
- 序列继续保存 `countIn` 和 `volume`。`Alignment` 里的三项预备节拍字段是该 SHA 对齐时的快照；它与序列 `countIn` 的同步规则见第 5 节。

## 3. TXT 格式

在段落之前使用一条或多条对齐声明，每个 SHA 一行：

```text
Alignment:{SHA:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08, bpm:120, start:250, countin:2, countin_bpm:120, countin_time:4/4}
Alignment:{SHA:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae, bpm:98.5, start:-12.5, countin:0, countin_bpm:98.5, countin_time:6/8}
1 4/4 120
3 3/8 60
5
```

- 字段名固定为 `SHA`、`bpm`、`start`、`countin`、`countin_bpm`、`countin_time`。
- 解析时逗号后的空格可有可无；导出时统一为每个逗号后一个空格，例如上面的示例。
- SHA 必须为 64 位十六进制；大小写统一为小写。
- `bpm`、`countin_bpm` 必须为有限正数；`start` 允许负数；`countin` 必须为非负整数。
- `countin_time` 为 `分子/分母` 字符串，例如 `4/4`、`6/8`；无效拍号报错。
- 同一 SHA 重复出现、六项中任一项缺失、出现多余字段、数值非法、SHA 非法，均报告带行号的解析错误。
- `Alignment` 行必须位于首个段落或注释之前；导出时按 SHA 排序，保证文本稳定。
- 不再支持 `Aligned 133` 行。旧文本会得到明确的格式错误，而不是静默忽略。
- TXT 不记录文件名，只记录 SHA 和六项参数；导入后可以没有音频，等用户关联文件时按 SHA 匹配。

## 4. JSON 格式

曲目 JSON 升级为 `version: 3`。音频元数据和对齐参数都用 SHA 作为键：

```json
{
  "version": 3,
  "title": "曲目",
  "music": {
    "audios": {
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08": {
        "name": "录音.mp3",
        "size": 3812345,
        "type": "audio/mpeg",
        "lastModified": 1760000000000
      }
    },
    "alignments": {
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08": {
        "bpm": 120,
        "start": 250,
        "countin": 2,
        "countin_bpm": 120,
        "countin_time": "4/4"
      }
    },
    "activeSha": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "countIn": { "bars": 2, "meter": [4, 4], "bpm": 120 },
    "volume": 0.65
  }
}
```

- 对齐对象的 SHA 由映射键表示，其余五项必须齐全；等价于 TXT 的六项。
- JSON 不包含音频二进制；跨浏览器迁移仍需重新选择文件。
- 导入时 `audios` 可以只有元数据没有文件；只要 SHA 匹配，导入 `alignments` 的参数即可沿用。
- 如果同一 SHA 出现在多处，以同一对象去重。
- 本地曲目库外层版本升到 4，IndexedDB 数据库升到 v2；版本升级时清空旧 `localStorage` 曲目库和旧 IndexedDB 数据库，不迁移任何旧数据。
- 不再读取 `version: 1`、`version: 2` 的旧音乐字段；旧文件直接拒绝并提示重新导出。

## 5. 关联、替换与对齐行为

- 选择音频时先计算 SHA，再解码：
  - 该 SHA 已在 `audios` 中：复用已有音频和对齐，只更新显示用元数据，不新增条目。
  - 该 SHA 不在 `audios` 中但已在 `alignments` 中：加入音频并自动显示为已对齐。
  - 新 SHA：加入音频，状态为未对齐。
- 原“关联原音频/替换音频”的元数据核对被 SHA 取代，不再比较文件名、大小和修改时间；当前界面使用“添加音频”“移除当前”和“当前音频”。
- 多个音频是同一序列的不同整段录音，同一时间只使用 `activeSha` 指定的一份。已确认不做同时播放的多轨模型。
- 删除音频只从 `audios` 移除；`alignments` 中对应条目保留，便于以后重新关联，TXT/JSON 也继续导出这些条目。已确认。
- 对齐确认时写入 `alignments[activeSha]`，重新对齐覆盖同一个 SHA 的参数。

### 对齐完成后的序列更新

对齐确认时，以本次确认的参考 BPM 同时更新：

1. 序列预备节拍的 BPM（`music.countIn.bpm`）。
2. 序列第一个正式段落的 BPM（若存在）。注释行不算段落；只有注释或没有段落时不改。
3. 两项拍号都不修改：预备节拍拍号和第一段拍号保持原值。
4. 写入该 SHA 的对齐快照，其中 `bpm` 为参考 BPM，`countin`、`countin_bpm`、`countin_time` 取自更新后的序列预备节拍。

这次更新应与对齐参数写入作为同一次可撤销的曲目修改，标记未保存，并使旧合成结果失效。若参考 BPM 是手动输入的小数，写入序列的也是同一个小数。

### 预备节拍快照与切换

序列界面上只有一份 `countIn`，但每个 SHA 的对齐条目各保存一份预备节拍快照。规则已确认：

- 切换到某个带对齐的 `activeSha` 时，用该 SHA 的快照恢复序列 `countIn` 的三项，并按该 SHA 的 `bpm` 更新第一段 BPM。
- 用户之后修改序列预备节拍时，同步写回当前 `activeSha` 的快照；其他 SHA 的快照不动。
- 没有 `activeSha` 或该 SHA 没有对齐时，序列 `countIn` 只作为序列设置，不写入对齐映射。

## 6. 计算与性能

- 使用 `file.arrayBuffer()` 加 `crypto.subtle.digest('SHA-256', buffer)`，转十六进制。
- 读取一次 ArrayBuffer，可同时用于哈希和解码，避免重复读文件。
- 计算期间显示“正在计算音频哈希/读取音频”，并禁用关联、对齐和合成操作。
- 三分钟 WAV 预计一秒内完成；更长文件需要实测内存与耗时。SHA-256 需要把整个文件读入内存，这是当前简单方案的已知限制。
- 可在文件选择后暂存 SHA，避免每次保存或切换都重新计算；文件字节变化时重新计算。

## 7. 测试与实施顺序

1. 哈希工具及已知文件测试：同字节同 SHA，改名不变，改一个字节变化。
2. `Music` 类型、验证、JSON 读写、TXT 多 `Alignment` 行、六项必填及错误定位。
3. 音频集合、SHA 去重、IndexedDB 以 SHA 为键、重新关联和自动套用对齐。
4. 单活跃音频的播放、对齐、合成、删除和切换。
5. 对齐完成后的 BPM 写回：预备节拍 BPM、第一段 BPM、两项拍号不变、无段落分支、撤销与合成结果失效。
6. 切换 SHA 时应用预备节拍快照和第一段 BPM；修改预备节拍时同步当前 SHA 快照。
7. 旧 localStorage 与旧 IndexedDB 清空、旧文件拒绝；更新 UI 文案与 README。
8. `pnpm check` 与 `test:e2e`；实体声音试听不由自动测试覆盖，若进行人工验收再单独执行。

## 8. 已确认决定

- 多音频是不同整段录音，同一时间只有一个活跃音频。
- SHA-256 哈希原始文件字节。
- 删除音频后保留对齐映射。
- 预备节拍和音量按序列保存；对齐条目同时保存三项预备节拍快照，六项必填。
- `countin_time` 就是拍号字符串，例如 `4/4`、`6/8`。
- 对齐完成后按参考 BPM 更新预备节拍 BPM 和第一段 BPM，不修改拍号。
- 切换到带对齐的 SHA 时，按其快照恢复序列预备节拍并更新第一段 BPM。
- 用户之后修改预备节拍时，同步回写当前 SHA 的快照。
- TXT 解析时逗号后的空格可有可无；自动导出带一个空格。
- 版本升级时清空旧 `localStorage` 和旧 IndexedDB；旧导出文件拒绝导入。
