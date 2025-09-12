import asyncio
import logging
import time

from aiohttp import web
from aiohttp.web import Request, Response
from aiohttp.web_runner import GracefulExit

from app.library.config import Config
from app.library.DownloadQueue import DownloadQueue
from app.library.encoder import Encoder
from app.library.Events import EventBus, Events
from app.library.router import route

LOG: logging.Logger = logging.getLogger(__name__)


@route("POST", "api/system/pause", "system.pause")
async def downloads_pause(queue: DownloadQueue, encoder: Encoder, notify: EventBus) -> Response:
    """
    Pause non-active downloads.

    Args:
        request (Request): The request object.
        queue (DownloadQueue): The download queue instance.
        encoder (Encoder): The encoder instance.
        notify (EventBus): The event bus instance.

    Returns:
        Response: The response object.

    """
    if queue.is_paused():
        return web.json_response(
            {"message": "Non-active downloads are already paused."},
            status=web.HTTPNotAcceptable.status_code,
            dumps=encoder.encode,
        )

    queue.pause()

    msg = "Non-active downloads have been paused."
    notify.emit(
        Events.PAUSED,
        data={"paused": True, "at": time.time()},
        title="Downloads Paused",
        message=msg,
    )

    return web.json_response(data={"message": msg}, status=web.HTTPOk.status_code, dumps=encoder.encode)


@route("POST", "api/system/resume", "system.resume")
async def downloads_resume(queue: DownloadQueue, encoder: Encoder, notify: EventBus) -> Response:
    """
    Resume non-active downloads.

    Args:
        request (Request): The request object.
        queue (DownloadQueue): The download queue instance.
        encoder (Encoder): The encoder instance.
        notify (EventBus): The event bus instance.

    Returns:
        Response: The response object.

    """
    if not queue.is_paused():
        return web.json_response(
            {"message": "Non-active downloads are not paused."},
            status=web.HTTPNotAcceptable.status_code,
            dumps=encoder.encode,
        )

    queue.resume()

    msg = "Resumed all downloads."
    notify.emit(
        Events.RESUMED,
        data={"paused": False, "at": time.time()},
        title="Downloads Resumed",
        message=msg,
    )

    return web.json_response(data={"message": msg}, status=web.HTTPOk.status_code, dumps=encoder.encode)


@route("POST", "api/system/shutdown", "system.shutdown")
async def shutdown_system(request: Request, config: Config, encoder: Encoder, notify: EventBus) -> Response:
    """
    Initiate application shutdown.

    Args:
        request (Request): The request object.
        config (Config): The config instance.
        encoder (Encoder): The encoder instance.
        notify (EventBus): The event bus instance.

    Returns:
        Response: The response object.

    """
    if config.is_native is not True:
        return web.json_response(
            {"error": "Shutdown is only available in the native mode."},
            status=web.HTTPBadRequest.status_code,
        )

    app = request.app

    async def do_shutdown():
        notify.emit(
            Events.SHUTDOWN,
            data={"app": app},
            title="Application Shutdown",
            message="Shutdown initiated by user request.",
        )
        await asyncio.sleep(0.5)
        await app.shutdown()
        await app.cleanup()
        raise GracefulExit

    # Schedule shutdown after response
    asyncio.create_task(do_shutdown())
    LOG.info("Shutdown initiated by user request. Stopping the server...")
    return web.json_response(
        data={
            "message": "The application shutting down.",
        },
        status=web.HTTPOk.status_code,
        dumps=encoder.encode,
    )
