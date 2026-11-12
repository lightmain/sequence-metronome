# V5 音频哈希与对齐映射计划

状态：草案（2026-11-12），待确认，未实施。V5 允许一个序列关联多份音频，并用音频内容哈希作为对齐参数的键。按用户说明，不保留旧 TXT/JSON/本地存储兼容。

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
  referenceBpm: number; // 必填，允许手动小数
  firstBeatMs: number; // 必填，毫秒
};

type Music = {
  audios: Record<Sha256, AudioReference>;
  alignments: Record<Sha256, Alignment>;
  activeSha?: Sha256;
  countIn?: CountIn;
  volume?: number;
};
```

- 音频二进制仍放在 IndexedDB，键改为 SHA，不再用随机 `id`；相同 SHA 的字节只存一份。
- `name`、`size`、`type`、`lastModified` 仅用于显示，不参与身份判断。
- `activeSha` 指定当前用于播放、对齐和合成的那一份音频。
- `countIn` 和 `volume` 暂按序列保存；如果不同音频需要不同预备节拍或音量，需要改成按 SHA 保存。

## 3. TXT 格式

在段落之前使用一条或多条对齐声明，每个 SHA 一行：

```text
Alignment:{SHA:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08, bpm:120, start:250}
Alignment:{SHA:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae, bpm:98.5, start:-12.5}
1 4/4 120
3 3/8 60
5
```

- 键为 `SHA`、`bpm`、`start`；`bpm` 是参考 BPM，`start` 是首拍时间（毫秒）。
- SHA 必须为 64 位十六进制；大小写统一为小写。
- `bpm` 必须为有限正数；`start` 允许负数。
- 同一 SHA 重复出现、字段缺失或多余、数值非法、SHA 非法，均报告带行号的解析错误。
- `Alignment` 行必须位于首个段落或注释之前；导出时按 SHA 排序，保证文本稳定。
- 不再支持 `Aligned 133` 行。旧文本会得到明确的格式错误，而不是静默忽略。
- TXT 不记录文件名，只记录 SHA 和对齐参数；导入后可以没有音频，等用户关联文件时按 SHA 匹配。

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
        "referenceBpm": 120,
        "firstBeatMs": 250
      }
    },
    "activeSha": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "countIn": { "bars": 0, "meter": [4, 4], "bpm": 120 },
    "volume": 0.65
  }
}
```

- JSON 不包含音频二进制；跨浏览器迁移仍需重新选择文件。
- 导入时 `audios` 可以只有元数据没有文件；只要 SHA 匹配，导入 `alignments` 的参数即可沿用。
- 如果同一 SHA 出现在多处，以同一对象去重。
- 本地曲目库外层版本升到 4，IndexedDB 数据库升到 v2；不读取旧版本，避免把旧单音频结构误当新结构。
- 不再读取 `version: 1`、`version: 2` 的旧音乐字段；旧文件直接拒绝并提示重新导出。

## 5. 关联、替换与对齐行为

- 选择音频时先计算 SHA，再解码：
  - 该 SHA 已在 `audios` 中：复用已有音频和对齐，只更新显示用元数据，不新增条目。
  - 该 SHA 不在 `audios` 中但已在 `alignments` 中：加入音频并自动显示为已对齐。
  - 新 SHA：加入音频，状态为未对齐。
- 当前“关联原音频/替换音频”的元数据核对被 SHA 取代，不再比较文件名、大小和修改时间。
- 对齐确认时写入 `alignments[activeSha]`，重新对齐覆盖同一个 SHA 的参数。
- 切换 `activeSha` 时，播放器、对齐入口和合成都切换到该音频对应的对齐参数。
- 删除音频只从 `audios` 移除；是否保留 `alignments` 中的孤立条目需要确认。建议保留，便于以后重新关联；TXT/JSON 也会继续导出这些条目。
- 多个音频是**同一序列的不同整段录音，同一时间只使用一个**，还是需要同时播放的多轨素材？本计划按“不同录音、单活跃音频”设计。若要多轨混音，时间线和导出模型会显著不同，需要另定。

## 6. 计算与性能

- 使用 `file.arrayBuffer()` 加 `crypto.subtle.digest('SHA-256', buffer)`，转十六进制。
- 读取一次 ArrayBuffer，可同时用于哈希和解码，避免重复读文件。
- 计算期间显示“正在计算音频哈希/读取音频”，并禁用关联、对齐和合成操作。
- 三分钟 WAV 预计一秒内完成；更长文件需要实测内存与耗时。SHA-256 需要把整个文件读入内存，这是当前简单方案的已知限制。
- 可在文件选择后暂存 SHA，避免每次保存或切换都重新计算；文件字节变化时重新计算。

## 7. 测试与实施顺序

1. 哈希工具及已知文件测试：同字节同 SHA，改名不变，改一个字节变化。
2. `Music` 类型、验证、JSON 读写、TXT 多 `Alignment` 行及错误定位。
3. 音频集合、SHA 去重、IndexedDB 以 SHA 为键、重新关联和自动套用对齐。
4. 单活跃音频的播放、对齐、合成、删除和切换。
5. 更新 UI 文案与 README；无旧格式兼容测试。
6. `pnpm check` 与 `test:e2e`，再做一次实体声音试听。

## 8. 待确认

1. 多音频是“不同整段录音，单活跃”还是“多轨同时播放”？本计划按前者。
2. 使用完整 SHA-256 十六进制，还是 base64url 缩短文本？
3. 哈希原始文件字节（当前建议）还是忽略标签/重新编码后的音频内容？
4. 删除音频后是否保留对齐映射，供以后重新关联？
5. 预备节拍与音量继续按序列保存，还是也按 SHA 分开？
6. TXT 是否接受用户示例中的无空格写法 `Alignment:{SHA:..., bpm:..., start:...}`，并同时接受逗号后的空格？
7. 旧本地存储如何处理：直接忽略并在版本升级时清空，还是只拒绝旧导出文件？
