import io
from pathlib import Path
from typing import Annotated

import anyio
import httpx
from docx import Document
from fastapi import Depends, HTTPException, status
from pypdf import PdfReader

from app.core.config import Settings, get_settings

SUPPORTED_DOCUMENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
}


def _extract_document(data: bytes, mime_type: str, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if mime_type == "application/pdf" or suffix == ".pdf":
        return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)
    if (
        mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or suffix == ".docx"
    ):
        document = Document(io.BytesIO(data))
        return "\n".join(paragraph.text for paragraph in document.paragraphs)
    return data.decode("utf-8", errors="strict")


async def extract_document(data: bytes, mime_type: str, filename: str) -> str:
    try:
        text = await anyio.to_thread.run_sync(_extract_document, data, mime_type, filename)
    except (UnicodeDecodeError, ValueError, OSError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Could not read the document") from exc
    text = "\n".join(line.rstrip() for line in text.splitlines()).strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The document contains no readable text")
    return text


class SupabaseStorage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def upload(self, bucket: str, path: str, data: bytes, mime_type: str) -> str:
        if not self.settings.supabase_url or not self.settings.supabase_service_role_key:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Supabase Storage is not configured",
            )
        url = f"{self.settings.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{path}"
        headers = {
            "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
            "apikey": self.settings.supabase_service_role_key,
            "Content-Type": mime_type,
            "x-upsert": "false",
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, headers=headers, content=data)
        if response.status_code >= 400:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Document storage upload failed")
        return path


def get_storage_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> SupabaseStorage:
    return SupabaseStorage(settings)


StorageDep = Annotated[SupabaseStorage, Depends(get_storage_service)]
