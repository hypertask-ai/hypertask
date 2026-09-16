import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
EXPECTED_USER_ID = 985


def test_status_and_me() -> None:
    hello = requests.get(f"{BASE_URL}/hello", headers={**__AUTH_HEADERS__}, timeout=30)
    assert hello.status_code == 200, f"GET /hello expected 200, got {hello.status_code}"
    hello_body = hello.json()
    assert hello_body.get("success") is True
    assert isinstance(hello_body.get("user"), dict)
    assert isinstance(hello_body.get("boards"), list)
    assert isinstance(hello_body.get("capabilities"), dict)

    me = requests.get(f"{BASE_URL}/user/context", headers={**__AUTH_HEADERS__}, timeout=30)
    assert me.status_code == 200, f"GET /user/context expected 200, got {me.status_code}"
    me_body = me.json()
    assert me_body.get("success") is True
    assert isinstance(me_body.get("user"), dict)
    assert me_body["user"].get("id") == EXPECTED_USER_ID
    assert me_body.get("connected_agent") is None
    assert isinstance(me_body.get("teams"), list)
    assert isinstance(me_body.get("projects"), list)


test_status_and_me()
