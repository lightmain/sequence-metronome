# 第三方组件

## MP3 编码器

应用使用 `@breezystack/lamejs` 1.2.7（作者 Alex Zhukov，维护仓库 shijinyu/lamejs），包声明许可证为 LGPL-3.0。原始 LAME 项目见 https://lame.sourceforge.net/。

- 固定版本源码及构建文件：https://www.npmjs.com/package/@breezystack/lamejs/v/1.2.7
- 上游源码：https://github.com/shijinyu/lamejs
- 上游许可说明：https://github.com/shijinyu/lamejs/blob/master/LICENSE
- LGPL-3.0 全文：https://www.gnu.org/licenses/lgpl-3.0.html
- GPL-3.0 全文（LGPL 引用）：https://www.gnu.org/licenses/gpl-3.0.html

未修改上游编码器源码。构建产物将编码器输出为独立的 `assets/mp3-encoder-*.js` 模块，由编码工作线程加载。可保留该文件名，用导出相同接口的兼容实现替换该模块；具体导出名称见编码工作线程开头的 import 声明。也可在本仓库更改依赖后重新构建。仓库的 MIT 许可证适用于本项目自身代码，第三方组件遵循各自许可证。

## 节拍音效

见 [音效许可](public/sounds/LICENSE.md)。
