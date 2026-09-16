import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"


def board_id(headers):
    response = requests.get(f"{BASE_URL}/projects", headers=headers, params={"search": "TestSprite QA"}, timeout=30)
    assert response.status_code == 200
    board = next((p for p in response.json().get("projects", []) if p.get("title") == "TestSprite QA"), None)
    assert board is not None
    return board["id"]


def test_sections_list() -> None:
    headers = {**__AUTH_HEADERS__}
    project_id = board_id(headers)
    response = requests.get(f"{BASE_URL}/projects/{project_id}/sections", headers=headers, timeout=30)
    assert response.status_code == 200, f"GET /projects/:id/sections expected 200, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    assert body.get("projectId") == project_id
    assert isinstance(body.get("sections"), list)
    names = {section.get("section_title") for section in body["sections"]}
    assert {"Backlog", "Done"}.issubset(names)
    for section in body["sections"]:
        assert isinstance(section.get("id"), int)
        assert isinstance(section.get("taskCount"), int)


test_sections_list()
