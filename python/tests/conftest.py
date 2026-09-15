"""Shared pytest fixtures."""

import pytest

from http_mock import start_server


@pytest.fixture
def server_factory():
    """Start mock HTTP servers; returns ``(httpd, url)`` and shuts them down after the test."""
    servers = []

    def start(responder, path: str = "/v1/responses"):
        httpd, base = start_server(responder)
        servers.append(httpd)
        return httpd, f"{base}{path}"

    yield start

    for httpd in servers:
        httpd.shutdown()
        httpd.server_close()
