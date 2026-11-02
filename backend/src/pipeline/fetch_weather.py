"""Fetch ERA5 hourly weather for every state location, plus a longer window for
the metro cities that back the national-history model.

Open-Meteo's archive endpoint needs no key. Locations are requested in batches so
each HTTP response stays small enough to parse without spilling to disk.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

import httpx
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "config" / "state_registry.json"
RAW = ROOT / "data" / "raw"

HOURLY_VARS = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "shortwave_radiation",
    "wind_speed_10m",
    "precipitation",
]
API = "https://archive-api.open-meteo.com/v1/archive"
TZ = "Asia/Kolkata"


def _fetch(client: httpx.Client, lats: list[float], lons: list[float],
           start: str, end: str) -> list[dict]:
    params = {
        "latitude": ",".join(str(v) for v in lats),
        "longitude": ",".join(str(v) for v in lons),
        "start_date": start,
        "end_date": end,
        "hourly": ",".join(HOURLY_VARS),
        "timezone": TZ,
    }
    for attempt in range(4):
        try:
            r = client.get(API, params=params, timeout=120)
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            r.raise_for_status()
            body = r.json()
            return body if isinstance(body, list) else [body]
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            if attempt == 3:
                raise RuntimeError(f"weather fetch failed {start}..{end}: {exc}") from exc
            time.sleep(2 ** attempt)
    return []


def _to_frame(chunks: list[list[dict]], codes: list[str]) -> pd.DataFrame:
    """Concatenate each location's yearly slices, then join locations side by side.

    Yearly chunks must be appended per location: assigning them into one dict keyed
    by column name would let a later year silently overwrite an earlier one.
    """
    per_code: dict[str, pd.DataFrame] = {c: [] for c in codes}
    for results in chunks:
        for code, loc in zip(codes, results, strict=True):
            hourly = pd.DataFrame(loc["hourly"])
            hourly["time"] = pd.to_datetime(hourly["time"])
            per_code[code].append(hourly.set_index("time")[HOURLY_VARS])
    out = pd.DataFrame()
    for code in codes:
        frames = per_code[code]
        joined = pd.concat(frames).sort_index()
        joined = joined[~joined.index.duplicated(keep="last")]
        for v in HOURLY_VARS:
            out[f"{v}__{code}"] = joined[v]
    return out.sort_index()


def _year_chunks(start: str, end: str) -> list[tuple[str, str]]:
    """Split [start, end] into calendar-year segments, including the first partial year."""
    first, last = pd.Timestamp(start), pd.Timestamp(end)
    segments = []
    for y in range(first.year, last.year + 1):
        ys = max(first, pd.Timestamp(year=y, month=1, day=1))
        ye = min(last, pd.Timestamp(year=y, month=12, day=31))
        segments.append((ys.strftime("%Y-%m-%d"), ye.strftime("%Y-%m-%d")))
    return segments


def main(start: str, end: str, path: str) -> int:
    registry = json.loads(REGISTRY.read_text())
    codes = sorted(registry)
    lats = [registry[c]["lat"] for c in codes]
    lons = [registry[c]["lon"] for c in codes]

    chunks = []
    with httpx.Client() as client:
        for ys, ye in _year_chunks(start, end):
            print(f"fetching {len(codes)} locations {ys}..{ye}", flush=True)
            chunks.append(_fetch(client, lats, lons, ys, ye))
            time.sleep(1)

    panel = _to_frame(chunks, codes)
    dest = ROOT / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    panel.to_parquet(dest)
    print(f"wrote {dest} shape={panel.shape} null%={100 * panel.isna().mean().mean():.2f}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2024-03-01")
    ap.add_argument("--end", default="2026-11-01")
    ap.add_argument("--out", default="data/raw/weather_states.parquet")
    a = ap.parse_args()
    sys.exit(main(a.start, a.end, a.out))
