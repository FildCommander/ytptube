import logging
import time
from datetime import UTC, datetime
from typing import Any

import httpx
from aiohttp import web
from aiohttp.web import Request, Response
from yt_dlp.utils.networking import random_user_agent

from app.library.cache import Cache
from app.library.config import Config
from app.library.router import add_route, route
from app.library.YTDLPOpts import YTDLPOpts

LOG: logging.Logger = logging.getLogger(__name__)

STATIC_FILES = ["README.md", "FAQ.md", "API.md", "sc_short.png"]
EXT_TO_MIME: dict = {
    ".md": "text/markdown",
    ".png": "image/png",
}


@route("GET", "api/docs/{file}", name="get_doc")
async def get_doc(request: Request, config: Config, cache: Cache) -> Response:
    """
    Get the thumbnail.

    Args:
        request (Request): The request object.
        config (Config): The configuration object.
        cache (Cache): The cache object.

    Returns:
        Response: The response object.

    """
    if not (file := request.path):
        return web.json_response(
            data={
                "error": "Doc file is is required.",
                "matcher": request.match_info,
            },
            status=web.HTTPForbidden.status_code,
        )

    file = file.removeprefix("/api/docs/") if file.startswith("/api/docs/") else file.removeprefix("/")
    if file not in STATIC_FILES:
        return web.json_response(
            data={
                "error": "Doc file not found.",
                "file": file,
                "st": STATIC_FILES,
            },
            status=web.HTTPNotFound.status_code,
        )

    cache_key = f"doc:{file}"
    if dct := cache.get(cache_key):
        LOG.debug(f"Serving doc '{file}' from cache.")
        return web.Response(**dct)

    url = f"https://raw.githubusercontent.com/arabcoders/ytptube/refs/heads/dev/{file}"

    try:
        ytdlp_args: dict = YTDLPOpts.get_instance().preset(name=config.default_preset).get_all()
        opts: dict[str, Any] = {
            "headers": {
                "User-Agent": request.headers.get("User-Agent", ytdlp_args.get("user_agent", random_user_agent())),
            },
        }
        if proxy := ytdlp_args.get("proxy"):
            opts["proxy"] = proxy

        try:
            from httpx_curl_cffi import AsyncCurlTransport, CurlOpt

            opts["transport"] = AsyncCurlTransport(
                impersonate="chrome",
                default_headers=True,
                curl_options={CurlOpt.FRESH_CONNECT: True},
            )
            opts.pop("headers", None)
        except Exception:
            pass

        async with httpx.AsyncClient(**opts) as client:
            LOG.debug(f"Fetching doc from '{url}'.")
            response = await client.request(method="GET", url=url, follow_redirects=True)
            dct = {
                "body": response.content,
                "headers": {
                    "Content-Type": EXT_TO_MIME.get(file[file.rfind(".") :], "text/plain"),
                    "Pragma": "public",
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": f"public, max-age={time.time() + 3600}",
                    "Expires": time.strftime(
                        "%a, %d %b %Y %H:%M:%S GMT",
                        datetime.fromtimestamp(time.time() + 3600, tz=UTC).timetuple(),
                    ),
                },
            }

            cache.set(cache_key, dct, ttl=3600)

            return web.Response(**dct)
    except Exception as e:
        LOG.error(f"Failed to request doc from '{url}'.'. '{e!s}'.")
        return web.json_response(data={"error": "Failed to get doc."}, status=web.HTTPInternalServerError.status_code)


for file in STATIC_FILES:
    add_route(
        method="GET",
        path=f"{file}",
        handler=get_doc,
        name=f"get_{file.replace('.', '_')}",
    )
