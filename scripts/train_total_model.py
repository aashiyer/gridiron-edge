"""Train a logistic regression to predict Over probability, using the same
totals-specific signals the live heuristic computes (backend/features.py's
extract_total_features) — and backtest it on a held-out season.

Mirrors scripts/train_ats_model.py exactly in structure; see that file for
the reasoning behind the train/test split and the model choice. The feature
set is deliberately different (TOTAL_FEATURE_NAMES, not FEATURE_NAMES) —
"will this be high-scoring" and "who covers the spread" overlap but aren't
the same question.

This does NOT replace the "Edge" heuristic; it's a second, independently-
fit opinion. build_recommendation() loads the saved model (if present) and
adds its predicted probability as one more signal alongside the rest.

As of the initial totals feature set (TOTAL_FEATURE_NAMES), this backtests
BELOW the "always pick Over" baseline on 2025 (46-48% vs. 51.9%, tried
across several feature subsets and regularization strengths) — worse than
a trivial rule, not just below break-even. Following the same standard the
ATS model's dropped QB features were held to (scripts/train_ats_model.py /
features.py), a model that backtests below baseline does NOT get shipped:
don't commit data/total_model.joblib until a retrain actually clears the
baseline on a held-out season. The live heuristic's Over/Under lean works
fine without it (see analysis.py's build_recommendation) — this is meant
to grow into a real signal over time, not to be forced in early.

Usage:
    python -m scripts.train_total_model                    # train on <=2024, test on 2025
    python -m scripts.train_total_model --test-season 2024  # different split
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
from backend.features import extract_total_features, total_label, TOTAL_FEATURE_NAMES

MODEL_PATH = Path(__file__).resolve().parent.parent / "data" / "total_model.joblib"


def build_dataset(conn, min_season: int, max_season: int):
    games = conn.execute(
        """
        SELECT * FROM games
        WHERE status = 'final' AND total_close IS NOT NULL
          AND season >= ? AND season <= ?
        ORDER BY kickoff_time ASC
        """,
        (min_season, max_season),
    ).fetchall()

    X, y, seasons, game_ids = [], [], [], []
    for g in games:
        label = total_label(g)
        if label is None:
            continue
        feats = extract_total_features(conn, g)
        X.append([feats[name] for name in TOTAL_FEATURE_NAMES])
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
    print(f"Test accuracy ({args.test_season}): {test_acc:.1%}  <- this is effectively Over/Under win rate if you bet the model's side every game")
    print(f"Break-even at standard -110 vig: 52.4%")

    always_over_acc = (y_test == 1).mean()
    print(f"(Baseline — always pick Over: {always_over_acc:.1%})")

    logreg = model.named_steps["logisticregression"]
    coefs = sorted(zip(TOTAL_FEATURE_NAMES, logreg.coef_[0]), key=lambda kv: -abs(kv[1]))
    print("\nFeature coefficients (standardized — larger magnitude = more influence), most influential first:")
    for name, coef in coefs:
        direction = "favors OVER" if coef > 0 else "favors UNDER"
        print(f"  {name:<24} {coef:+.3f}  ({direction})")

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {"model": model, "feature_names": TOTAL_FEATURE_NAMES, "test_season": args.test_season, "test_acc": test_acc}, MODEL_PATH
    )
    print(f"\nSaved model to {MODEL_PATH}")


if __name__ == "__main__":
    main()
