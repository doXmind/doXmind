"""Old app-managed images remain readable, but the legacy API cannot write."""

from config import get_settings


def test_legacy_image_route_is_byte_exact_and_read_only(sync_client):
    image_dir = get_settings().data_dir / "uploads" / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    image_path = image_dir / "legacy.png"
    original = b"\x89PNG\r\n\x1a\nlegacy\x00bytes"
    image_path.write_bytes(original)
    before_stat = image_path.stat()
    before_members = sorted(path.name for path in image_dir.iterdir())

    current = sync_client.get("/api/images/legacy.png")
    old_shape = sync_client.get("/api/images/old-user/legacy.png")

    assert current.status_code == 200
    assert current.content == original
    assert current.headers["content-type"] == "image/png"
    assert old_shape.status_code == 200
    assert old_shape.content == original

    assert sync_client.post("/api/images/upload", content=b"new").status_code == 405
    assert sync_client.delete("/api/images/legacy.png").status_code == 405
    assert image_path.read_bytes() == original
    assert image_path.stat().st_mtime_ns == before_stat.st_mtime_ns
    assert sorted(path.name for path in image_dir.iterdir()) == before_members


def test_legacy_image_route_does_not_create_storage(sync_client):
    image_dir = get_settings().data_dir / "uploads" / "images"
    if image_dir.exists():
        for path in image_dir.iterdir():
            if path.is_file():
                path.unlink()
        image_dir.rmdir()
        image_dir.parent.rmdir()

    response = sync_client.get("/api/images/missing.png")

    assert response.status_code == 404
    assert not image_dir.exists()
