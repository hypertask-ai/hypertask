import time
import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
TASK_TITLE = "TestSprite lifecycle updated"


def test_task_search() -> None:
    headers = {**__AUTH_HEADERS__}
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"search": "TestSprite QA"}, timeout=30)
    assert projects.status_code == 200
    board = next(p for p in projects.json()["projects"] if p.get("title") == "TestSprite QA")

    response = None
    found = None
    for _ in range(6):
        response = requests.get(
            f"{BASE_URL}/tasks/search",
            headers=headers,
            params={"q": TASK_TITLE, "project_id": board["id"], "limit": 10},
            timeout=30,
        )
        assert response.status_code == 200, f"GET /tasks/search expected 200, got {response.status_code}"
        body = response.json()
        assert body.get("success") is True
        assert isinstance(body.get("tasks"), list)
        assert isinstance(body.get("total"), int)
        found = next((task for task in body["tasks"] if task.get("title") == TASK_TITLE), None)
        if found is not None:
            break
        time.sleep(2)
    assert found is not None, "search did not return the newly updated TestSprite task"
    assert found.get("projectId") == board["id"]
    assert found.get("section") == "Done"


test_task_search()
