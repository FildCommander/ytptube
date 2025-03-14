import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

from .config import Config
from .encoder import Encoder
from .EventsSubscriber import Events
from .ItemDTO import ItemDTO
from .Singleton import Singleton
from .Utils import ag, validate_uuid
from .version import APP_VERSION

LOG = logging.getLogger("notifications")


@dataclass(kw_only=True)
class TargetRequestHeader:
    """Request header details for a notification target."""

    key: str
    value: str

    def serialize(self) -> dict:
        return {"key": self.key, "value": self.value}

    def json(self) -> str:
        return Encoder().encode(self.serialize())

    def get(self, key: str, default: Any = None) -> Any:
        return self.serialize().get(key, default)


@dataclass(kw_only=True)
class TargetRequest:
    """Request details for a notification target."""

    type: str
    method: str
    url: str
    headers: list[TargetRequestHeader] = field(default_factory=list)

    def serialize(self) -> dict:
        return {
            "type": self.type,
            "method": self.method,
            "url": self.url,
            "headers": [h.serialize() for h in self.headers],
        }

    def json(self) -> str:
        return Encoder().encode(self.serialize())

    def get(self, key: str, default: Any = None) -> Any:
        return ag(self.serialize(), key, default)


@dataclass(kw_only=True)
class Target:
    """Notification target details."""

    id: str
    name: str
    on: list[str]
    request: TargetRequest

    def serialize(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "on": self.on,
            "request": self.request.serialize(),
        }

    def json(self) -> str:
        return Encoder().encode(self.serialize())

    def get(self, key: str, default: Any = None) -> Any:
        return self.serialize().get(key, default)


class NotificationEvents:
    ADDED = Events.ADDED
    COMPLETED = Events.COMPLETED
    ERROR = Events.ERROR
    CANCELLED = Events.CANCELLED
    CLEARED = Events.CLEARED
    LOG_INFO = Events.LOG_INFO
    LOG_SUCCESS = Events.LOG_SUCCESS
    TEST = Events.TEST

    @staticmethod
    def get_events() -> dict[str, str]:
        return {k: v for k, v in vars(NotificationEvents).items() if not k.startswith("__") and not callable(v)}

    @staticmethod
    def is_valid(event: str) -> bool:
        return event in NotificationEvents.get_events().values()


class Notification(metaclass=Singleton):
    _targets: list[Target] = []
    """Notification targets to send events to."""

    _instance = None
    """The instance of the Notification class."""

    def __init__(
        self,
        file: str | None = None,
        client: httpx.AsyncClient | None = None,
        encoder: Encoder | None = None,
        config: Config | None = None,
    ):
        Notification._instance = self
        config: Config = config or Config.get_instance()

        self._debug = config.debug
        self._file: str = file or os.path.join(config.config_path, "notifications.json")
        self._client: httpx.AsyncClient = client or httpx.AsyncClient()
        self._encoder: Encoder = encoder or Encoder()

        if os.path.exists(self._file):
            try:
                if "600" != oct(os.stat(self._file).st_mode)[-3:]:
                    os.chmod(self._file, 0o600)
            except Exception:
                pass

            if os.path.getsize(self._file) > 10:
                self.load()

    @staticmethod
    def get_instance() -> "Notification":
        if Notification._instance is None:
            Notification._instance = Notification()

        return Notification._instance

    def get_targets(self) -> list[Target]:
        """Get the list of notification targets."""
        return self._targets

    def clear(self) -> "Notification":
        """Clear the list of notification targets."""
        self._targets.clear()
        return self

    def save(self, targets: list[Target]) -> "Notification":
        """
        Save notification targets to the file.

        Args:
            targets (list[Target]|None): The list of targets to save.

        Returns:
            Notification: The Notification instance.

        """
        LOG.info(f"Saving notification targets to '{self._file}'.")
        try:
            with open(self._file, "w") as f:
                json.dump([t.serialize() for t in targets], fp=f, indent=4)
        except Exception as e:
            LOG.exception(e)
            LOG.error(f"Error saving notification targets to '{self._file}'. '{e!s}'")

        return self

    def load(self) -> "Notification":
        """Load or reload notification targets from the file."""
        if len(self._targets) > 0:
            LOG.info("Clearing existing notification targets.")
            self.clear()

        if not os.path.exists(self._file) or os.path.getsize(self._file) < 10:
            return self

        targets = []

        LOG.info(f"Loading notification targets from '{self._file}'.")

        try:
            with open(self._file) as f:
                targets = json.load(f)
        except Exception as e:
            LOG.error(f"Error loading notification targets from '{self._file}'. '{e!s}'")

        for target in targets:
            try:
                try:
                    Notification.validate(target)
                except ValueError as e:
                    LOG.error(f"Invalid notification target '{target}'. '{e!s}'")
                    continue

                target = self.make_target(target)

                self._targets.append(target)

                LOG.info(
                    f"Will send '{target.on if len(target.on) > 0 else 'all'}' as {target.request.type} notification events to '{target.name}'."
                )
            except Exception as e:
                LOG.error(f"Error loading notification target '{target}'. '{e!s}'")

        return self

    @staticmethod
    def validate(target: Target | dict) -> bool:
        """
        Validate a notification target.

        Args:
            target (Target|dict): The target to validate.

        Returns:
            bool: True if the target is valid, False otherwise.

        """
        if not isinstance(target, dict):
            target = target.serialize()

        if "id" not in target or validate_uuid(target["id"], version=4) is False:
            msg = "Invalid notification target. No ID found."
            raise ValueError(msg)

        if "name" not in target:
            msg = "Invalid notification target. No name found."
            raise ValueError(msg)

        if "request" not in target:
            msg = "Invalid notification target. No request details found."
            raise ValueError(msg)

        if "url" not in target["request"]:
            msg = "Invalid notification target. No URL found."
            raise ValueError(msg)

        if "method" in target["request"] and target["request"]["method"].upper() not in ["POST", "PUT"]:
            msg = "Invalid notification target. Invalid method found."
            raise ValueError(msg)

        if "type" in target["request"] and target["request"]["type"].lower() not in ["json", "form"]:
            msg = "Invalid notification target. Invalid type found."
            raise ValueError(msg)

        if "on" in target:
            if not isinstance(target["on"], list):
                msg = "Invalid notification target. Invalid 'on' event list found."
                raise ValueError(msg)

            for e in target["on"]:
                if e not in NotificationEvents.get_events().values():
                    msg = f"Invalid notification target. Invalid event '{e}' found."
                    raise ValueError(msg)

        if "headers" in target["request"]:
            if not isinstance(target["request"]["headers"], list):
                msg = "Invalid notification target. Invalid headers list found."
                raise ValueError(msg)

            for h in target["request"]["headers"]:
                if "key" not in h:
                    msg = "Invalid notification target. No header key found."
                    raise ValueError(msg)
                if "value" not in h:
                    msg = "Invalid notification target. No header value found."
                    raise ValueError(msg)

        return True

    async def send(self, event: str, item: ItemDTO | dict) -> list[dict]:
        if len(self._targets) < 1:
            return []

        if not isinstance(item, ItemDTO) and not isinstance(item, dict):
            LOG.debug(f"Received invalid item type '{type(item)}' with event '{event}'.")
            return []

        tasks = []

        for target in self._targets:
            if len(target.on) > 0 and event not in target.on and "test" != event:
                continue

            tasks.append(self._send(event, target, item))

        return await asyncio.gather(*tasks)

    async def _send(self, event: str, target: Target, item: ItemDTO | dict) -> dict:
        try:
            itemId = item.get("id", item.get("_id", "??"))
        except Exception:
            itemId = "??"

        try:
            LOG.info(f"Sending Notification event '{event}' id '{itemId}' to '{target.name}'.")
            reqBody = {
                "method": target.request.method.upper(),
                "url": target.request.url,
                "headers": {
                    "User-Agent": f"YTPTube/{APP_VERSION}",
                    "Content-Type": "application/json"
                    if "json" == target.request.type.lower()
                    else "application/x-www-form-urlencoded",
                },
            }

            if len(target.request.headers) > 0:
                for h in target.request.headers:
                    reqBody["headers"][h.key] = h.value

            reqBody["json" if "json" == target.request.type.lower() else "data"] = {
                "event": event,
                "created_at": datetime.now(tz=UTC).isoformat(),
                "payload": item.__dict__ if isinstance(item, ItemDTO) else item,
            }

            if "form" == target.request.type.lower():
                reqBody["data"]["payload"] = self._encoder.encode(reqBody["data"]["payload"])

            response = await self._client.request(**reqBody)

            respData = {"url": target.request.url, "status": response.status_code, "text": response.text}

            msg = f"Notification target '{target.name}' Responded to event '{event}' id '{itemId}' with status '{response.status_code}'."
            if self._debug and respData.get("text"):
                msg += f" body '{respData.get('text','??')}'."

            LOG.info(msg)

            return respData
        except Exception as e:
            LOG.error(f"Error sending Notification event '{event}' id '{itemId}' to '{target.name}'. '{e}'.")
            return {"url": target.request.url, "status": 500, "text": str(e)}

    def make_target(self, target: dict) -> Target:
        """
        Make a notification target from a dictionary.

        Args:
            target (dict): The target details.

        Returns:
            Target: The notification target.

        """
        return Target(
            id=target.get("id"),
            name=target.get("name"),
            on=target.get("on", []),
            request=TargetRequest(
                type=target.get("request", {}).get("type", "json"),
                method=target.get("request", {}).get("method", "POST"),
                url=target.get("request", {}).get("url"),
                headers=[
                    TargetRequestHeader(
                        key=str(h.get("key", "")).strip(),
                        value=str(h.get("value", "")).strip(),
                    )
                    for h in target.get("request", {}).get("headers", [])
                ],
            ),
        )

    def emit(self, event, data, **kwargs):  # noqa: ARG002
        if len(self._targets) < 1:
            return False

        if not NotificationEvents.is_valid(event):
            return False

        return self.send(event, data)
