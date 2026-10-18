"""不调用模型的正文投影：摘要、全文与旧记录兼容视图。"""
from lib.core.record_document import empty_document, validate_document


def document_text(document):
    parts = []
    for section in document['sections']:
        for field in section['fields']:
            parts.extend([field['label'], field.get('note', '')])
            content = field['content']
            if field['kind'] == 'text': parts.append(content['text'])
            elif field['kind'] == 'table':
                parts.extend(column['label'] for column in content['columns'])
                parts.extend(value for row in content['rows'] for value in row['cells'].values())
            elif field['kind'] == 'process':
                parts.extend(node['label'] + ' ' + node.get('note', '') for node in content['nodes'])
                for action in content['actions']:
                    parts.extend([action['label'], action.get('note', ''), action.get('repeat_note', '')])
                    parts.extend(' '.join([p['label'], p['value'], p.get('unit', '')]) for p in action['parameters'])
            elif field['kind'] == 'formula': parts.extend(content.values())
            elif field['kind'] == 'assets': parts.extend(item['caption'] for item in content['items'])
    return '\n'.join(part for part in parts if part)


def legacy_document(record):
    """保持原文与未来语义，不推测物质节点，不将默认“无异常”转成事实。"""
    document = empty_document()
    groups = [
        [('purpose', '实验目的'), ('materials', '药品列表'), ('equipment', '仪器列表'),
         ('experimental_plan', '原实验方案（计划/预期，非执行结果）')],
        [('sop', '操作步骤'), ('process_parameters', '过程参数'), ('observations', '原观察记录')],
        [('characterization', '原表征记录（保留原计划/实际语义）'), ('results', '实验结果'),
         ('conclusion', '结论'), ('next_steps', '后续想法（未执行）')],
    ]
    import json
    for section, fields in zip(document['sections'], groups):
        for key, label in fields:
            value = record.get(key)
            if not value: continue
            if key == 'observations' and isinstance(value, dict) and not value.get('items'): continue
            if isinstance(value, list) and all(isinstance(row, dict) for row in value):
                keys = list(dict.fromkeys(k for row in value for k in row))
                # Stable synthetic column IDs avoid interpreting arbitrary old keys as identifiers.
                columns = [{'id': f'c{i}', 'label': key} for i, key in enumerate(keys)]
                field = {'kind': 'table', 'content': {'columns': columns, 'rows': [
                    {'id': f'r{i}', 'cells': {f'c{j}': str(row.get(key, '')) for j, key in enumerate(keys)}}
                    for i, row in enumerate(value)]}}
            else:
                text = value if isinstance(value, str) else '\n'.join(value) if isinstance(value, list) and all(isinstance(v, str) for v in value) else json.dumps(value, ensure_ascii=False, indent=2)
                field = {'kind': 'text', 'content': {'text': text}}
            section['fields'].append({'id': f'legacy_{key}', 'label': label, **field})
    return validate_document(document)


def semantic_document(document):
    from copy import deepcopy
    result = deepcopy(document)
    for section in result['sections']:
        for field in section['fields']:
            field.pop('presentation', None)
            if field['kind'] == 'process': field['content'].pop('layout', None)
    return result
