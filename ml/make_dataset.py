"""Synthetic booking-outcome dataset (Module 16).

WHY synthetic: no production history exists yet. Domain-rule labels encode the
product judgement — a good match is high overlap + close pickup + close
drop-off + on-time — with noise so the models must LEARN the weighting instead
of memorising a formula.

Schema per row: overlap01, pickup01, dropoff01, time01 in [0,1] + label {0,1}.
Label rule (kept OUT of the serving path — models learn an approximation):

    latent = 0.45*overlap01 + 0.25*pickup01 + 0.15*dropoff01 + 0.15*time01
    label  = 1 iff latent + noise(0, 0.08) > 0.55

Usage (from repo root): `python ml/make_dataset.py --n 4000 --seed 7`
Writes ml/data/matches.csv
"""
import argparse
import os
import random

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HEADER = "overlap01,pickup01,dropoff01,time01,label\n"
W = (0.45, 0.25, 0.15, 0.15)
THRESHOLD = 0.55
NOISE = 0.08


def gen_row(rng):
    feats = [rng.betavariate(2.0, 2.0) for _ in range(4)]
    latent = sum(w * f for w, f in zip(W, feats))
    label = 1 if latent + rng.gauss(0.0, NOISE) > THRESHOLD else 0
    return feats, label


def make_dataset(n=4000, seed=7):
    rng = random.Random(seed)
    rows = [gen_row(rng) for _ in range(n)]
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=os.path.join(REPO_ROOT, "ml", "data", "matches.csv"))
    args = ap.parse_args()
    rows = make_dataset(n=args.n, seed=args.seed)
    out = args.out
    if not os.path.isabs(out):
        out = os.path.join(REPO_ROOT, out)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w") as f:
        f.write(HEADER)
        for feats, label in rows:
            f.write("{:.4f},{:.4f},{:.4f},{:.4f},{}\n".format(
                feats[0], feats[1], feats[2], feats[3], label))
    pos = sum(l for _, l in rows)
    print("wrote {} rows to {} (positives={} {:.1%})".format(
        len(rows), out, pos, pos / max(1, len(rows))))


if __name__ == "__main__":
    main()
