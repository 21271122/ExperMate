"""从方案的两份正文确定性计算审阅摘要；不推测字段合并或对象语义。"""

SECTIONS = {'conditions': '实验条件', 'process': '实验过程', 'results': '结果与分析'}
KINDS = {'text': '文本', 'table': '表格', 'process': '流程图', 'formula': '公式', 'assets': '附件'}
PRESENTATIONS = {'text': '文本', 'table': '表格', 'cards': '卡片', 'flow': '流程图', 'steps': '步骤视图',
                 'formula': '公式', 'gallery': '图集', 'files': '文件列表'}
COLUMN_TYPES = {'text': '文本', 'number': '数字'}


def summarize_changes(before, after):
    changes = []

    def add(kind, message, field_id=None, *, warning=False, review_content=False):
        changes.append({'kind': kind, 'message': message, 'field_id': field_id,
                        'warning': warning, 'review_content': review_content})

    old = {field['id']: (section['id'], field) for section in before['sections'] for field in section['fields']}
    new = {field['id']: (section['id'], field) for section in after['sections'] for field in section['fields']}
    for field_id, (section_id, field) in old.items():
        if field_id not in new:
            add('field_removed', f'删除「{SECTIONS[section_id]} / {field["label"]}」，包括该字段原有内容。',
                field_id, warning=True, review_content=True)
    for field_id, (section_id, field) in new.items():
        location = f'「{SECTIONS[section_id]} / {field["label"]}」'
        if field_id not in old:
            add('field_added', f'新增{location}（{KINDS[field["kind"]]}）。', field_id)
            continue
        old_section, previous = old[field_id]
        if previous['label'] != field['label']:
            add('field_renamed', f'字段「{previous["label"]}」改名为「{field["label"]}」。', field_id)
        if old_section != section_id:
            add('field_moved', f'字段「{field["label"]}」从「{SECTIONS[old_section]}」移至「{SECTIONS[section_id]}」。', field_id)
        if previous['kind'] != field['kind']:
            add('field_type_changed', f'{location}由{KINDS[previous["kind"]]}改为{KINDS[field["kind"]]}，旧类型内容将被新内容替换。',
                field_id, warning=True, review_content=True)
        else:
            old_content, new_content = dict(previous['content']), dict(field['content'])
            if field['kind'] == 'table':
                old_columns = {c['id']: c for c in old_content.pop('columns')}
                new_columns = {c['id']: c for c in new_content.pop('columns')}
                for column_id, column in old_columns.items():
                    if column_id not in new_columns:
                        count = sum(bool(row['cells'].get(column_id)) for row in previous['content']['rows'])
                        add('column_removed', f'{location}移除列「{column["label"]}」，涉及 {count} 个原有非空单元格。',
                            field_id, warning=count > 0, review_content=count > 0)
                for column_id, column in new_columns.items():
                    if column_id not in old_columns:
                        add('column_added', f'{location}新增列「{column["label"]}」。', field_id)
                    else:
                        old_column = old_columns[column_id]
                        if old_column['label'] != column['label']:
                            add('column_renamed', f'{location}列「{old_column["label"]}」改名为「{column["label"]}」。', field_id)
                        if old_column.get('type', 'text') != column.get('type', 'text'):
                            add('column_type_changed', f'{location}列「{column["label"]}」类型由{COLUMN_TYPES[old_column.get("type", "text")]}改为{COLUMN_TYPES[column.get("type", "text")]}。', field_id)
                if [key for key in old_columns if key in new_columns] != [key for key in new_columns if key in old_columns]:
                    add('columns_reordered', f'{location}调整了列的排列顺序。', field_id)
            # 图形坐标变化不是实验内容变化；表格列结构已在上面单独描述。
            old_content.pop('layout', None)
            new_content.pop('layout', None)
            if old_content != new_content:
                add('content_changed', f'{location}的内容同时发生变化，请核对新增、删除或替换的内容。',
                    field_id, warning=True, review_content=True)
        if previous['kind'] == field['kind'] and previous.get('presentation') != field.get('presentation'):
            add('presentation_changed', f'{location}调整了呈现方式（{PRESENTATIONS[previous["presentation"]]} → {PRESENTATIONS[field["presentation"]]}）。', field_id)
        if previous.get('note', '') != field.get('note', ''):
            add('note_changed', f'{location}修改了字段备注。', field_id, review_content=True)
        if previous.get('source_refs', []) != field.get('source_refs', []):
            add('field_sources_changed', f'{location}修改了来源引用，请核对依据。', field_id)

    for section in before['sections']:
        section_id = section['id']
        retained = {key for key in old.keys() & new.keys() if old[key][0] == new[key][0] == section_id}
        old_order = [f['id'] for f in section['fields'] if f['id'] in retained]
        new_order = [f['id'] for s in after['sections'] if s['id'] == section_id for f in s['fields'] if f['id'] in retained]
        if old_order != new_order:
            add('fields_reordered', f'「{SECTIONS[section_id]}」调整了已有字段的排列顺序。')
    if before.get('sources', []) != after.get('sources', []):
        add('sources_changed', '记录的来源清单发生变化；来源链接可在对应字段中查看。')
    return {'changes': changes}
