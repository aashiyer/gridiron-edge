"""Train a logistic regression to predict ATS cover probability, using the
same signals the live heuristic computes (backend/features.py) — including
roster-continuity-weighted long-run form — and backtest it on a held-out
season.

This does NOT replace the "Edge" heuristic; it's a second, independently-
fit opinion. build_recommendation() loads the saved model (if present) and
adds its predicted probability as one more signal alongside the rest.

Usage:
    python -m scripts.train_ats_model                    # train on <=2024, test on 2025
    python -m scripts.train_ats_model --test-season 2024  # different split
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from backend.database import db_session
from backend.features import extract_features, ats_label, FEATURE_NAMES

MODEL_PATH = Path(__file__).resolve().parent.parent / "data" / "ats_model.joblib"


def build_dataset(conn, min_season: int, max_season: int):
    games = conn.execute(
        """
        SELECT * FROM games
        WHERE status = 'final' AND home_spread_close IS NOT NULL
          AND season >= ? AND season <= ?
        ORDER BY kickoff_time ASC
        """,
        (min_season, max_season),
    ).fetchall()

    X, y, seasons, game_ids = [], [], [], []
    for g in games:
        label = ats_label(g)
        if label is None:
            continue
        feats = extract_features(conn, g)
        X.append([feats[name] for name in FEATURE_NAMES])
        y.append(label)
        seasons.append(g["season"])
        game_ids.append(g["game_id"])
    return np.array(X, dtype=float), np.array(y, dtype=int), np.array(seasons), game_ids


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-start", type=int, default=2021)
    parser.add_argument("--test-season", type=int, default=2025)
    args = parser.parse_args()

    with db_session() as conn:
        print(f"Building feature set for seasons {args.train_start}-{args.test_season}...")
        X, y, seasons, _ = build_dataset(conn, args.train_start, args.test_season)

    train_mask = seasons < args.test_season
    test_mask = seasons == args.test_season
    X_train, y_train = X[train_mask], y[train_mask]
    X_test, y_test = X[test_mask], y[test_mask]
    print(f"Train: {len(y_train)} games ({args.train_start}-{args.test_season - 1}). Test: {len(y_test)} games ({args.test_season}).")

    if len(y_train) < 50 or len(y_test) < 10:
        print("Not enough data to train/test reliably. Backfill more seasons first.")
        return

    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, C=1.0))
    model.fit(X_train, y_train)

    train_acc = model.score(X_train, y_train)
    test_acc = model.score(X_test, y_test)
    print(f"\nTraining accuracy: {train_acc:.1%}")
    print(f"Test accuracy ({args.test_season}): {test_acc:.1%}  <- this is effectively ATS win rate if you bet the model's side every game")
    print(f"Break-even at standard -110 vig: 52.4%")

    always_home_acc = (y_test == 1).mean()
    print(f"(Baseline — always pick home to cover: {always_home_acc:.1%})")

    logreg = model.named_steps["logisticregression"]
    coefs = sorted(zip(FEATURE_NAMES, logreg.coef_[0]), key=lambda kv: -abs(kv[1]))
    print("\nFeature coefficients (standardized — larger magnitude = more influence), most influential first:")
    for name, coef in coefs:
        direction = "favors HOME cover" if coef > 0 else "favors AWAY cover"
        print(f"  {name:<24} {coef:+.3f}  ({direction})")

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "feature_names": FEATURE_NAMES, "test_season": args.test_season, "test_acc": test_acc}, MODEL_PATH)
    print(f"\nSaved model to {MODEL_PATH}")


if __name__ == "__main__":
    main()
