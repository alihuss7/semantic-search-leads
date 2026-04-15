import asyncio
import google.generativeai as genai

from config import settings

genai.configure(api_key=settings.google_ai_api_key)

LEAD_FIELDS = [
    "Lead ID", "Project", "Create Date", "Lead Source",
    "Registration Comments", "Contact Status", "Lead Status",
]

SYSTEM_PROMPT = (
    "You are a lead intelligence analyst. Given structured data about a sales lead, "
    "write a concise 2-3 sentence narrative that summarizes who this lead is, where they came from, "
    "what they are interested in, and what stage they are at in the sales process. "
    "Explicitly assess how strongly they intend to buy (High, Medium, or Low buying intent) "
    "and cite the strongest concrete signals from the input data. "
    "Be factual and professional. Do not invent information not present in the data."
)


def _format_row(row: dict) -> str:
    lines = []
    for field in LEAD_FIELDS:
        value = str(row.get(field, "")).strip()
        if value:
            lines.append(f"{field}: {value}")
    for key, value in row.items():
        if key not in LEAD_FIELDS and str(value).strip():
            lines.append(f"{key}: {value}")
    return "\n".join(lines)


def _synthesize_sync(formatted: str) -> str:
    model = genai.GenerativeModel(
        model_name=settings.google_text_model,
        system_instruction=SYSTEM_PROMPT,
    )
    response = model.generate_content(f"Synthesize this lead into a narrative:\n\n{formatted}")
    return response.text.strip()


async def synthesize_story(row: dict, semaphore: asyncio.Semaphore) -> str:
    formatted = _format_row(row)
    loop = asyncio.get_event_loop()
    async with semaphore:
        return await loop.run_in_executor(None, _synthesize_sync, formatted)


async def synthesize_stories(rows: list[dict], batch_size: int = 10) -> list[str]:
    semaphore = asyncio.Semaphore(batch_size)
    return await asyncio.gather(*[synthesize_story(row, semaphore) for row in rows])
