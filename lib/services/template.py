"""模板管理服务。从 app.py 的 TemplateStore 迁出。"""

from __future__ import annotations

import yaml
from pathlib import Path
from typing import Any


class TemplateService:
    def __init__(self, templates_dir: str):
        self.path = Path(templates_dir)
        self.path.mkdir(parents=True, exist_ok=True)
        self._seed_builtin()

    def list_all(self) -> list[dict[str, Any]]:
        templates = []
        for fp in sorted(self.path.glob("*.yaml")):
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                if data:
                    templates.append({
                        "id": data.get("id", fp.stem),
                        "title": data.get("title", fp.stem),
                        "category": data.get("category", ""),
                        "description": data.get("description", ""),
                        "tags": data.get("tags", []),
                    })
            except Exception:
                continue
        return templates

    def load(self, template_id: str) -> dict[str, Any] | None:
        fp = self.path / f"{template_id}.yaml"
        if not fp.exists():
            return None
        with open(fp, "r", encoding="utf-8") as f:
            return dict(yaml.safe_load(f))

    def _seed_builtin(self) -> None:
        if list(self.path.glob("*.yaml")):
            return
        for tmpl in _BUILTIN_TEMPLATES:
            fp = self.path / f"{tmpl['id']}.yaml"
            with open(fp, "w", encoding="utf-8") as f:
                yaml.dump(tmpl, f, allow_unicode=True, sort_keys=False,
                          default_flow_style=False, indent=2)


_BUILTIN_TEMPLATES = [
    {
        "id": "photocatalysis",
        "title": "光催化降解实验",
        "category": "光催化",
        "description": "半导体光催化剂降解有机污染物的标准实验流程，适用于 TiO2/ZnO/g-C3N4 等催化剂评价",
        "tags": ["photocatalysis", "thin-film", "calcination"],
        "content": (
            "<p><strong>实验目的：</strong>研究【催化剂名称，如TiO2 P25】在【光源类型，如300W氙灯】照射下"
            "对【目标污染物，如亚甲基蓝】的光催化降解性能，确定最佳【变量，如负载量/浓度/pH】。</p>"
            "<p><strong>材料与试剂：</strong></p><ul>"
            "<li>【催化剂名称】，纯度【填写纯度】，厂家【填写厂家】</li>"
            "<li>【目标污染物】，浓度【填写浓度】</li>"
            "<li>基板：【基板类型，如2×2 cm玻璃片】</li></ul>"
            "<p><strong>实验设置【填写数量】组：</strong></p><ul>"
            "<li>组1：【变量条件1】</li><li>组2：【变量条件2】</li><li>组3：【变量条件3】</li></ul>"
            "<p><strong>实验步骤：</strong></p><ol>"
            "<li>配制【目标污染物】溶液，浓度【填写浓度】</li>"
            "<li>准备基板，清洗干燥</li>"
            "<li>配制不同【变量】的催化剂悬浮液：【填写具体配比】</li>"
            "<li>采用【涂覆方法，如浸渍提拉法】将催化剂涂覆到基板上</li>"
            "<li>在【温度】°C下煅烧【时间】小时</li>"
            "<li>使用【光源】照射样品</li>"
            "<li>每【时间间隔】分钟取样，用【测试方法，如紫外-可见分光光度计】测量【指标，如吸光度】</li></ol>"
            "<p><strong>预期结果：</strong>【填写预期】</p>"
            "<p><strong>备注：</strong>【填写其他信息】</p>"
        ),
    },
    {
        "id": "hydrothermal",
        "title": "水热/溶剂热合成",
        "category": "合成",
        "description": "水热或溶剂热法合成纳米材料、MOF、分子筛等的标准实验记录模板",
        "tags": ["hydrothermal", "synthesis", "nano"],
        "content": (
            "<p><strong>实验目的：</strong>通过水热/溶剂热法合成【目标产物名称】，研究【变量，如温度/时间/前驱体比例】"
            "对产物【性能指标，如形貌/晶相/尺寸】的影响。</p>"
            "<p><strong>材料与试剂：</strong></p><ul>"
            "<li>前驱体1：【名称】，【用量】，纯度【填写】，厂家【填写】</li>"
            "<li>前驱体2：【名称】，【用量】，纯度【填写】，厂家【填写】</li>"
            "<li>溶剂：【名称，如水/乙醇/DMF】，用量【填写】mL</li>"
            "<li>模板剂/表面活性剂：【名称】，用量【填写】</li></ul>"
            "<p><strong>实验参数：</strong></p><ul>"
            "<li>反应釜容积：【填写】mL，填充度：【填写】%</li>"
            "<li>反应温度：【填写】°C</li>"
            "<li>反应时间：【填写】小时</li>"
            "<li>升温速率：【填写】°C/min</li>"
            "<li>pH值：【填写】（如适用）</li></ul>"
            "<p><strong>实验步骤：</strong></p><ol>"
            "<li>称取前驱体，溶于溶剂中，搅拌【时间】至溶解/分散均匀</li>"
            "<li>（可选）加入模板剂，继续搅拌【时间】</li>"
            "<li>（可选）调节 pH 至【值】</li>"
            "<li>将溶液转移至反应釜内衬中</li>"
            "<li>密封反应釜，放入烘箱，【温度】°C 反应【时间】小时</li>"
            "<li>自然冷却至室温</li>"
            "<li>离心/过滤收集产物，用【溶剂】洗涤【次数】次</li>"
            "<li>在【温度】°C 下干燥【时间】小时</li></ol>"
            "<p><strong>产物表征计划：</strong>XRD / SEM / TEM / BET / 【其他】</p>"
            "<p><strong>备注：</strong>【填写其他信息】</p>"
        ),
    },
    {
        "id": "sol-gel",
        "title": "溶胶-凝胶法制备",
        "category": "合成",
        "description": "溶胶-凝胶法制备氧化物纳米粉体或薄膜的标准实验记录模板",
        "tags": ["sol-gel", "synthesis", "nano"],
        "content": (
            "<p><strong>实验目的：</strong>采用溶胶-凝胶法制备【目标产物，如TiO2/SiO2/Al2O3纳米粉体或薄膜】，"
            "研究【变量】对产物性能的影响。</p>"
            "<p><strong>材料与试剂：</strong></p><ul>"
            "<li>前驱体：【名称，如钛酸四丁酯/正硅酸乙酯】，用量【填写】mL，纯度【填写】，厂家【填写】</li>"
            "<li>溶剂：【名称，如乙醇/异丙醇】，用量【填写】mL</li>"
            "<li>水解抑制剂：【名称，如冰醋酸/乙酰丙酮】，用量【填写】mL</li>"
            "<li>水：用量【填写】mL</li>"
            "<li>催化剂（酸/碱）：【名称】，用量【填写】</li></ul>"
            "<p><strong>实验步骤：</strong></p><ol>"
            "<li>将前驱体溶于【溶剂】，搅拌【时间】</li>"
            "<li>加入水解抑制剂，搅拌【时间】</li>"
            "<li>缓慢滴加水（+催化剂），控制滴加速率【填写】</li>"
            "<li>搅拌形成溶胶（约【时间】）</li>"
            "<li>陈化：【温度】°C 静置【时间】小时，形成凝胶</li>"
            "<li>干燥：【温度】°C，【时间】小时，得干凝胶</li>"
            "<li>煅烧：【温度】°C，【时间】小时，升温速率【填写】°C/min</li>"
            "<li>研磨（如需）：研钵研磨【时间】分钟</li></ol>"
            "<p><strong>表征计划：</strong>XRD / SEM / TG-DTA / FTIR / 【其他】</p>"
            "<p><strong>备注：</strong>【填写其他信息】</p>"
        ),
    },
    {
        "id": "spin-coating",
        "title": "旋涂法制膜",
        "category": "薄膜",
        "description": "旋涂法制备薄膜的标准实验记录，适用于钙钛矿/聚合物/氧化物薄膜制备",
        "tags": ["thin-film", "coating", "spin-coating"],
        "content": (
            "<p><strong>实验目的：</strong>采用旋涂法在【基底名称，如ITO玻璃/硅片】上制备【薄膜材料名称】薄膜，"
            "研究【变量，如转速/浓度/退火温度】对薄膜质量的影响。</p>"
            "<p><strong>材料与试剂：</strong></p><ul>"
            "<li>薄膜材料前驱体：【名称】，浓度【填写】mg/mL，溶剂【填写】</li>"
            "<li>基底：【名称】，尺寸【填写，如2×2 cm】</li>"
            "<li>其他试剂：【名称】，用途【填写】</li></ul>"
            "<p><strong>基底预处理：</strong></p><ul>"
            "<li>清洗方式：【超声清洗/UV臭氧处理/等离子清洗】</li>"
            "<li>清洗步骤：【填写】</li></ul>"
            "<p><strong>旋涂参数：</strong></p><ul>"
            "<li>预转速：【填写】rpm，时间：【填写】秒</li>"
            "<li>主转速：【填写】rpm，时间：【填写】秒</li>"
            "<li>旋涂次数：【填写】层</li>"
            "<li>每层中间处理：【退火/干燥】，温度【填写】°C，时间【填写】分钟</li></ul>"
            "<p><strong>后处理：</strong></p><ul>"
            "<li>退火温度：【填写】°C</li>"
            "<li>退火时间：【填写】分钟</li>"
            "<li>退火气氛：【空气/N2/真空】</li></ul>"
            "<p><strong>实验步骤：</strong></p><ol>"
            "<li>清洗基底并预处理</li>"
            "<li>配制前驱体溶液，搅拌至澄清，过滤（如需）</li>"
            "<li>将基底吸附在旋涂仪吸盘上</li>"
            "<li>滴加前驱体溶液覆盖基底表面</li>"
            "<li>启动旋涂程序：【预转参数】→【主转参数】</li>"
            "<li>（多层膜）重复滴加和旋涂</li>"
            "<li>退火处理</li></ol>"
            "<p><strong>表征计划：</strong>膜厚测量 / SEM截面 / AFM / UV-Vis透过率 / 【其他】</p>"
            "<p><strong>备注：</strong>【填写其他信息】</p>"
        ),
    },
    {
        "id": "ball-milling",
        "title": "球磨法制粉",
        "category": "合成",
        "description": "高能球磨法制备复合粉体或机械合金化的标准实验记录模板",
        "tags": ["ball-milling", "synthesis", "composite"],
        "content": (
            "<p><strong>实验目的：</strong>通过球磨法制备【目标粉体名称】复合粉体，研究【变量，如球磨时间/转速/球料比】"
            "对粉体【性能指标，如粒径/混合均匀性/相变】的影响。</p>"
            "<p><strong>材料：</strong></p><ul>"
            "<li>原料1：【名称】，用量【填写】g，纯度【填写】</li>"
            "<li>原料2：【名称】，用量【填写】g，纯度【填写】</li>"
            "<li>过程控制剂（PCA）：【名称，如乙醇/硬脂酸】，用量【填写】mL或wt%</li></ul>"
            "<p><strong>球磨参数：</strong></p><ul>"
            "<li>球磨罐材质：【不锈钢/氧化锆/玛瑙/碳化钨】</li>"
            "<li>球磨罐容积：【填写】mL</li>"
            "<li>磨球材质及尺寸：【填写，如Φ10mm氧化锆球】</li>"
            "<li>球料比：【填写，如10:1】</li>"
            "<li>转速：【填写】rpm</li>"
            "<li>球磨时间：【填写】小时</li>"
            "<li>球磨模式：【单向/双向交替】，停机间隔【填写】分钟</li>"
            "<li>气氛保护：【氩气/N2/空气】</li></ul>"
            "<p><strong>实验步骤：</strong></p><ol>"
            "<li>称取各原料粉末</li>"
            "<li>将磨球和原料按比例装入球磨罐</li>"
            "<li>加入过程控制剂</li>"
            "<li>（如需）充入保护气体</li>"
            "<li>密封球磨罐，安装到球磨机上</li>"
            "<li>设定参数，启动球磨</li>"
            "<li>球磨结束后，取出粉末，过筛（如需）</li></ol>"
            "<p><strong>表征计划：</strong>XRD / SEM / 粒径分析 / BET / 【其他】</p>"
            "<p><strong>备注：</strong>【填写其他信息，如罐体温度、出料情况等】</p>"
        ),
    },
    {
        "id": "electrochemistry",
        "title": "电化学性能测试",
        "category": "表征",
        "description": "电池/超级电容器/电催化材料的电化学测试标准实验记录模板",
        "tags": ["electrochemistry", "battery", "characterization"],
        "content": (
            "<p><strong>实验目的：</strong>测试【材料名称】的【测试类型，如充放电/循环伏安/阻抗/EIS】性能，"
            "评估其作为【应用场景，如锂电正极/超电电极/电催化剂】的电化学表现。</p>"
            "<p><strong>电极制备：</strong></p><ul>"
            "<li>活性物质：【名称】，质量【填写】mg</li>"
            "<li>导电剂：【名称，如Super P/乙炔黑】，质量【填写】mg，比例【填写】%</li>"
            "<li>粘结剂：【名称，如PVDF/PTFE】，质量【填写】mg，比例【填写】%</li>"
            "<li>溶剂：【名称，如NMP】，用量【填写】</li>"
            "<li>集流体：【铝箔/铜箔/碳纸】，尺寸【填写】</li>"
            "<li>活性物质负载量：【填写】mg/cm²</li></ul>"
            "<p><strong>电解液：</strong>【名称及浓度，如1M LiPF6 in EC:DMC=1:1】</p>"
            "<p><strong>测试条件：</strong></p><ul>"
            "<li>电池组装方式：【扣式电池CR2032/三电极体系/Swagelok】</li>"
            "<li>对电极/参比电极：【Li片/Ag/AgCl/Pt】</li>"
            "<li>隔膜：【名称，如Celgard 2400】</li>"
            "<li>电压窗口：【填写】~【填写】V</li>"
            "<li>测试温度：【填写】°C</li></ul>"
            "<p><strong>测试项目：</strong></p><ul>"
            "<li>循环伏安（CV）：扫速【填写】mV/s</li>"
            "<li>恒流充放电：电流密度【填写】mA/g 或 C倍率【填写】</li>"
            "<li>交流阻抗（EIS）：频率范围【填写】Hz ~ 【填写】Hz</li>"
            "<li>循环寿命：循环次数【填写】</li></ul>"
            "<p><strong>备注：</strong>【填写其他信息】</p>"
        ),
    },
    {
        "id": "xrd",
        "title": "XRD 物相表征",
        "category": "表征",
        "description": "X射线衍射分析实验记录模板，用于物相鉴定和晶体结构分析",
        "tags": ["XRD", "characterization"],
        "content": (
            "<p><strong>实验目的：</strong>利用X射线衍射（XRD）分析【样品名称】的物相组成、晶体结构和结晶度。</p>"
            "<p><strong>样品信息：</strong></p><ul>"
            "<li>样品编号：【填写】</li>"
            "<li>样品来源：【合成/购买/处理后】</li>"
            "<li>样品形态：【粉末/块体/薄膜】</li>"
            "<li>制样方式：【平铺法/压片法/原片直接测试】</li></ul>"
            "<p><strong>测试参数：</strong></p><ul>"
            "<li>仪器型号：【填写，如 Bruker D8 Advance】</li>"
            "<li>靶材：Cu Kα（λ=1.5406 Å）/ Co / Mo</li>"
            "<li>管电压：【填写】kV，管电流：【填写】mA</li>"
            "<li>扫描范围 2θ：【填写】° ~ 【填写】°</li>"
            "<li>扫描步长：【填写】°，每步时间：【填写】s</li>"
            "<li>扫描模式：连续扫描 / 步进扫描</li></ul>"
            "<p><strong>数据处理与分析：</strong></p><ul>"
            "<li>物相检索数据库：PDF-2 / ICSD / COD</li>"
            "<li>主要衍射峰归属：【填写】</li>"
            "<li>晶粒尺寸计算（Scherrer公式）：【填写】</li>"
            "<li>结晶度估算：【填写】</li></ul>"
            "<p><strong>结论：</strong>【填写物相分析结果】</p>"
            "<p><strong>备注：</strong>【填写其他信息】</p>"
        ),
    },
    {
        "id": "perovskite-solar",
        "title": "钙钛矿太阳能电池制备",
        "category": "器件",
        "description": "钙钛矿太阳能电池完整制备流程，含各层旋涂与蒸镀工艺记录",
        "tags": ["thin-film", "solar-cell", "coating", "perovskite"],
        "content": (
            "<p><strong>实验目的：</strong>制备结构为【填写，如FTO/ETL/Perovskite/HTL/Au】的钙钛矿太阳能电池，"
            "优化【变量，如钙钛矿组分/退火条件/界面修饰】，提升光电转换效率。</p>"
            "<p><strong>材料：</strong></p><ul>"
            "<li>基底：【FTO/ITO玻璃】，尺寸【填写，如2×2 cm】，方阻【填写】Ω/sq</li>"
            "<li>电子传输层（ETL）：【如SnO2/TiO2/PCBM】，前驱体【填写】</li>"
            "<li>钙钛矿前驱体：【如PbI2+MAI/FAI/CsI】，配比【填写】，溶剂【DMF/DMSO】，浓度【填写】M</li>"
            "<li>空穴传输层（HTL）：【如Spiro-OMeTAD/PTAA】，浓度【填写】mg/mL</li>"
            "<li>电极：Au/Ag/C，厚度【填写】nm</li></ul>"
            "<p><strong>实验步骤：</strong></p><ol>"
            "<li>基底清洗：洗涤剂超声→去离子水→丙酮→异丙醇，各【填写】分钟</li>"
            "<li>UV-臭氧/等离子体处理【填写】分钟</li>"
            "<li>旋涂 ETL：【转速】rpm，【时间】s → 退火【温度】°C，【时间】min</li>"
            "<li>（如需要）进入手套箱</li>"
            "<li>旋涂钙钛矿层：【转速】rpm，【时间】s，滴加反溶剂【名称，如氯苯】，【时间】s</li>"
            "<li>退火：【温度】°C，【时间】min</li>"
            "<li>旋涂 HTL：【转速】rpm，【时间】s</li>"
            "<li>（如需）氧化处理：空气中放置【时间】h 或 O2 plasma</li>"
            "<li>蒸镀电极：厚度【填写】nm，速率【填写】Å/s</li></ol>"
            "<p><strong>器件性能测试（JV曲线）：</strong></p><ul>"
            "<li>光源：AM 1.5G，100 mW/cm²</li>"
            "<li>扫描方向：正向/反向</li>"
            "<li>有效面积：【填写】cm²</li>"
            "<li>Voc：【填写】V，Jsc：【填写】mA/cm²，FF：【填写】%，PCE：【填写】%</li></ul>"
            "<p><strong>表征计划：</strong>SEM截面 / XRD / PL / TRPL / UV-Vis吸收 / IPCE</p>"
            "<p><strong>备注：</strong>【填写其他信息】</p>"
        ),
    },
]
