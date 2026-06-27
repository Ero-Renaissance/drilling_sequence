"""Client-log ingestion: the happy path plus hostile-input rejection.

The endpoint's only authorization is "must be authenticated" (the standard
`get_current_user` dependency, exercised by every other test via the `client`
fixture), so the security surface worth pinning down here is input validation.
"""


async def test_accepts_an_error_event(client):
    resp = await client.post(
        "/api/client-logs",
        json={
            "level": "error",
            "message": "React render error",
            "context": {"name": "TypeError", "status": 500},
        },
    )
    assert resp.status_code == 204
    assert resp.content == b""


async def test_level_defaults_to_error(client):
    resp = await client.post("/api/client-logs", json={"message": "boom"})
    assert resp.status_code == 204


async def test_rejects_empty_message(client):
    resp = await client.post("/api/client-logs", json={"message": ""})
    assert resp.status_code == 422


async def test_rejects_unknown_level(client):
    resp = await client.post(
        "/api/client-logs", json={"level": "fatal", "message": "x"}
    )
    assert resp.status_code == 422


async def test_rejects_overlong_message(client):
    resp = await client.post("/api/client-logs", json={"message": "x" * 2001})
    assert resp.status_code == 422


async def test_rejects_extra_top_level_fields(client):
    resp = await client.post(
        "/api/client-logs", json={"message": "x", "evil": "injected"}
    )
    assert resp.status_code == 422


async def test_rejects_nested_context_value(client):
    # Context values must be scalars; a nested object is oversized/hostile input.
    resp = await client.post(
        "/api/client-logs",
        json={"message": "x", "context": {"k": {"nested": "obj"}}},
    )
    assert resp.status_code == 422
