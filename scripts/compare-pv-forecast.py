#!/usr/bin/env python3
"""Compare halo's PV forecast against fmi-pv-forecast-runner for the same site.

Both are run against live FMI and their output diffed point by point.

    PV_ENV_FILE=../fmi-pv-forecast-runner/.env scripts/compare-pv-forecast.py

Requires `PV_LAT`, `PV_LON`, `PV_TILT`, `PV_AZIMUTH` and `PV_KW` in the
environment or in `$PV_ENV_FILE`, plus a checkout of the runner (`PV_RUNNER_PATH`,
default `../fmi-pv-forecast-runner`).
"""

import json
import os
import pathlib
import re
import subprocess
import sys

FIELDS = ["outputW", "temperature", "wind", "moduleTemp"]
REQUIRED = ["PV_LAT", "PV_LON", "PV_TILT", "PV_AZIMUTH", "PV_KW"]

root = pathlib.Path(__file__).resolve().parent.parent
runner = pathlib.Path(os.environ.get("PV_RUNNER_PATH", root.parent / "fmi-pv-forecast-runner"))


def load_env() -> dict[str, str]:
    env = dict(os.environ)

    env_file = os.environ.get("PV_ENV_FILE")
    if env_file:
        for line in pathlib.Path(env_file).read_text().splitlines():
            # Values may carry a trailing comment.
            match = re.match(r"\s*(PV_[A-Z_]+)\s*=\s*([^#]*)", line)
            if match:
                env[match.group(1)] = match.group(2).strip()

    missing = [key for key in REQUIRED if not env.get(key)]
    if missing:
        sys.exit(f"missing required env: {', '.join(missing)}")

    return env


def run(label: str, command: list[str], cwd: pathlib.Path, env: dict[str, str]) -> dict:
    print(f"== {label}", file=sys.stderr)
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"{label} failed:\n{result.stderr}")
    return json.loads(result.stdout)


def main() -> None:
    env = load_env()

    if not (runner / "pyproject.toml").exists():
        sys.exit(f"no runner checkout at {runner} — set PV_RUNNER_PATH")

    reference = run("reference (python)", ["uv", "run", "--quiet", "python", "run.py"], runner, env)
    modelled = run(
        "halo", ["cargo", "run", "--quiet", "--example", "pv_forecast"], root / "backend", env
    )

    by_time_reference = {p["time"]: p for p in reference["points"]}
    by_time_modelled = {p["time"]: p for p in modelled["points"]}
    shared = sorted(set(by_time_reference) & set(by_time_modelled))

    print(f"\nreference : {len(by_time_reference)} points")
    print(f"halo      : {len(by_time_modelled)} points")
    print(f"shared    : {len(shared)}")

    # The reference publishes hours whose radiation was missing as 0 W; halo
    # omits them, so a handful of reference-only points is expected.
    reference_only = sorted(set(by_time_reference) - set(by_time_modelled))
    if reference_only:
        nonzero = [t for t in reference_only if by_time_reference[t]["outputW"] != 0.0]
        print(f"reference only: {len(reference_only)}, of which {len(nonzero)} non-zero")
        if nonzero:
            print(f"  !! non-zero hours are missing from halo: {nonzero}")
    if halo_only := sorted(set(by_time_modelled) - set(by_time_reference)):
        print(f"halo only : {len(halo_only)}  {halo_only[:5]}")

    if not shared:
        sys.exit("no overlapping points to compare")

    print(f"\n{'field':12} {'mean rel':>10} {'worst rel':>10}  where")
    worst_overall = 0.0
    for field in FIELDS:
        total, worst, where = 0.0, 0.0, ""
        for time in shared:
            a = by_time_reference[time].get(field)
            b = by_time_modelled[time].get(field)
            if a is None or b is None:
                continue
            deviation = abs(b - a) / max(abs(a), 1.0)
            total += deviation
            if deviation > worst:
                worst, where = deviation, f"{time}  {a:.4f} vs {b:.4f}"
        print(f"{field:12} {total / len(shared):10.2e} {worst:10.2e}  {where}")
        worst_overall = max(worst_overall, worst)

    energy_reference = sum(by_time_reference[t]["outputW"] for t in shared) / 1000.0
    energy_modelled = sum(by_time_modelled[t]["outputW"] for t in shared) / 1000.0
    drift = (energy_modelled - energy_reference) / energy_reference * 100.0
    print(f"\nshared energy: {energy_reference:.3f} kWh vs {energy_modelled:.3f} kWh ({drift:+.4f}%)")

    # Two NREL SPA implementations agree to roughly 1e-5 degrees, which grazing
    # incidence amplifies; anything past this is a real disagreement.
    if worst_overall > 1e-4:
        sys.exit(f"\nworst deviation {worst_overall:.2e} exceeds 1e-4")
    print("\nagreement is within tolerance")


if __name__ == "__main__":
    main()
