# 第三方组件与音频声明

本文件列出随 ExperMate 分发的第三方代码与音频资源。项目自身代码适用根目录的
[ELv2 许可证](LICENSE)；以下资源继续适用各自的许可证。

## 前端代码

| 组件 | 许可证 | 许可证文本 |
| --- | --- | --- |
| Marked 15.0.12 | MIT | `frontend/licenses/marked/LICENSE.md` |
| KaTeX 0.19.0 | MIT | `frontend/licenses/katex/LICENSE` |
| DOMPurify 3.4.17 | Apache-2.0 或 MPL-2.0 | `frontend/licenses/dompurify/` |

## 操作音效

- `frontend/public/audio/uisfx/` 中的 Zen 音效来自 [uisfx](https://github.com/romainsimon/uisfx)，音频适用 CC0 1.0；其程序代码适用 MIT。

## 古典背景音乐

`frontend/public/audio/classical/` 下每个音频文件的曲目、演奏者、原始来源及许可证均见
[`CREDITS.md`](frontend/public/audio/classical/CREDITS.md)。其中 CC BY 与 CC BY-SA 录音在再分发时必须保留相应署名与许可证信息；本文件和该来源表应一并保留。

## 用户上传内容

用户上传的附件和自定义背景音乐保存在服务端运行数据中，不随源码仓库分发，也不受本声明授权。

## PDF 页面渲染

服务端新增 pypdfium2 5.6.0，用于将 PDF 页转为图像后交给原生多模态模型；不运行 OCR。发布时保留其安装包中的 pypdfium2 与 PDFium 许可证和第三方声明。
