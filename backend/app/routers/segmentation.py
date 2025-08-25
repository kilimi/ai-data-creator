from fastapi import APIRouter, Request, HTTPException
import base64
from urllib.parse import urlparse, urlunparse
import os

router = APIRouter()


@router.post('/segment')
async def proxy_segment(request: Request):
    """Proxy segmentation requests to the sam_service container.

    Accepts JSON body and forwards it to http://sam_service:8081/segment
    """
    body = await request.json()

    # If an imageUrl is present, try to fetch the image server-side and attach imageB64
    image_url = body.get('imageUrl') if isinstance(body, dict) else None
    if image_url:
        # Attempt to fetch the image; prefer async httpx in this async endpoint
        fetched = None
        try:
            import httpx
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    # First try the provided URL
                    resp = await client.get(image_url)
                    if resp.status_code == 200:
                        fetched = resp.content
            except Exception:
                # If direct fetch fails and URL looks like localhost, try container-internal port 8000
                parsed = urlparse(image_url)
                if parsed.hostname in ('localhost', '127.0.0.1'):
                    internal = parsed._replace(netloc=f'127.0.0.1:8000')
                    try:
                        async with httpx.AsyncClient(timeout=15.0) as client:
                            resp = await client.get(urlunparse(internal))
                            if resp.status_code == 200:
                                fetched = resp.content
                    except Exception:
                        pass
        except ModuleNotFoundError:
            # sync fallback
            try:
                import requests
                try:
                    resp = requests.get(image_url, timeout=15.0)
                    if resp.status_code == 200:
                        fetched = resp.content
                except Exception:
                    parsed = urlparse(image_url)
                    if parsed.hostname in ('localhost', '127.0.0.1'):
                        internal = parsed._replace(netloc=f'127.0.0.1:8000')
                        try:
                            resp = requests.get(urlunparse(internal), timeout=15.0)
                            if resp.status_code == 200:
                                fetched = resp.content
                        except Exception:
                            pass
            except Exception:
                # nothing we can do here
                fetched = None

        if fetched:
            try:
                body['imageB64'] = base64.b64encode(fetched).decode('ascii')
                # Remove imageUrl so the sam_service uses the provided image bytes
                body.pop('imageUrl', None)
            except Exception:
                pass

    sam_url = 'http://sam_service:8081/segment'

    # Try to use httpx if installed (async). If not, fall back to requests (sync) in a thread.
    try:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(sam_url, json=body)
                if resp.status_code >= 400:
                    raise HTTPException(status_code=resp.status_code, detail=resp.text)
                return resp.json()
        except Exception as e:
            # Convert connection/timeout errors into a 502 with the underlying message for easier debugging
            raise HTTPException(status_code=502, detail=f'Failed to reach sam service (httpx): {e}')
    except ModuleNotFoundError:
        # fallback to synchronous requests
        try:
            import requests
            resp = requests.post(sam_url, json=body, timeout=30.0)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f'Failed to reach sam service: {e}')

        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()
