"""Three deep forecasters with a shared interface: (x_past, x_known) -> (B, 3, H).

Output channel order is the 10/50/90 quantile of normalised demand at each of the H
horizon steps, so every model here is comparable to the LightGBM baseline on the same
pinball loss, the same (state, horizon) slices and the same intervals.

Sizes are deliberately small. The target hardware is a 6 GB laptop GPU, but the disk
budget could not fit a CUDA toolchain, so all training here runs on CPU and each model
stays near ~0.5 M parameters.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

QUANTILES = (0.1, 0.5, 0.9)


def pinball_loss(y: torch.Tensor, q: torch.Tensor,
                 quantiles: tuple[float, ...] = QUANTILES) -> torch.Tensor:
    """y (B,H) against q (B,Q,H)."""
    levels = torch.tensor(quantiles, device=y.device).view(1, -1, 1)
    diff = y.unsqueeze(1) - q
    return torch.maximum(levels * diff, (levels - 1) * diff).mean()


class PatchTST(nn.Module):
    """Channel-independent patching transformer over demand, fused with future covariates."""

    def __init__(self, history: int = 168, horizon: int = 24, patch: int = 16,
                 stride: int = 8, d_model: int = 64, heads: int = 4, layers: int = 2,
                 n_known: int = 11, dropout: float = 0.1):
        super().__init__()
        self.horizon = horizon
        self.patch, self.stride = patch, stride
        n_patches = (history - patch) // stride + 1
        self.proj = nn.Linear(patch, d_model)
        self.pos = nn.Parameter(torch.randn(1, n_patches, d_model) * 0.02)
        layer = nn.TransformerEncoderLayer(d_model, heads, d_model * 2, dropout,
                                           batch_first=True, norm_first=True)
        self.enc = nn.TransformerEncoder(layer, layers)
        self.cov = nn.Linear(n_known, d_model)
        self.head = nn.Linear(d_model, len(QUANTILES))

    def forward(self, x_past: torch.Tensor, x_known: torch.Tensor) -> torch.Tensor:
        patches = x_past[:, 0].unfold(1, self.patch, self.stride)          # (B,N,patch)
        z = self.enc(self.proj(patches) + self.pos).mean(dim=1, keepdim=True)  # (B,1,d)
        cov = F.gelu(self.cov(x_known.transpose(1, 2)))                    # (B,H,d)
        return self.head(z + cov).transpose(1, 2)                          # (B,Q,H)


class iTransformer(nn.Module):
    """Inverse transformer: one token per variate, attention across variates."""

    def __init__(self, history: int = 168, horizon: int = 24, n_past: int = 6,
                 n_known: int = 11, d_model: int = 96, heads: int = 4, layers: int = 2,
                 dropout: float = 0.1):
        super().__init__()
        self.horizon = horizon
        self.embed_past = nn.Linear(history, d_model)
        self.embed_known = nn.Linear(horizon, d_model)
        layer = nn.TransformerEncoderLayer(d_model, heads, d_model * 2, dropout,
                                           batch_first=True, norm_first=True)
        self.enc = nn.TransformerEncoder(layer, layers)
        self.norm = nn.LayerNorm(d_model)
        self.head = nn.Linear(d_model, horizon * len(QUANTILES))

    def forward(self, x_past: torch.Tensor, x_known: torch.Tensor) -> torch.Tensor:
        tokens = torch.cat([self.embed_past(x_past), self.embed_known(x_known)], dim=1)
        tok = self.norm(self.enc(tokens))
        demand = tok[:, 0]                       # the demand variate carries the forecast
        return self.head(demand).view(-1, len(QUANTILES), self.horizon)


class TFTLite(nn.Module):
    """Temporal fusion transformer trimmed to what matters at this scale: a static
    enrichment vector, a GRU over history, and cross-attention from future steps."""

    def __init__(self, history: int = 168, horizon: int = 24, n_past: int = 6,
                 n_known: int = 11, d_model: int = 64, layers: int = 1,
                 dropout: float = 0.1):
        super().__init__()
        self.horizon = horizon
        self.inp = nn.Linear(n_past, d_model)
        self.static = nn.Linear(n_past + n_known, d_model)
        self.gru = nn.GRU(d_model, d_model, layers, batch_first=True,
                          dropout=dropout if layers > 1 else 0.0)
        self.future = nn.Linear(n_known, d_model)
        self.att = nn.MultiheadAttention(d_model, 4, dropout=dropout, batch_first=True)
        self.norm = nn.LayerNorm(d_model)
        self.out = nn.Linear(d_model, len(QUANTILES))

    def forward(self, x_past: torch.Tensor, x_known: torch.Tensor) -> torch.Tensor:
        h = self.inp(x_past.transpose(1, 2))                        # (B,L,d)
        h = h + self.static(torch.cat([x_past.mean(2), x_known.mean(2)], dim=1)).unsqueeze(1)
        g, _ = self.gru(h)
        f = F.gelu(self.future(x_known.transpose(1, 2)))            # (B,H,d)
        a, _ = self.att(f, g, g)
        return self.out(self.norm(a)).transpose(1, 2)               # (B,Q,H)


MODELS = {"patchtst": PatchTST, "itransformer": iTransformer, "tft": TFTLite}
