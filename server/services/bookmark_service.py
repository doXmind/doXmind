"""
Bookmark service for URL metadata extraction (unfurling).
"""

import ipaddress
import logging
import socket
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Private/reserved IP networks that should never be accessed via unfurling
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def _is_private_host(hostname: str) -> bool:
    """Check if a hostname resolves to a private/reserved IP address."""
    try:
        addr_infos = socket.getaddrinfo(hostname, None)
        for _, _, _, _, sockaddr in addr_infos:
            ip = ipaddress.ip_address(sockaddr[0])
            if any(ip in network for network in _BLOCKED_NETWORKS):
                return True
    except (socket.gaierror, ValueError):
        # DNS resolution failed — allow the request; httpx will handle the error
        return False
    return False


class BookmarkMetadata(BaseModel):
    url: str
    title: str
    description: str | None = None
    favicon_url: str | None = None
    image_url: str | None = None


async def unfurl_url(url: str) -> BookmarkMetadata:
    """Fetch and extract metadata from a URL."""
    # Ensure URL has a scheme
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    # SSRF protection: block requests to private/internal networks
    parsed_check = urlparse(url)
    hostname = parsed_check.hostname or ""
    if _is_private_host(hostname):
        logger.warning("Blocked unfurl request to private host: %s", hostname)
        return BookmarkMetadata(url=url, title=hostname or url)

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
            follow_redirects=True,
            max_redirects=5,
            headers={
                "User-Agent": ("Mozilla/5.0 (compatible; DoXmind/1.0; +https://doxmind.com)"),
                "Accept": "text/html,application/xhtml+xml",
            },
        ) as client:
            response = await client.get(url)
            response.raise_for_status()

            # Post-redirect SSRF check: verify final destination isn't private
            if response.url.scheme not in ("http", "https"):
                logger.warning("Blocked unfurl after redirect to non-HTTP scheme: %s", response.url)
                return BookmarkMetadata(url=url, title=parsed_check.netloc or url)
            final_host = response.url.host or ""
            if _is_private_host(final_host):
                logger.warning("Blocked unfurl after redirect to private host: %s", final_host)
                return BookmarkMetadata(url=url, title=parsed_check.netloc or url)
    except Exception:
        logger.warning("Failed to unfurl URL %s", url, exc_info=True)
        parsed = urlparse(url)
        return BookmarkMetadata(
            url=url,
            title=parsed.netloc or url,
        )

    content_type = response.headers.get("content-type", "")
    if "text/html" not in content_type and "application/xhtml" not in content_type:
        parsed = urlparse(url)
        return BookmarkMetadata(
            url=url,
            title=parsed.path.split("/")[-1] or parsed.netloc,
        )

    soup = BeautifulSoup(response.text, "html.parser")

    # Title: og:title > twitter:title > <title> > URL
    title = _get_meta(soup, "og:title") or _get_meta(soup, "twitter:title")
    if not title:
        title_tag = soup.find("title")
        title = title_tag.get_text(strip=True) if title_tag else None
    if not title:
        title = urlparse(url).netloc

    # Description: og:description > twitter:description > meta description
    description = (
        _get_meta(soup, "og:description")
        or _get_meta(soup, "twitter:description")
        or _get_meta_name(soup, "description")
    )

    # Image: og:image > twitter:image
    image_url = _get_meta(soup, "og:image") or _get_meta(soup, "twitter:image")
    if image_url and not image_url.startswith("http"):
        image_url = urljoin(url, image_url)

    # Favicon: <link rel="icon"> or fallback /favicon.ico
    favicon_url = _get_favicon(soup, url)

    return BookmarkMetadata(
        url=url,
        title=title,
        description=description,
        favicon_url=favicon_url,
        image_url=image_url,
    )


def _get_meta(soup: BeautifulSoup, property_name: str) -> str | None:
    """Get content from <meta property="..."> tag."""
    tag = soup.find("meta", attrs={"property": property_name})
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


def _get_meta_name(soup: BeautifulSoup, name: str) -> str | None:
    """Get content from <meta name="..."> tag."""
    tag = soup.find("meta", attrs={"name": name})
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


def _get_favicon(soup: BeautifulSoup, url: str) -> str:
    """Extract favicon URL from HTML or fall back to /favicon.ico."""
    for rel in (["icon"], ["shortcut", "icon"], ["apple-touch-icon"]):
        link = soup.find("link", rel=rel)
        if link and link.get("href"):
            href = link["href"]
            if not href.startswith("http"):
                href = urljoin(url, href)
            return href

    # Fallback to /favicon.ico
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
