import hashlib
import hmac
import logging
import os
import secrets
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from jose import jwt as jose_jwt
from sqlalchemy.orm import Session

from app.api.auth import create_token
from app.config import settings
from app.database import get_db
from app.models.group import Group
from app.models.oidc_settings import OidcSettings
from app.models.user import User
from app.utils.crypto import decrypt

router = APIRouter()
logger = logging.getLogger(__name__)

_FORCE_HTTPS = os.getenv("FORCE_HTTPS", "true").lower() in ("1", "true", "yes")

# State token validity window (10 minutes)
_STATE_MAX_AGE = 600


def _sign_state(nonce: str, timestamp: int) -> str:
    """Create an HMAC-signed state token that is safe across multiple workers."""
    payload = f"{nonce}:{timestamp}"
    sig = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def _verify_state(state: str) -> bool:
    """Verify the HMAC signature and freshness of a state token."""
    parts = state.split(":")
    if len(parts) != 3:
        return False
    nonce, ts_str, sig = parts
    try:
        timestamp = int(ts_str)
    except ValueError:
        return False
    if time.time() - timestamp > _STATE_MAX_AGE:
        return False
    expected = hmac.new(
        settings.SECRET_KEY.encode(), f"{nonce}:{ts_str}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(sig, expected)


def _get_base_url(request: Request) -> str:
    """Derive the base URL from the incoming request."""
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    if _FORCE_HTTPS:
        scheme = "https"
    host = request.headers.get("x-forwarded-host", request.headers.get("host", ""))
    return f"{scheme}://{host}"


def _get_oidc(db: Session) -> OidcSettings:
    cfg = db.query(OidcSettings).first()
    if not cfg or not cfg.enabled:
        raise HTTPException(status_code=400, detail="OIDC is not configured")
    return cfg


def _discover(issuer_url: str) -> dict:
    """Fetch OIDC discovery document."""
    url = issuer_url.rstrip("/")
    well_known = f"{url}/.well-known/openid-configuration"
    resp = httpx.get(well_known, timeout=10, follow_redirects=True)
    resp.raise_for_status()
    return resp.json()


@router.get("/config")
def oidc_public_config(db: Session = Depends(get_db)):
    """Return minimal OIDC config for the login page (no secrets)."""
    cfg = db.query(OidcSettings).first()
    if not cfg or not cfg.enabled:
        return {"enabled": False}
    return {
        "enabled": True,
        "display_name": cfg.display_name,
        "provider_name": cfg.provider_name,
    }


@router.get("/login")
def oidc_login(request: Request, db: Session = Depends(get_db)):
    """Redirect user to the IdP authorization endpoint."""
    cfg = _get_oidc(db)
    discovery = _discover(cfg.issuer_url)
    auth_endpoint = discovery["authorization_endpoint"]

    state = _sign_state(secrets.token_urlsafe(16), int(time.time()))

    base_url = _get_base_url(request)
    redirect_uri = f"{base_url}/api/oidc/callback"
    params = {
        "response_type": "code",
        "client_id": cfg.client_id,
        "redirect_uri": redirect_uri,
        "scope": cfg.scopes,
        "state": state,
    }
    query = "&".join(f"{k}={httpx.QueryParams({k: v})}" for k, v in params.items())
    # Build proper URL
    sep = "&" if "?" in auth_endpoint else "?"
    url = f"{auth_endpoint}{sep}" + "&".join(
        f"{k}={v}" for k, v in httpx.QueryParams(params).items()
    )
    return RedirectResponse(url)


@router.get("/callback")
def oidc_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    """Handle the IdP callback: exchange code for tokens, create/update user, return JWT."""
    # Verify state (HMAC-signed, works across workers)
    if not _verify_state(state):
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    cfg = _get_oidc(db)
    discovery = _discover(cfg.issuer_url)
    token_endpoint = discovery["token_endpoint"]
    userinfo_endpoint = discovery.get("userinfo_endpoint")

    # Exchange authorization code for tokens
    base_url = _get_base_url(request)
    redirect_uri = f"{base_url}/api/oidc/callback"
    client_secret = decrypt(cfg.client_secret_encrypted) if cfg.client_secret_encrypted else ""

    token_resp = httpx.post(
        token_endpoint,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": cfg.client_id,
            "client_secret": client_secret,
        },
        timeout=15,
    )
    if token_resp.status_code != 200:
        logger.error(f"OIDC token exchange failed: {token_resp.status_code} {token_resp.text}")
        raise HTTPException(status_code=400, detail="OIDC token exchange failed")

    token_data = token_resp.json()
    id_token = token_data.get("id_token")
    access_token = token_data.get("access_token")

    # Decode ID token (without full verification — we trust the token endpoint over TLS)
    claims = {}
    if id_token:
        claims = jose_jwt.get_unverified_claims(id_token)

    # Fetch userinfo for additional claims if available
    if userinfo_endpoint and access_token:
        try:
            ui_resp = httpx.get(
                userinfo_endpoint,
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10,
            )
            if ui_resp.status_code == 200:
                userinfo = ui_resp.json()
                # Merge: userinfo takes precedence for profile data
                for key in ("email", "preferred_username", "name", "groups", cfg.group_claim):
                    if key in userinfo and key not in claims:
                        claims[key] = userinfo[key]
        except Exception:
            logger.warning("Failed to fetch userinfo, continuing with ID token claims")

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=400, detail="No 'sub' claim in OIDC token")

    email = claims.get("email", "")
    preferred_username = claims.get("preferred_username") or claims.get("name") or email.split("@")[0]
    display_name = claims.get("name") or preferred_username

    # Determine admin status from IdP groups
    idp_groups = claims.get(cfg.group_claim, [])
    if isinstance(idp_groups, str):
        idp_groups = [idp_groups]
    is_admin = bool(cfg.admin_group and cfg.admin_group in idp_groups)

    # Look up existing user by oidc_sub
    user = db.query(User).filter(User.oidc_sub == sub).first()

    if not user:
        # Try matching by email
        if email:
            user = db.query(User).filter(User.email == email).first()
            if user:
                # Link existing user to OIDC
                user.oidc_sub = sub
                if cfg.admin_group:
                    user.is_admin = is_admin
                db.commit()

    if not user:
        # Auto-create user
        if not cfg.auto_create_users:
            raise HTTPException(
                status_code=403,
                detail="Automatic user creation is disabled. Please contact an administrator.",
            )

        # Ensure unique username
        base_username = preferred_username[:50]
        username = base_username
        counter = 1
        while db.query(User).filter(User.username == username).first():
            username = f"{base_username[:46]}_{counter}"
            counter += 1

        # Determine group: match IdP groups to CertDax groups by name
        group_id = None
        for idp_group_name in idp_groups:
            matched = db.query(Group).filter(Group.name == idp_group_name).first()
            if matched:
                group_id = matched.id
                break
        # Fall back to configured default group
        if not group_id:
            group_id = cfg.default_group_id
            if group_id and not db.query(Group).filter(Group.id == group_id).first():
                group_id = None
        if not group_id:
            default_group = db.query(Group).first()
            group_id = default_group.id if default_group else None

        user = User(
            username=username,
            display_name=display_name,
            email=email or f"{username}@oidc.local",
            password_hash="!oidc-managed",  # Cannot login with password
            oidc_sub=sub,
            is_admin=is_admin,
            group_id=group_id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info(f"OIDC: Created new user '{username}' (sub={sub}, admin={is_admin})")
    else:
        # Update display name and admin status on every login
        if display_name:
            user.display_name = display_name
        if email and user.email != email:
            # Only update if no other user has this email
            existing = db.query(User).filter(User.email == email, User.id != user.id).first()
            if not existing:
                user.email = email
        if cfg.admin_group:
            user.is_admin = is_admin
        # Sync group from IdP groups
        for idp_group_name in idp_groups:
            matched = db.query(Group).filter(Group.name == idp_group_name).first()
            if matched:
                user.group_id = matched.id
                break
        db.commit()

    # Create our own JWT and redirect to frontend
    token = create_token(user.id)
    base_url = _get_base_url(request)
    return RedirectResponse(f"{base_url}/login?token={token}")
