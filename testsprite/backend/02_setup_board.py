import requests

BASE_URL = "https://app.hypertask.ai/api/mcp"
BOARD_TITLE = "TestSprite QA"
EXPECTED_USER_ID = 985


def test_setup_board() -> None:
    headers = {**__AUTH_HEADERS__}
    context = requests.get(f"{BASE_URL}/user/context", headers=headers, timeout=30)
    assert context.status_code == 200, f"GET /user/context expected 200, got {context.status_code}"
    body = context.json()
    assert body.get("success") is True
    assert body.get("user", {}).get("id") == EXPECTED_USER_ID
    assert body.get("connected_agent") is None

    board = next((p for p in body.get("projects", []) if p.get("title") == BOARD_TITLE), None)
    if board is None:
        teams = body.get("teams")
        assert isinstance(teams, list) and teams, "QA account has no team available for the isolated board"
        failures = []
        for team in teams:
            team_id = team.get("id")
            if not isinstance(team_id, str) or not team_id:
                continue
            created = requests.post(
                f"{BASE_URL}/teams/{team_id}/boards",
                headers={
                    **headers,
                    "Content-Type": "application/json",
                    "Idempotency-Key": f"testsprite-qa-board-v2-{team_id}",
                },
                json={
                    "title": BOARD_TITLE,
                    "description": "Dedicated production-safe board for TestSprite API verification.",
                    "sections": [{"title": "Backlog"}, {"title": "Done"}],
                    "labels": [{"name": "testsprite"}],
                    "tasks": [],
                },
                timeout=30,
            )
            if created.status_code == 200:
                created_body = created.json()
                assert created_body.get("success") is True
                board = created_body.get("board")
                assert isinstance(board, dict) and isinstance(board.get("id"), int)
                break
            failures.append(created.status_code)
        assert board is not None, f"POST /teams/:teamId/boards failed for all teams; statuses={failures}"

    assert isinstance(board.get("id"), int)
    assert board.get("title") == BOARD_TITLE


test_setup_board()
