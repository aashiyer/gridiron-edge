from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.database import db_session
from backend.teams import team_meta
from backend.analysis import build_recommendation, cached_recommendation

router = APIRouter(prefix="/api/picks", tags=["picks"])


def _kickoff_passed(kickoff_time: Optional[str]) -> bool:
    if not kickoff_time:
        return False
    try:
        dt = datetime.fromisoformat(kickoff_time.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) >= dt
    except ValueError:
        return False


def _assert_game_open(conn, game_id: str):
    game = conn.execute("SELECT status, kickoff_time FROM games WHERE game_id = ?", (game_id,)).fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="game not found")
    if game["status"] != "scheduled" or _kickoff_passed(game["kickoff_time"]):
        raise HTTPException(status_code=409, detail="picks are locked once a game has kicked off")


class PickCreate(BaseModel):
    game_id: str
    pick_type: str
    selection: str
    line_at_pick_time: Optional[float] = None
    stake: Optional[float] = None
    notes: Optional[str] = None


class PickUpdate(BaseModel):
    selection: Optional[str] = None
    line_at_pick_time: Optional[float] = None
    stake: Optional[float] = None
    notes: Optional[str] = None


def _serialize_pick(row) -> dict:
    d = dict(row)
    if d.get("selection") in ("over", "under"):
        d["selection_meta"] = None
    else:
        try:
            d["selection_meta"] = team_meta(d["selection"])
        except Exception:
            d["selection_meta"] = None
    return d


@router.get("")
def list_picks(
    result: Optional[str] = None,
    pick_type: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    query = """
        SELECT p.*, g.season, g.week, g.home_team, g.away_team, g.kickoff_time,
               g.status, g.final_home_score, g.final_away_score
        FROM picks p
        JOIN games g ON g.game_id = p.game_id
        WHERE p.user_id = ?
    """
    params = [current_user["user_id"]]
    if result:
        query += " AND p.result = ?"
        params.append(result)
    if pick_type:
        query += " AND p.pick_type = ?"
        params.append(pick_type)
    query += " ORDER BY p.created_at DESC"

    with db_session() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_serialize_pick(r) for r in rows]


def _model_snapshot(game_id: str, pick_type: str, conn=None):
    """The model's own call on this game, frozen at pick time (not recomputed
    later) so the comparison doesn't drift as new signals (injuries, odds,
    FPI) come in after the pick is made. All three markets are comparable —
    straight_up/ats/total are graded against the model's own lean for that
    same market respectively, and they can genuinely differ (a team can be
    more likely to win than to cover, and the total lean is independent of
    both). Returns (lean, confidence, line)."""
    model_lean = model_confidence = model_line = None
    if pick_type not in ("straight_up", "ats", "total"):
        return model_lean, model_confidence, model_line
    try:
        rec = cached_recommendation(game_id, conn=conn)
        if rec and not rec.get("error"):
            if pick_type == "straight_up":
                model_lean = rec["lean_straight_up"]
                model_confidence = rec["confidence_straight_up"]
            elif pick_type == "ats":
                model_lean = rec["lean_ats"]
                model_confidence = rec["confidence_ats"]
            else:
                model_lean = rec["lean_total"]
                model_confidence = rec["confidence_total"]
            if pick_type == "total":
                model_line = rec["current_total"]
            elif rec["current_line"] is not None and model_lean == rec["away_team"]:
                model_line = -rec["current_line"]
            else:
                model_line = rec["current_line"]
    except Exception as e:
        print(f"Could not snapshot model recommendation for {game_id}: {e}")
    return model_lean, model_confidence, model_line


class PickSet(BaseModel):
    """Declare the desired state of one market on one game. `selection=None`
    means "no pick here" (i.e. remove it)."""

    game_id: str
    pick_type: str
    selection: Optional[str] = None
    line_at_pick_time: Optional[float] = None


@router.put("/set")
def set_pick(body: PickSet, current_user: dict = Depends(get_current_user)):
    """Idempotent "this is what I want this market to be" — the endpoint the
    Picker UI actually uses.

    Addressed by (user, game, pick_type) rather than by pick_id, which is
    what makes a truly optimistic frontend possible: the client can paint a
    pick instantly and fire this without first knowing whether a row exists
    or what its id is. The old create/update/delete-by-pick_id trio forced
    the UI to read its own writes before it could issue the next one — a
    rapid second click raced the refetch and could fire a create against a
    row that already existed (or a delete against an id that had changed).
    Declaring desired state has no such window: whatever lands last wins,
    and re-sending the same request twice is a no-op."""
    if body.selection is None:
        with db_session() as conn:
            _assert_game_open(conn, body.game_id)
            conn.execute(
                "DELETE FROM picks WHERE user_id = ? AND game_id = ? AND pick_type = ?",
                (current_user["user_id"], body.game_id, body.pick_type),
            )
        return {"game_id": body.game_id, "pick_type": body.pick_type, "selection": None}

    pick = PickCreate(
        game_id=body.game_id,
        pick_type=body.pick_type,
        selection=body.selection,
        line_at_pick_time=body.line_at_pick_time,
    )
    return create_pick(pick, current_user)


@router.post("")
def create_pick(pick: PickCreate, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    with db_session() as conn:
        model_lean, model_confidence, model_line = _model_snapshot(pick.game_id, pick.pick_type, conn=conn)
        initial_model_result = "pending" if model_lean else "n_a"
        _assert_game_open(conn, pick.game_id)
        conn.execute(
            """INSERT INTO picks (user_id, game_id, pick_type, selection, line_at_pick_time, stake, result, notes, created_at,
                                   model_lean, model_confidence, model_line, model_result)
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, game_id, pick_type) DO UPDATE SET
                   selection = excluded.selection,
                   line_at_pick_time = excluded.line_at_pick_time,
                   stake = excluded.stake,
                   result = 'pending',
                   notes = excluded.notes,
                   created_at = excluded.created_at,
                   model_lean = excluded.model_lean,
                   model_confidence = excluded.model_confidence,
                   model_line = excluded.model_line,
                   model_result = excluded.model_result""",
            (
                current_user["user_id"], pick.game_id, pick.pick_type, pick.selection, pick.line_at_pick_time,
                pick.stake, pick.notes, now, model_lean, model_confidence, model_line, initial_model_result,
            ),
        )
        row = conn.execute(
            "SELECT * FROM picks WHERE user_id = ? AND game_id = ? AND pick_type = ?",
            (current_user["user_id"], pick.game_id, pick.pick_type),
        ).fetchone()
    return _serialize_pick(row)


def _assert_owns_pick(conn, pick_id: int, user_id: int):
    pick = conn.execute("SELECT * FROM picks WHERE pick_id = ?", (pick_id,)).fetchone()
    if not pick:
        raise HTTPException(status_code=404, detail="pick not found")
    if pick["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="not your pick")
    return pick


@router.patch("/{pick_id}")
def update_pick(pick_id: int, update: PickUpdate, current_user: dict = Depends(get_current_user)):
    fields = {k: v for k, v in update.model_dump().items() if v is not None}
    changing_pick_itself = any(k in fields for k in ("selection", "line_at_pick_time", "stake"))
    with db_session() as conn:
        pick = _assert_owns_pick(conn, pick_id, current_user["user_id"])
        if changing_pick_itself:
            _assert_game_open(conn, pick["game_id"])
        if fields:
            set_clause = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE picks SET {set_clause} WHERE pick_id = ?", (*fields.values(), pick_id))
        row = conn.execute("SELECT * FROM picks WHERE pick_id = ?", (pick_id,)).fetchone()
    return _serialize_pick(row) if row else {"error": "not found"}


@router.delete("/{pick_id}")
def delete_pick(pick_id: int, current_user: dict = Depends(get_current_user)):
    with db_session() as conn:
        _assert_owns_pick(conn, pick_id, current_user["user_id"])
        conn.execute("DELETE FROM picks WHERE pick_id = ?", (pick_id,))
    return {"deleted": pick_id}


def _grade_pick(pick_row, game_row) -> Optional[str]:
    if game_row["status"] != "final" or game_row["final_home_score"] is None:
        return None
    home_score = game_row["final_home_score"]
    away_score = game_row["final_away_score"]
    pick_type = pick_row["pick_type"]
    selection = pick_row["selection"]
    line = pick_row["line_at_pick_time"]

    if pick_type == "straight_up":
        if home_score == away_score:
            return "push"
        winner = game_row["home_team"] if home_score > away_score else game_row["away_team"]
        return "win" if selection == winner else "loss"

    if pick_type == "ats":
        if line is None:
            return None
        if selection == game_row["home_team"]:
            margin = (home_score - away_score) + line
        elif selection == game_row["away_team"]:
            margin = (away_score - home_score) + line
        else:
            return None
        if margin > 0:
            return "win"
        if margin < 0:
            return "loss"
        return "push"

    if pick_type == "total":
        if line is None:
            return None
        actual_total = home_score + away_score
        if actual_total == line:
            return "push"
        if selection == "over":
            return "win" if actual_total > line else "loss"
        if selection == "under":
            return "win" if actual_total < line else "loss"

    return None


@router.post("/grade")
def grade_pending_picks():
    graded = []
    with db_session() as conn:
        pending = conn.execute(
            "SELECT * FROM picks WHERE result = 'pending' OR model_result = 'pending'"
        ).fetchall()
        for pick in pending:
            game = conn.execute("SELECT * FROM games WHERE game_id = ?", (pick["game_id"],)).fetchone()
            if not game:
                continue

            updates = {}
            if pick["result"] == "pending":
                outcome = _grade_pick(pick, game)
                if outcome:
                    updates["result"] = outcome

            if pick["model_result"] == "pending" and pick["model_lean"]:
                model_as_pick = {"pick_type": pick["pick_type"], "selection": pick["model_lean"], "line_at_pick_time": pick["model_line"]}
                model_outcome = _grade_pick(model_as_pick, game)
                if model_outcome:
                    updates["model_result"] = model_outcome

            if updates:
                set_clause = ", ".join(f"{k} = ?" for k in updates)
                conn.execute(f"UPDATE picks SET {set_clause} WHERE pick_id = ?", (*updates.values(), pick["pick_id"]))
                graded.append({"pick_id": pick["pick_id"], **updates})
    return {"graded": graded, "count": len(graded)}
