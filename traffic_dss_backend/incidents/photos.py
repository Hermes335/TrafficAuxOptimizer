"""Decode and sanitize incident photos before storing them outside public media."""
from io import BytesIO
import warnings
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import ValidationError


MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_PHOTO_PIXELS = 20_000_000


def private_photo_storage():
    return FileSystemStorage(location=settings.PRIVATE_MEDIA_ROOT)


def legacy_photo_name(url):
    """Accept only historical local incident uploads, never URLs or traversal."""
    parsed = urlsplit(url or "")
    prefix = settings.MEDIA_URL
    if parsed.scheme or parsed.netloc or not parsed.path.startswith(prefix):
        return None
    name = unquote(parsed.path[len(prefix):])
    path = PurePosixPath(name)
    if not name.startswith("incident-photos/") or "\\" in name or ".." in path.parts or path.is_absolute():
        return None
    return name


def sanitize_photo(upload):
    """Return image bytes and a trusted suffix, never the uploaded filename."""
    if upload.size > MAX_PHOTO_BYTES:
        raise ValidationError({"photo": "Choose a photo smaller than 5 MB."})
    raw = upload.read(MAX_PHOTO_BYTES + 1)
    if len(raw) > MAX_PHOTO_BYTES:
        raise ValidationError({"photo": "Choose a photo smaller than 5 MB."})
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as source:
                if source.format not in {"JPEG", "PNG"}:
                    raise ValidationError({"photo": "Choose a JPEG or PNG photo."})
                if source.width * source.height > MAX_PHOTO_PIXELS:
                    raise ValidationError({"photo": "Choose a photo with no more than 20 megapixels."})
                source.load()
                oriented = ImageOps.exif_transpose(source)
                # Copy pixels onto a clean image to discard EXIF/GPS, text chunks,
                # profiles, and other metadata rather than trusting file headers.
                transparent = "A" in oriented.getbands() or "transparency" in oriented.info
                mode = "RGBA" if transparent else "RGB"
                clean = Image.new(mode, oriented.size)
                clean.paste(oriented.convert(mode))
                output = BytesIO()
                if transparent:
                    clean.save(output, "PNG", optimize=True)
                    return output.getvalue(), ".png"
                clean.save(output, "JPEG", quality=85, optimize=True)
                return output.getvalue(), ".jpg"
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError,
            Image.DecompressionBombWarning):
        raise ValidationError({"photo": "The photo could not be read. Choose a valid JPEG or PNG image."})
