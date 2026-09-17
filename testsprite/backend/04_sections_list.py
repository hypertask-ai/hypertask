import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
BOARD_ID = 5592


def test_sections_list() -> None:
    headers = {**__AUTH_HEADERS__}
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"limit": 100}, timeout=30)
    assert projects.status_code == 200
    board = next((item for item in projects.json().get("projects", []) if item.get("id") == BOARD_ID), None)
    assert board is not None and board.get("title") == "TestSprite QA" and board.get("ownerId") == 985

    response = requests.get(f"{BASE_URL}/projects/{BOARD_ID}/sections", headers=headers, timeout=30)
    assert response.status_code == 200, f"GET /projects/:id/sections expected 200, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    assert body.get("projectId") == BOARD_ID
    sections = body.get("sections")
    assert isinstance(sections, list)
    assert {item.get("section_title") for item in sections} >= {"Backlog", "Done"}


test_sections_list()
