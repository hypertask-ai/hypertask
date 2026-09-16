"""Expected failure: https://app.hypertask.ai/detail/project-15/6475"""
import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
TASK_TITLE = "TestSprite lifecycle updated"


def test_label_filter_expected_fail() -> None:
    headers = {**__AUTH_HEADERS__}
    projects = requests.get(f"{BASE_URL}/projects", headers=headers, params={"search": "TestSprite QA"}, timeout=30)
    assert projects.status_code == 200
    board = next(p for p in projects.json()["projects"] if p.get("title") == "TestSprite QA")
    label = next(item for item in board.get("labels", []) if item.get("name") == "testsprite")
    response = requests.get(
        f"{BASE_URL}/tasks",
        headers=headers,
        params=[("project_id", board["id"]), ("labels", label["id"]), ("status", "Normal")],
        timeout=30,
    )
    assert response.status_code == 200, f"GET /tasks?labels= expected 200, got {response.status_code}"
    body = response.json()
    assert body.get("success") is True
    assert isinstance(body.get("tasks"), list)
    assert any(task.get("title") == TASK_TITLE for task in body["tasks"]), (
        "expected-fail https://app.hypertask.ai/detail/project-15/6475: "
        "label-filtered task list omitted the labeled task"
    )


test_label_filter_expected_fail()
