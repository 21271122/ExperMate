from lib.core.prompts import ANALYSIS_SYSTEM_PROMPT


def analyze_experiments(summary_text: str, question: str, llm_client) -> str:
    user_prompt = f"""EXPERIMENT RECORDS:
{summary_text}

RESEARCHER'S QUESTION: {question}

Please analyze the above experiments. Focus on the researcher's stated
question. Use only the analysis dimensions that are relevant. Omit
sections that don't apply.

Structure your response in exactly three sections as specified in the
system prompt: 事实呈现, 发现提示, 值得思考的问题."""
    return llm_client.analyze(ANALYSIS_SYSTEM_PROMPT, user_prompt)
