"""AI rank info (Module 16): which model serves search + booking snapshots.

GET /api/v1/rank/info -> {model, features, weights, bias, auc, ...}
 lets the frontend badge results ("AI ranked · logreg AUC 0.91") and gives
 the report a citable model card without exposing any training dependency.
"""
from fastapi import APIRouter

from app.services.ranker import model_info

router = APIRouter(prefix="/rank", tags=["rank"])


@router.get("/info")
async def rank_info():
    return model_info()
