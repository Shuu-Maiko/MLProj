"""FastAPI service exposing the trained forecaster to the game.

Contract with the frontend: the game sends a city, a clock hour and the scenario's
weather; it gets back model quantiles in MW plus the provenance needed to label them
honestly. Nothing here is hardcoded — every number comes from the checkpoint or the
measured panel.
"""

from __future__ import annotations

import json
import pathlib
import sys
from typing import Literal

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from api.inference import MAX_HOURS, ForecastError, Forecaster  # noqa: E402
from models.deep.dataset import FORECAST_LEN  # noqa: E402

RESULTS = ROOT / "artifacts" / "results"
REGISTRY = ROOT / "config" / "state_registry.json"

app = FastAPI(title="GridKeeper Forecast Service", version="1.0")
# The game runs on another origin in dev; nothing here is authenticated, so keep the
# allowance scoped to the local client.
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_methods=["*"], allow_headers=["*"])

forecaster: Forecaster | None = None


def engine() -> Forecaster:
    global forecaster
    if forecaster is None:
        forecaster = Forecaster()
    return forecaster


class Scenario(BaseModel):
    temperature_c: float | list[float] | None = Field(default=None, description="Future dry-bulb")
    humidity_pct: float | list[float] | None = None
    irradiance_wm2: float | list[float] | None = None
    wind_kmh: float | list[float] | None = None
    precip_mm: float | list[float] | None = None


class ForecastRequest(BaseModel):
    city_id: str | None = None
    state_code: str | None = None
    hour: int = Field(ge=0, le=MAX_HOURS, description="Game clock hour since the data epoch")
    horizon_h: int = Field(default=FORECAST_LEN, ge=1, le=FORECAST_LEN)
    scenario: Scenario = Field(default_factory=Scenario)


class Point(BaseModel):
    offsetH: int
    timestamp: str
    p10MW: float
    p50MW: float
    p90MW: float


class WeatherStep(BaseModel):
    timestamp: str
    temperatureC: float | None
    humidityPct: float | None
    irradianceWm2: float | None
    windKmh: float | None
    precipMm: float | None


class ForecastResponse(BaseModel):
    cityId: str | None
    stateCode: str
    stateName: str
    metroShare: float | None
    model: str
    horizonH: int
    points: list[Point]
    weather: list[WeatherStep]
    weatherUsed: dict
    basis: Literal["model+calibration"] = "model+calibration"
    warnings: list[str]


def resolve_state(city_id: str | None, state_code: str | None, registry: dict) -> tuple[str, str | None]:
    if state_code and state_code in registry:
        return state_code, None
    if city_id:
        for code, meta in registry.items():
            metro = meta.get("metro")
            if metro and metro["name"].lower() == city_id.lower():
                return code, metro["name"]
    raise HTTPException(404, f"unknown city {city_id!r} or state {state_code!r}")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", **engine().info()}


@app.get("/model")
def model_info() -> dict:
    """Served model plus the benchmark it won, straight from the evaluation artifacts."""
    out = {"served": engine().info(), "benchmark": {}}
    for key, fname in (("deep", "deep_eval.json"), ("lgbm", "lgbm_eval.json")):
        path = RESULTS / fname
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        if key == "deep":
            out["benchmark"]["ranking"] = data.get("ranking", [])
            out["benchmark"]["baselines"] = data.get("baseline", {})
        else:
            out["benchmark"]["lightgbm"] = {
                "overall": data.get("overall"),
                "naive": data.get("naive"),
                "mae_reduction_vs_naive_pct": data.get("mae_reduction_vs_naive_pct"),
            }
    # Accuracy alone picked the wrong model: iTransformer has the lower MAE but barely
    # responds to temperature, so the elasticity probe is part of the card.
    weather = RESULTS / "weather_response.json"
    if weather.exists():
        out["benchmark"]["weather_response"] = json.loads(weather.read_text())
    dataset = ROOT / "data" / "processed" / "dataset_card.json"
    if dataset.exists():
        out["dataset"] = json.loads(dataset.read_text())
    return out


@app.get("/cities")
def cities(hour: int = Query(default=0, ge=0, le=MAX_HOURS)) -> dict:
    """Metro registry with the real weather the model will be conditioned on."""
    f = engine()
    registry = json.loads(REGISTRY.read_text())
    out = []
    for code, meta in registry.items():
        metro = meta.get("metro")
        if not metro:
            continue
        out.append({
            "id": metro["name"], "stateCode": code, "stateName": meta["name"],
            "metroShare": metro["share_of_state"],
            "weather": f.weather_now(code, hour),
            "modelMAPE_pct": _model_mape(code),
        })
    return {"hour": hour, "cities": out, "epoch": f.info()["game_epoch"]}


def _model_mape(state: str) -> float | None:
    path = RESULTS / "deep_eval.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    for model in data.get("models", {}).values():
        row = model.get("per_state", {}).get(state)
        if row:
            return row["MAPE_pct"]
    return None


def pick_weather(scalar: float | list[float] | None, row, column: str, i: int) -> float | None:
    """Scenario value if the player set one, otherwise the measured weather."""
    if scalar is not None:
        return float(scalar[i]) if isinstance(scalar, list) else float(scalar)
    value = row.get(column)
    return None if value is None or value != value else round(float(value), 2)


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest) -> ForecastResponse:
    f = engine()
    registry = json.loads(REGISTRY.read_text())
    state, city = resolve_state(req.city_id, req.state_code, registry)
    scenario = req.scenario.model_dump(exclude_none=True)
    try:
        outcome = f.forecast(state, req.hour, req.horizon_h, scenario)
    except ForecastError as exc:
        raise HTTPException(400, str(exc)) from exc

    df = outcome.points
    warnings = []
    if outcome.shifted_hours:
        warnings.append(f"history gap: conditioned on {outcome.origin_used.isoformat()} "
                        f"({outcome.shifted_hours} h earlier than requested)")

    points = [
        Point(offsetH=i + 1, timestamp=row.timestamp.isoformat(),
              p10MW=round(float(row.p10MW), 1), p50MW=round(float(row.p50MW), 1),
              p90MW=round(float(row.p90MW), 1))
        for i, row in enumerate(df.itertuples())
    ]
    meta = registry[state]
    wx = f.future_weather(state, outcome.origin_used, req.horizon_h)
    sc = req.scenario
    steps = [
        WeatherStep(
            timestamp=ts.isoformat(),
            temperatureC=pick_weather(sc.temperature_c, row, "temperature_2m", i),
            humidityPct=pick_weather(sc.humidity_pct, row, "relative_humidity_2m", i),
            irradianceWm2=pick_weather(sc.irradiance_wm2, row, "shortwave_radiation", i),
            windKmh=pick_weather(sc.wind_kmh, row, "wind_speed_10m", i),
            precipMm=pick_weather(sc.precip_mm, row, "precipitation", i),
        )
        for i, (ts, row) in enumerate(wx.iterrows())
    ]

    return ForecastResponse(
        cityId=city, stateCode=state, stateName=meta["name"],
        metroShare=meta.get("metro", {}).get("share_of_state"),
        model=f.name, horizonH=len(points), points=points, weather=steps,
        weatherUsed=f.weather_now(state, req.hour), warnings=warnings,
    )


@app.get("/history")
def history(state: str, hour: int = Query(ge=0, le=MAX_HOURS),
            hours: int = Query(default=72, ge=1, le=720)) -> dict:
    f = engine()
    try:
        df = f.history(state, hour, hours)
    except ForecastError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "state": state,
        "points": [{"timestamp": t.isoformat(), "measuredMW": None if v != v else round(float(v), 1)}
                   for t, v in zip(df["timestamp"], df["measuredMW"], strict=True)],
        "note": "measured Merit India demand, hourly resample of 15-minute readings",
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
