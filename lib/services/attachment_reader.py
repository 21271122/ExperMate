"""少量实验资料的页面准备与原生多模态阅读，不运行 OCR。"""
from io import BytesIO

from PIL import Image, ImageOps


MAX_PAGES = 6
MAX_EDGE = 1800


def prepare_pages(content, mime, name, start_page=1, page_count=3):
    if type(start_page) is not int or start_page < 1 or type(page_count) is not int or not 1 <= page_count <= MAX_PAGES:
        raise ValueError('start_page 至少为 1；page_count 为 1～6')
    pages = []
    if mime == 'application/pdf' or name.lower().endswith('.pdf'):
        import pypdfium2 as pdfium
        with pdfium.PdfDocument(content) as pdf:
            total = len(pdf)
            if start_page > total: raise ValueError('起始页超出文件范围')
            for index in range(start_page - 1, min(total, start_page - 1 + page_count)):
                page = pdf[index]
                try:
                    width, height = page.get_size()
                    bitmap = page.render(scale=min(2, MAX_EDGE / max(width, height)))
                    try: image = bitmap.to_pil().copy()
                    finally: bitmap.close()
                    pages.append((index + 1, encode_page(image)))
                    image.close()
                finally: page.close()
    else:
        with Image.open(BytesIO(content)) as image:
            if image.width * image.height > 24_000_000:
                raise ValueError('图像像素过大，请裁切后重试')
            total = getattr(image, 'n_frames', 1)
            if start_page > total: raise ValueError('起始页超出文件范围')
            for index in range(start_page - 1, min(total, start_page - 1 + page_count)):
                image.seek(index)
                pages.append((index + 1, encode_page(ImageOps.exif_transpose(image))))
    return pages, total


def encode_page(image):
    prepared = image.convert('RGB')
    try:
        prepared.thumbnail((MAX_EDGE, MAX_EDGE))
        output = BytesIO()
        prepared.save(output, format='JPEG', quality=90)
        return output.getvalue()
    finally: prepared.close()


def read_visual_attachment(llm, content, meta, sha256, *, start_page=1, page_count=3, context=''):
    if not hasattr(llm, 'read_document_pages'):
        return {'status': 'vision_unavailable', 'message': '当前模型未提供原生页面阅读能力。'}
    try:
        pages, total = prepare_pages(content, meta.get('mime', ''), meta.get('name', ''), start_page, page_count)
        text = llm.read_document_pages(pages, meta.get('name', ''), context)
    except Exception as error:
        return {'status': 'vision_unavailable', 'message': f'页面阅读失败，未写入正文：{str(error)[:180]}'}
    last_page = pages[-1][0]
    return {'status': 'ok', 'extraction': 'vision', 'sha256': sha256, 'name': meta.get('name', ''),
            'content': text, 'total_pages': total, 'read_pages': [page for page, _ in pages],
            'next_page': last_page + 1 if last_page < total else None,
            'unread_before': start_page > 1,
            'sources': [{'kind': 'attachment', 'reference': sha256, 'page': page} for page, _ in pages],
            'message': '仅以上页码已读取；看不清的信息保持未知，结构变更需另行提案。'}
