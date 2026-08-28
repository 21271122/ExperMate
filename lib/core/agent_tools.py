"""Agent 工具的 JSON Schema 定义（OpenAI function calling 格式）。"""

TOOL_LOAD_REFERENCE = {
    "type": "function",
    "function": {
        "name": "load_reference",
        "description": (
            "加载引用实验的完整数据（SOP、参数、结果、结论等）。"
            "接受实验编号：新格式如 2026-K7D2-003，也兼容旧 EXP-2026-003。"
            "用户只说'跟003一样'时先搜索确认，不要自行补全编号。"
            "模糊描述（如'上次的ZnO实验'）请用 search_experiments。"
            "结果写回messages，你可据此判断哪些字段可直接继承。"
            "已加载过的实验无需重复调用——数据已在 messages 中。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "refs": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "实验编号（如 2026-K7D2-003；兼容旧 EXP-YYYY-NNN）。不是模糊描述。",
                }
            },
            "required": ["refs"],
        },
    },
}

TOOL_SEARCH_EXPERIMENTS = {
    "type": "function",
    "function": {
        "name": "search_experiments",
        "description": (
            "在历史实验库中搜索。处理各种自然语言描述：\n"
            "- 时间指代：'上周的''最近的''上个月的'\n"
            "- 人员指代：'老张做的''我上次做的'\n"
            "- 状态指代：'失败的那个''成功的那个'\n"
            "- 材料指代：'做ZnO的那个''用了P25的'\n"
            "- 性能指代：'降解率最高的'\n"
            "返回候选列表。如用户确认候选，再调 read_experiment(as_reference=true) 加载完整数据。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索关键词或自然语言描述",
                },
                "include_archived": {
                    "type": "boolean",
                    "description": "是否包含已归档实验；默认否",
                },
            },
            "required": ["query"],
        },
    },
}

TOOL_UPDATE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "update_schema",
        "description": (
            "将本轮确认的信息写入Schema。写入后系统自动更新messages中的Schema状态摘要。"
            "注意: messages中已有当前Schema状态和引用实验数据，写入前请自行比对——"
            "新值与已有数据矛盾时，先向用户求证再写入，不要写入矛盾值后又覆盖。"
            "重要: generate_record 不会对字段值做二次 LLM 提取——它依赖你通过 update_schema 写入的数据质量。"
            "对数组字段(sop/tags/materials等)，如需整体替换或插入修正，先传[]清空再传完整列表: "
            "例如先 update_schema(sop:[]) 清空，再 update_schema(sop:[...完整步骤]) 写入正确顺序。"
            "嵌套对象(results/observations)必须传完整结构(含所有子字段)，不要只传部分子字段。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "fields": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "date": {"type": "string"},
                        "experimenter": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["planned", "running", "done", "failed", "repeated"],
                        },
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "purpose": {"type": "string"},
                        "materials": {"type": "array"},
                        "equipment": {"type": "array"},
                        "experimental_plan": {"type": "array"},
                        "sop": {"type": "array", "items": {"type": "string"}},
                        "process_parameters": {"type": "array"},
                        "observations": {"type": "object"},
                        "characterization": {"type": "array"},
                        "results": {"type": "object"},
                        "conclusion": {"type": "string"},
                        "next_steps": {"type": "array", "items": {"type": "string"}},
                    },
                    "description": "要更新的字段。增量更新——只传变化的。空列表[]或空对象{}表示清空。",
                },
                "round_summary": {
                    "type": "string",
                    "description": "一句话描述本轮收集/确认了哪些信息（用于日志）",
                },
            },
            "required": ["fields"],
        },
    },
}

TOOL_GENERATE_RECORD = {
    "type": "function",
    "function": {
        "name": "generate_record",
        "description": (
            "生成并保存实验记录。当你判断实验信息已收集完毕、核心字段（目的、"
            "材料、步骤/参数、结果/结论）已填充时调用。调用后系统立即保存结构化"
            "记录。不要只输出纯文本等待——"
            "调用本工具是生成记录的唯一途径。"
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}

TOOL_START_RECORD_THREAD = {
    "type": "function",
    "function": {
        "name": "start_record_thread",
        "description": (
            "开始一个实验记录线程。当用户明确表达要记录新实验时调用"
            "（如'记录新实验''帮我记一下''做了个...'等）。"
            "调用后标记对话进入记录模式，后续对话归属该线程。"
            "不要在查询、修改、闲聊时调用。"
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}

TOOL_END_THREAD = {
    "type": "function",
    "function": {
        "name": "end_thread",
        "description": (
            "结束当前对话线程（record 或 analyze）。"
            "用户明确表示取消、结束、不继续时调用"
            "（如'算了''不记了''取消''结束线程'等）。"
            "调用后系统归档线程，自动清理状态，对话回到自由模式。"
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}

TOOL_START_ANALYZE_THREAD = {
    "type": "function",
    "function": {
        "name": "start_analyze_thread",
        "description": (
            "开始一个跨实验分析线程。当用户明确表达要分析实验数据时调用"
            "（如'分析一下''帮我看看这些实验''对比钙钛矿PCE'等）。"
            "调用后进入分析模式，后续对话归属该线程。"
            "不要在记录实验、查询、闲聊时调用。"
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}

TOOL_SELECT_EXPERIMENTS = {
    "type": "function",
    "function": {
        "name": "select_experiments",
        "description": (
            "向用户展示实验选择面板，让用户勾选参与分析的实验。"
            "当用户说'筛选''过滤''选实验''挑实验'等，或你需要让用户从多个实验中做选择时，"
            "必须调用本工具——不要用纯文本表格代替。"
            "传入 candidates 作为候选列表（通常来自 search_experiments 或 list_experiments）。"
            "可传入 preselected 预勾选已确定的实验。"
            "用户勾选确认后，选中的实验编号列表作为 tool_result 回传。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "candidates": {
                    "type": "array", "items": {"type": "object"},
                    "description": "候选实验列表，每项含 id/title/date/tags",
                },
                "preselected": {
                    "type": "array", "items": {"type": "string"},
                    "description": "预勾选的实验编号列表",
                },
                "title": {
                    "type": "string",
                    "description": "面板标题，如'选择要分析的钙钛矿实验'",
                },
            },
            "required": ["candidates"],
        },
    },
}

TOOL_GENERATE_ANALYSIS = {
    "type": "function",
    "function": {
        "name": "generate_analysis",
        "description": (
            "执行跨实验分析并归档。当实验已选定、需求明确时调用。"
            "分析报告直接存储到本地分析历史，不在对话中显示全文。"
            "query 只写用户已经确认的分析目标，不要自行添加数据质量、复制痕迹等额外检查。"
            "调用后自动结束分析线程，回到自由模式。"
            "这是生成分析报告的唯一途径。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "分析问题，如'对比钙钛矿PCE趋势'",
                },
            },
            "required": ["query"],
        },
    },
}

TOOL_READ_ANALYSIS = {
    "type": "function",
    "function": {
        "name": "read_analysis",
        "description": (
            "读取一份已归档分析报告的完整正文、分析问题、生成时间和所选实验编号。"
            "用户提到分析编号、要求查看或引用历史分析报告时使用。报告只读，不能修改。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "anal_id": {"type": "string", "description": "分析编号，如 ANAL-2026-K7D2-001"},
            },
            "required": ["anal_id"],
        },
    },
}

TOOL_READ_UPDATE_LOG = {
    "type": "function",
    "function": {
        "name": "read_update_log",
        "description": "读取某个实验的更新日志。当需要确认字段是否被修改过时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "exp_id": {"type": "string", "description": "实验编号，如 2026-K7D2-003（兼容旧格式）"},
                "since": {"type": "string", "description": "可选，只返回此时间之后的更新"},
                "limit": {"type": "integer", "description": "最多返回几条，默认 5"},
            },
            "required": ["exp_id"],
        },
    },
}

TOOL_MODIFY_EXPERIMENT = {
    "type": "function",
    "function": {
        "name": "modify_experiment",
        "description": (
            "修改实验字段。changes 中未出现的字段保持磁盘现有值不变（增量语义）。"
            "嵌套数组字段的值是完整的数组替换——请先通过 read_experiment 获取当前完整数组，"
            "修改目标条目后传回完整数组。所有修改自动写入更新日志。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "refs": {"type": "array", "items": {"type": "string"},
                         "description": "要修改的实验编号列表"},
                "changes": {
                    "type": "object",
                    "description": "扁平字段名→新值映射。简单字段覆盖，数组字段完整替换。",
                },
                "expected_revision": {
                    "type": "integer",
                    "description": "可选。读取实验时返回的 revision；不一致时拒绝覆盖较新的修改。",
                },
            },
            "required": ["refs"],
        },
    },
}

TOOL_MANAGE_ARCHIVE = {
    "type": "function",
    "function": {
        "name": "manage_archive",
        "description": (
            "归档或恢复实验。归档只从默认列表、搜索与分析范围中隐藏实验，"
            "不会删除正文、附件、引用或历史记录。用户说“删除实验”时默认使用 archive，"
            "系统不提供彻底删除。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["archive", "restore"]},
                "refs": {"type": "array", "items": {"type": "string"},
                         "description": "要归档或恢复的实验编号列表"},
                "expected_revision": {"type": "integer",
                                      "description": "可选。读取实验时返回的 revision；不一致时拒绝覆盖。"},
            },
            "required": ["action", "refs"],
        },
    },
}

TOOL_MANAGE_CATEGORY = {
    "type": "function",
    "function": {
        "name": "manage_category",
        "description": "管理实验分类和置顶。删除分类只移除分类关系，不会删除实验。"
                       "先用 list 查看已有分类；分类内置顶要求实验已在该分类中。",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string",
                           "enum": ["list", "create", "rename", "delete", "add", "remove", "pin", "unpin"]},
                "category": {"type": "string", "description": "分类名称；list 省略时查看全部分类"},
                "name": {"type": "string", "description": "新分类名称；用于 create 或 rename"},
                "refs": {"type": "array", "items": {"type": "string"},
                         "description": "要加入、移出或置顶的实验编号"},
            },
            "required": ["action"],
        },
    },
}

TOOL_READ_EXPERIMENT = {
    "type": "function",
    "function": {
        "name": "read_experiment",
        "description": (
            "按字段读取实验的当前结构化数据，用于回答具体参数、步骤、材料或附件问题。"
            "省略 fields 时读取完整记录。as_reference=true 会同时把已成功读取的实验"
            "登记为当前记录/分析的引用，供后续生成使用。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "refs": {"type": "array", "items": {"type": "string"},
                         "description": "实验编号列表"},
                "fields": {"type": "array", "items": {"type": "string"},
                           "description": "要读取的字段，如 process_parameters、sop、materials、attachments；省略则读取完整记录"},
                "as_reference": {"type": "boolean",
                                 "description": "是否同时登记为当前记录或分析的引用；复刻、对照、分析时设为 true"},
                "include_updates": {"type": "boolean", "description": "是否附带最近三条更新摘要"},
            },
            "required": ["refs"],
        },
    },
}

TOOL_LIST_EXPERIMENTS = {
    "type": "function",
    "function": {
        "name": "list_experiments",
        "description": "按条件筛选实验列表。确定性执行，不调 LLM。",
        "parameters": {
            "type": "object",
            "properties": {
                "status": {"type": "string",
                           "enum": ["planned", "running", "done", "failed", "repeated"]},
                "tags": {"type": "array", "items": {"type": "string"}},
                "experimenter": {"type": "string"},
                "since": {"type": "string", "description": "起始日期 YYYY-MM-DD"},
                "include_archived": {"type": "boolean", "description": "是否包含已归档实验；默认否"},
            },
        },
    },
}

TOOL_SEARCH_CHAT_HISTORY = {
    "type": "function",
    "function": {
        "name": "search_chat_history",
        "description": "当用户询问过去对话中提过的内容时，按关键词检索已归档和当前的聊天记录。先用此工具获取命中位置与摘要，再按需读取附近上下文。",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "要查找的关键词或短语"},
                "date_from": {"type": "string", "description": "可选，起始日期 YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "可选，结束日期 YYYY-MM-DD"},
                "limit": {"type": "integer", "description": "返回条数，默认 10，最大 20"},
            },
            "required": ["query"],
        },
    },
}

TOOL_READ_CHAT_HISTORY = {
    "type": "function",
    "function": {
        "name": "read_chat_history",
        "description": "根据 search_chat_history 返回的 session_id 和 sequence，读取该条消息前后的少量完整可见对话。不要猜测 sequence。",
        "parameters": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "搜索结果返回的会话 ID"},
                "sequence": {"type": "integer", "description": "搜索结果返回的消息顺序号"},
                "before": {"type": "integer", "description": "读取前几条，默认 3，最大 10"},
                "after": {"type": "integer", "description": "读取后几条，默认 3，最大 10"},
            },
            "required": ["session_id", "sequence"],
        },
    },
}

TOOL_LIST_CHAT_SESSIONS = {
    "type": "function",
    "function": {
        "name": "list_chat_sessions",
        "description": "按最近消息时间列出可翻阅的历史会话。用户问某段时期讨论了什么、但没有关键词时使用。",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer", "description": "返回会话数，默认 20，最大 100"},
        }},
    },
}

TOOL_BROWSE_CHAT_HISTORY = {
    "type": "function",
    "function": {
        "name": "browse_chat_history",
        "description": "按时间从新到旧翻阅一个历史会话的可见消息。用于先 list_chat_sessions 后逐页阅读。",
        "parameters": {"type": "object", "properties": {
            "session_id": {"type": "string", "description": "list_chat_sessions 返回的会话 ID"},
            "before_sequence": {"type": "integer", "description": "可选；上一页返回的 next_before_sequence"},
            "limit": {"type": "integer", "description": "每页条数，默认 20，最大 100"},
        }, "required": ["session_id"]},
    },
}

TOOL_SEARCH_ATTACHMENTS = {
    "type": "function",
    "function": {
        "name": "search_attachments",
        "description": "搜索当前账号的附件（包括聊天上传但尚未关联实验的附件，以及已关联到实验的附件）。按文件名、附件标题或说明查找。",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "文件名、标题或说明关键词；为空时列出最近附件"},
                "limit": {"type": "integer", "description": "最多返回数量，默认 20，最大 50"},
            },
        },
    },
}

TOOL_READ_ATTACHMENT = {
    "type": "function",
    "function": {
        "name": "read_attachment",
        "description": "读取 TXT、CSV、XLSX 或 PDF 的可提取文本。XLSX 按工作表独立截断，"
                       "可指定工作表并按行继续读取。图片会直接交给当前 Agent 模型进行视觉识别，不使用 OCR；"
                       "若当前模型不支持视觉，会明确返回该提示。"
                       "如需关联实验，使用 manage_attachment。",
        "parameters": {
            "type": "object",
            "properties": {
                "sha256": {"type": "string", "description": "附件 SHA-256；来自用户上传提示或 search_attachments 结果"},
                "max_chars": {"type": "integer", "description": "最多读取字符数；XLSX 为每个工作表的上限，默认 4000，最大 30000；其他文件默认 12000"},
                "sheet": {"type": "string", "description": "仅 XLSX：指定要读取的工作表名称；省略则读取每个工作表的独立预览"},
                "start_row": {"type": "integer", "description": "仅 XLSX：从第几行开始读取，默认 1；用于继续读取被截断的工作表"},
            },
            "required": ["sha256"],
        },
    },
}

TOOL_MANAGE_ATTACHMENT = {
    "type": "function",
    "function": {
        "name": "manage_attachment",
        "description": "把附件关联到实验，或从实验移除关联。聊天上传的附件默认只属于对话；只有在用户语义明确或确认后才关联。关联时应给出面向用户的标题和可选说明。",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["link", "unlink"]},
                "sha256": {"type": "string", "description": "附件 SHA-256"},
                "exp_id": {"type": "string", "description": "目标实验编号，如 2026-K7D2-003（兼容旧格式）"},
                "title": {"type": "string", "description": "关联后展示的附件标题；link 时建议填写"},
                "description": {"type": "string", "description": "附件说明，可选"},
            },
            "required": ["action", "sha256", "exp_id"],
        },
    },
}

TOOL_MANAGE_MUSIC = {
    "type": "function",
    "function": {
        "name": "manage_music",
        "description": "管理当前设备的背景音乐：查看当前曲目和可用曲库、播放、停止、切换下一首，或把用户上传的音频附件加入曲库。添加时只能使用本账号已上传的音频附件。",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["status", "play", "stop", "next", "add"]},
                "track_id": {"type": "string", "description": "播放指定曲目时使用；先用 status 查看可用曲目 ID"},
                "sha256": {"type": "string", "description": "add 时必填：聊天附件的 SHA-256"},
                "title": {"type": "string", "description": "add 时的曲目名称，可选"},
            },
            "required": ["action"],
        },
    },
}

TOOLS_OPENAI_FORMAT = [
    TOOL_SEARCH_EXPERIMENTS,
    TOOL_START_RECORD_THREAD,
    TOOL_UPDATE_SCHEMA,
    TOOL_GENERATE_RECORD,
    TOOL_READ_UPDATE_LOG,
    TOOL_MODIFY_EXPERIMENT,
    TOOL_MANAGE_ARCHIVE,
    TOOL_MANAGE_CATEGORY,
    TOOL_READ_EXPERIMENT,
    TOOL_LIST_EXPERIMENTS,
    TOOL_SEARCH_CHAT_HISTORY,
    TOOL_READ_CHAT_HISTORY,
    TOOL_LIST_CHAT_SESSIONS,
    TOOL_BROWSE_CHAT_HISTORY,
    TOOL_SEARCH_ATTACHMENTS,
    TOOL_READ_ATTACHMENT,
    TOOL_MANAGE_ATTACHMENT,
    TOOL_MANAGE_MUSIC,
    TOOL_END_THREAD,
    TOOL_START_ANALYZE_THREAD,
    TOOL_SELECT_EXPERIMENTS,
    TOOL_GENERATE_ANALYSIS,
    TOOL_READ_ANALYSIS,
]
