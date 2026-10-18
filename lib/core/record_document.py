"""三板块、一层字段的实验正文契约；不包含存储和模型调用。"""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


Identifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]


class Source(StrictModel):
    id: Identifier
    kind: Literal["message", "attachment", "experiment", "legacy"]
    reference: str = Field(min_length=1, max_length=256)
    page: int | None = Field(default=None, ge=1)
    revision: int | None = Field(default=None, ge=0)
    field_id: str | None = None
    excerpt: str = Field(default="", max_length=12000)

    @model_validator(mode='after')
    def experiment_revision(self):
        if self.kind == 'experiment' and self.revision is None:
            raise ValueError('历史实验来源必须记录具体修订号')
        return self


class TextContent(StrictModel):
    text: str = Field(default="", max_length=100000)


class Column(StrictModel):
    id: Identifier
    label: str = Field(min_length=1, max_length=120)
    type: Literal["text", "number"] = "text"


class TableRow(StrictModel):
    id: Identifier
    cells: dict[str, str] = Field(default_factory=dict)


def unique_ids(items):
    ids = [item.id for item in items]
    if len(ids) != len(set(ids)):
        raise ValueError("身份 ID 不可重复")


class TableContent(StrictModel):
    columns: list[Column] = Field(default_factory=list, max_length=50)
    rows: list[TableRow] = Field(default_factory=list, max_length=5000)

    @model_validator(mode="after")
    def validate_cells(self):
        unique_ids(self.columns)
        unique_ids(self.rows)
        allowed = {column.id for column in self.columns}
        if any(set(row.cells) - allowed for row in self.rows):
            raise ValueError("单元格引用了不存在的列")
        return self


class Parameter(StrictModel):
    id: Identifier
    label: str = Field(min_length=1, max_length=120)
    value: str = Field(default="", max_length=2000)
    unit: str = Field(default="", max_length=120)


class MaterialNode(StrictModel):
    id: Identifier
    label: str = Field(min_length=1, max_length=1000)
    note: str = Field(default="", max_length=12000)


class Action(StrictModel):
    id: Identifier
    source_ids: list[Identifier] = Field(min_length=1, max_length=100)
    target_ids: list[Identifier] = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=1000)
    parameters: list[Parameter] = Field(default_factory=list, max_length=100)
    repeat_note: str = Field(default="", max_length=1000)
    note: str = Field(default="", max_length=12000)


class Position(StrictModel):
    x: float | int
    y: float | int

    @model_validator(mode='after')
    def finite(self):
        import math
        if not math.isfinite(self.x) or not math.isfinite(self.y):
            raise ValueError('节点坐标必须是有限数值')
        return self


class ProcessContent(StrictModel):
    nodes: list[MaterialNode] = Field(default_factory=list, max_length=300)
    actions: list[Action] = Field(default_factory=list, max_length=500)
    layout: dict[str, Position] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_links(self):
        unique_ids(self.nodes)
        unique_ids(self.actions)
        node_ids = {node.id for node in self.nodes}
        for action in self.actions:
            unique_ids(action.parameters)
            if set(action.source_ids + action.target_ids) - node_ids:
                raise ValueError("动作引用了不存在的物质节点")
        if set(self.layout) - node_ids:
            raise ValueError("布局引用了不存在的物质节点")
        return self


class FormulaContent(StrictModel):
    latex: str = Field(default="", max_length=12000)
    explanation: str = Field(default="", max_length=12000)
    substitution: str = Field(default="", max_length=12000)
    result: str = Field(default="", max_length=12000)


class Asset(StrictModel):
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    caption: str = Field(default="", max_length=12000)


class AssetsContent(StrictModel):
    items: list[Asset] = Field(default_factory=list, max_length=100)


class BaseField(StrictModel):
    id: Identifier
    label: str = Field(min_length=1, max_length=120)
    note: str = Field(default="", max_length=12000)
    source_refs: list[Identifier] = Field(default_factory=list, max_length=100)


class TextField(BaseField):
    kind: Literal["text"]
    presentation: Literal["text"] = "text"
    content: TextContent


class TableField(BaseField):
    kind: Literal["table"]
    presentation: Literal["table", "cards"] = "table"
    content: TableContent


class ProcessField(BaseField):
    kind: Literal["process"]
    presentation: Literal["flow", "steps"] = "flow"
    content: ProcessContent


class FormulaField(BaseField):
    kind: Literal["formula"]
    presentation: Literal["formula"] = "formula"
    content: FormulaContent


class AssetsField(BaseField):
    kind: Literal["assets"]
    presentation: Literal["gallery", "files"] = "gallery"
    content: AssetsContent


RecordField = Annotated[TextField | TableField | ProcessField | FormulaField | AssetsField,
                        Field(discriminator="kind")]


class Section(StrictModel):
    id: Literal["conditions", "process", "results"]
    fields: list[RecordField] = Field(default_factory=list, max_length=100)


class RecordDocument(StrictModel):
    format_version: Literal[2] = 2
    sections: list[Section] = Field(min_length=3, max_length=3)
    sources: list[Source] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def validate_structure(self):
        if [section.id for section in self.sections] != ["conditions", "process", "results"]:
            raise ValueError("正文必须依次包含实验条件、实验过程、结果与分析三个板块")
        fields = [field for section in self.sections for field in section.fields]
        unique_ids(fields)
        unique_ids(self.sources)
        source_ids = {source.id for source in self.sources}
        if any(set(field.source_refs) - source_ids for field in fields):
            raise ValueError("字段引用了不存在的来源")
        return self


def empty_document() -> dict:
    return RecordDocument(sections=[Section(id=key) for key in ("conditions", "process", "results")]).model_dump()


def validate_document(document: dict) -> dict:
    return RecordDocument.model_validate(document).model_dump()


def structure_signature(document: dict) -> list:
    """结构不含表格数据行、图节点/动作、来源、呈现和布局。"""
    return [(section["id"], [(field["id"], field["label"], field["kind"],
                             field["content"].get("columns") if field["kind"] == "table" else None)
                            for field in section["fields"]]) for section in document["sections"]]
