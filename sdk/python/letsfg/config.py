"""
Local configuration and GitHub star verification.

Users must star https://github.com/LetsFG/LetsFG to use the SDK.
This is verified via GitHub's public API and cached locally.

Usage:
    from letsfg.config import require_star_verification, verify_github_star
    
    # Check if verified (raises if not)
    require_star_verification()
    
    # Verify a new user
    verify_github_star("username")
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

logger = logging.getLogger(__name__)

GITHUB_REPO_OWNER = "LetsFG"
GITHUB_REPO_NAME = "LetsFG"
GITHUB_REPO_URL = f"https://github.com/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}"

# Cache star verification for 7 days
VERIFICATION_CACHE_SECONDS = 7 * 24 * 3600


class StarVerificationError(Exception):
    """Raised when GitHub star verification fails."""
    pass


class StarRequiredError(Exception):
    """Raised when search is attempted without star verification."""
    
    def __init__(self):
        super().__init__(
            f"\n"
            f"  ⭐ GitHub star required to use LetsFG!\n"
            f"\n"
            f"  1. Star the repo: {GITHUB_REPO_URL}\n"
            f"  2. Run: letsfg star --github <your-username>\n"
            f"\n"
            f"  This is completely FREE — just a star to help us grow!\n"
        )


def get_config_dir() -> Path:
    """Get the LetsFG config directory (~/.letsfg)."""
    if os.name == "nt":
        # Windows: use APPDATA or fallback to home
        base = Path(os.environ.get("APPDATA", Path.home()))
        config_dir = base / "letsfg"
    else:
        # Unix: ~/.letsfg
        config_dir = Path.home() / ".letsfg"
    
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir


def get_config_file() -> Path:
    """Get the config file path."""
    return get_config_dir() / "config.json"


def _load_config() -> dict:
    """Load config from disk."""
    config_file = get_config_file()
    if config_file.exists():
        try:
            return json.loads(config_file.read_text())
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_config(config: dict) -> None:
    """Save config to disk."""
    config_file = get_config_file()
    config_file.write_text(json.dumps(config, indent=2))


def get_verified_username() -> Optional[str]:
    """Get the verified GitHub username, or None if not verified."""
    config = _load_config()
    
    github_data = config.get("github", {})
    username = github_data.get("username")
    verified_at = github_data.get("verified_at", 0)
    
    if not username:
        return None
    
    # Check if verification has expired (re-verify weekly)
    if time.time() - verified_at > VERIFICATION_CACHE_SECONDS:
        return None
    
    return username


def is_star_verified() -> bool:
    """Check if GitHub star verification is cached and valid."""
    return get_verified_username() is not None


def _check_github_star(username: str) -> bool:
    """
    Check if a user has starred the LetsFG repo via GitHub API.
    
    Uses the repo stargazers endpoint (paginated) for reliable results.
    The /users/{user}/starred endpoint is unreliable for new accounts
    and users with private star activity.
    Rate limited to 60 requests/hour for unauthenticated requests.
    """
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "LetsFG-SDK/1.0",
    }
    
    # Paginate through stargazers (100 per page)
    page = 1
    while True:
        url = (
            f"https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}"
            f"/stargazers?per_page=100&page={page}"
        )
        try:
            req = Request(url, headers=headers, method="GET")
            with urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
        except HTTPError as e:
            if e.code == 403:
                logger.warning("GitHub API rate limited. Please try again in a minute.")
                return False
            raise StarVerificationError(f"GitHub API error: {e.code}")
        except URLError as e:
            raise StarVerificationError(f"Network error: {e.reason}")
        
        if not data:
            break
        
        for stargazer in data:
            if stargazer.get("login", "").lower() == username.lower():
                return True
        
        if len(data) < 100:
            break
        page += 1
    
    return False


def verify_github_star(username: str) -> dict:
    """
    Verify GitHub star and cache the result locally.
    
    Args:
        username: GitHub username to verify
        
    Returns:
        dict with status: "verified", "already_verified", or "star_required"
    """
    username = username.strip()
    
    if not username:
        raise StarVerificationError("GitHub username cannot be empty")
    
    # Check if already verified
    current = get_verified_username()
    if current and current.lower() == username:
        return {
            "status": "already_verified",
            "github_username": username,
            "message": "Already verified! You have unlimited access.",
        }
    
    # Verify via GitHub API
    has_starred = _check_github_star(username)
    
    if has_starred:
        # Save verification
        config = _load_config()
        config["github"] = {
            "username": username,
            "verified_at": int(time.time()),
        }
        _save_config(config)
        
        return {
            "status": "verified",
            "github_username": username,
            "message": "GitHub star verified! Unlimited access granted.",
        }
    else:
        return {
            "status": "star_required",
            "github_username": username,
            "message": f"Star not found. Please star {GITHUB_REPO_URL} first.",
        }


def require_star_verification() -> str:
    """
    Require GitHub star verification before proceeding.
    
    Returns:
        The verified GitHub username.
        
    Raises:
        StarRequiredError: If not verified.
    """
    username = get_verified_username()
    if username:
        return username
    raise StarRequiredError()


def clear_verification() -> None:
    """Clear the cached verification (for testing)."""
    config = _load_config()
    config.pop("github", None)
    _save_config(config)
