import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
BOARD_ID = 5592
BOARD_TITLE = "TestSprite QA"
OWNER_ID = 985


def test_setup_board() -> None:
    response = requests.get(
        f"{BASE_URL}/projects",
        headers={**__AUTH_HEADERS__},
        params={"status": "Normal", "limit": 100},
        timeout=30,
    )
    assert response.status_code == 200, f"GET /projects expected 200, got {response.status_code}"
    board = next((item for item in response.json().get("projects", []) if item.get("id") == BOARD_ID), None)
    assert board is not None, f"Dedicated TestSprite board {BOARD_ID} is unavailable"
    assert board.get("title") == BOARD_TITLE
    assert board.get("ownerId") == OWNER_ID
    assert any(label.get("name") == "testsprite" for label in board.get("labels", []))


test_setup_board()
